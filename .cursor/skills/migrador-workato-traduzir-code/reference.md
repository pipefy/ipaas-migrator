# Estado observado — traduzir code

Retrato, não contrato.

## Onde entra

Dentro de [transpilar](../migrador-workato-transpilar/SKILL.md), entre o motor e o anexo. O `flow.json` que sobe no card e o que vai no `IMPORT_FLOW` já saem traduzidos.

```
transpilar-receita.mjs
  → flow.json com AP-MIGRATION-TODO
  → traduzir-code
  → flow.json com JS
  → anexar / --reimport
```

Card já transportado: o ramo reprocessar do transpile chama esta skill do mesmo jeito e reimporta no mesmo `ap_flow_id`.

## O stub

[engine/lib/flow-builder.ts](../../../engine/lib/flow-builder.ts) `buildCodeStub`. Dois formatos, os dois com `return inputs`:

Com Ruby (`workato_custom_code/invoke_custom_ruby_code`):

```
/**
 * AP-MIGRATION-TODO: traduzir o Ruby (Workato "<opKey>") para JavaScript.
 * Formato Activepieces: use `inputs.<campo>` …
 *
 * --- RUBY ORIGINAL (Workato) ---
 * <ruby linha a linha>
 * --- FIM RUBY ---
 */
```

Sem Ruby (`py_eval`, `js_eval`, `logger`, `builtin: code` do mapa):

```
// AP-MIGRATION-TODO: implementar em JS a logica Workato "<opKey>".
```

O `opKey` sai entre aspas nas duas linhas. `listar-code-stubs.mjs` casa o stub com o passo Workato pelo `opKey` + ordem de ocorrência; sem receita, cai no `settings.input.code` do próprio step.

Quem entra em CODE: `entry.manual`, `entry.builtin` ou `invoke_custom_ruby_code`. No [mappings/base-map.json](../../../mappings/base-map.json): `workato_custom_code/invoke_custom_ruby_code` e `py_eval/invoke_custom_py_code` são `manual: true`; `js_eval/invoke_custom_js_code` e `logger/log_message` são `builtin: code`.

Ruby cujo corpo é só `sleep N` **não** chega aqui — vira `delayFor` (`workato_custom_code/sleep`).

Token literal num campo `token` / `secret` / `api_key` / `password` / `authorization` do input (ou o mesmo valor dentro do fonte) vira `{{variables['PROVEDOR_TOKEN']}}`. O nome usa o host da URL no código (`api.notion.com` → `NOTION_TOKEN`). A nota é `REVISAR: token`: criar a variável no iPaaS; o valor não fica no flow. O JS lê `inputs...token` e chama a API com `fetch`.

## De onde o JS lê

| Origem | `settings.input` | `inputPath` |
| --- | --- | --- |
| Ruby | `code_input.data` achatado pelo motor | `inputs.<campo>` |
| `py_eval` / `js_eval` com pill | input Workato inteiro (`code`, `code_input`, `code_output_schema_json`, `name`) | `inputs.code_input.data.<campo>` |
| `js_eval` sem pill | só `code` | nada a ler |
| `logger/log_message` | `message`, `user_logs_enabled` | `inputs.message` |

Visto na receita `46740012` (card `1448579797`): `step_3` e `step_5` Python com `inputs.code_input.data`; `step_4` só com `code`; `step_6` JS com `code_input.data`.

`language: logica` vem com `source` vazio: não havia código de usuário, o passo Workato era nativo e o mapa mandou para CODE. A intenção está em `notes` do mapa. `logger/log_message` (receita `54460432`, `step_3`) é o caso comum — devolver `{ message: inputs.message }` para os passos seguintes lerem `{{step_3['message']}}`.

Os valores desse `data` podem chegar como `TODO_FORMULA(...)` — é achado de fórmula do QA, não desta skill. Traduzir o código mesmo assim.

## CSV para xlsx

Quando o original gera um `.xlsx` de uma tabela CSV. Visto na receita `46740012` (card `1448579797`): `step_3` faz `pandas.read_csv` + `to_excel` e devolve `excel_content`; `step_5` faz `openpyxl` `Workbook.save` e devolve `encoded_xlsx_content`. Os dois recebem CSV em base64 e o nome da aba.

Sem pacote e sem lib do Node. Copiar o gerador OOXML de [sem-dependencia](../migrador-workato-sem-dependencia/reference.md#csv-para-xlsx). `packageJson` fica `{}`.

Uma aba, sem senha, sem gráfico. Várias abas, estilo, `.xls` binário ou `index=True`: deixar o stub. Decodificar base64 só se o original decodifica. A chave do `return` é a do original (`excel_content`, `encoded_xlsx_content`, …). Nome de aba: no máximo 31 caracteres, e `: \\ / ? * [ ]` viram espaço.

CSV que já chega como texto não passa pelo `base64ToBytes`.

## Xlsx para CSV

Quando o original lê uma aba e devolve o CSV dela. Visto na receita `55161670` (card `1448579773`): `step_6` e `step_26` fazem `pandas.read_excel` + `to_csv(index=False, header=True)` e devolvem `csv`. Entrada: xlsx em base64 e o nome da aba.

O motor, no padrão `read_excel` + `to_csv` + base64, já emite o leitor puro com `inputs.csv` e `return { wd_data }`. Não trocar esse step por `xlsx` nem por `Buffer`. Outro step de leitura copia o bloco de [sem-dependencia](../migrador-workato-sem-dependencia/reference.md#xlsx-para-csv) e ajusta a chave do `return`.

Aba que não existe: o step lança `sheet not found`. `.xls` antigo, senha, pivot ou gráfico: deixar o stub.

## Padrões recorrentes (rodada de 1000 receitas)

Contagem de stubs que a IA traduziu, por intenção: HTTP 63 receitas, datas 63, regex 42+12 (Python, Ruby), CSV 30, xlsx 29, hash/HMAC/JWT 9+6+5 (Python, Ruby, JS). Os corpos variam de receita para receita (só 6 fingerprints se repetem em 2 ou mais workspaces), por isso ficam na IA e não viram template do motor. Cada linha diz o equivalente e o erro que apareceu.

### HTTP (`requests`, `Net::HTTP`, `HTTParty`, `fetch`)

```js
const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
const text = await response.text();
if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
const body = text ? JSON.parse(text) : null;
```

- `raise_for_status()` / `response.code != 200` → `throw` com o status. Não engolir o erro devolvendo `{}`.
- `params=` → `new URLSearchParams(params)` na URL. `data=` (form) → `body: new URLSearchParams(data)` com `Content-Type: application/x-www-form-urlencoded`. `json=` → `JSON.stringify`.
- `timeout=N` → `AbortSignal.timeout(N * 1000)`.
- Token: ler o input que o motor já trocou por `{{variables['…']}}`. Não copiar o literal do comentário.
- `api.pipefy.com`: não traduzir para `fetch`. A nota `REVISAR: API do Pipefy no código` pede a piece Pipefy.

### Datas (`datetime`, `strptime`, `strftime`, `Time.parse`, `ZoneInfo`)

- `strftime('%d/%m/%Y')` → montar com `getUTCDate`/`getUTCMonth()+1`/`getUTCFullYear` e `padStart(2,'0')`. Não usar `toLocaleDateString` sem `timeZone` explícito.
- `datetime.now(ZoneInfo(tz))` → `new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date())`.
- `fromisoformat(v.replace('Z',''))` é horário local sem fuso. `new Date('2026-01-02')` é UTC meia-noite: ler a data com `split('-')` quando o original só quer o dia.
- `timedelta(days=n)` → somar `n * 86400000` em UTC. `relativedelta(months=n)` → `setUTCMonth(getUTCMonth() + n)`, e conferir o fim do mês.
- `except ValueError: return value` → `isNaN(d.getTime()) ? value : …`. Manter o mesmo fallback do original.

### Regex (`re`, `gsub`, `scan`, `=~`)

- `re.sub(p, r, s)` → `s.replace(new RegExp(p, 'g'), r)`. Sem o `g`, troca só a primeira.
- `re.findall` → `[...s.matchAll(/…/g)].map((m) => m[1] ?? m[0])`. `re.search(...).group(1)` → `s.match(/…/)?.[1] ?? null`.
- Grupo nomeado `(?P<n>…)` → `(?<n>…)`. Referência `\g<1>` → `$1`.
- Flags: `re.I` → `i`, `re.M` → `m`, `re.S` → `s`. Ruby `\A`/`\z` → `^`/`$` sem `m`.
- Ruby `scan` com grupos devolve array de arrays. Manter a forma.

### CSV (`csv.reader`, `DictReader`, `pandas.read_csv`, `CSV.parse`)

- Usar um parser que respeite aspas e quebra de linha dentro de campo. `split(',')` quebra em vírgula dentro de aspas.
- `DictReader` / `headers: true` → objeto por linha com o cabeçalho como chave. `dtype=str` → manter tudo como texto.
- Separador e encoding do original (`delimiter=';'`, `encoding='latin-1'`). Arquivo em base64 → decodificar só se o original decodifica.
- CSV para xlsx e xlsx para CSV: os blocos acima e os de [sem-dependencia](../migrador-workato-sem-dependencia/reference.md).

### Xlsx (`openpyxl`, `pandas.read_excel`, `to_excel`)

- Uma aba, sem senha, sem gráfico: bloco sem lib de sem-dependencia, ou `xlsx` no `packageJson`. Aba ausente lança erro.
- `.xls` binário, várias abas, estilo ou fórmula de célula: traduzir com `xlsx` no `packageJson`, ou deixar o stub se a lib não cobre.

### Hash, HMAC, JWT (`hashlib`, `hmac`, `jwt`, `OpenSSL`, `Digest`)

- `hashlib.sha256(s.encode()).hexdigest()` → `createHash('sha256').update(s, 'utf8').digest('hex')` (`import { createHash, createHmac } from 'crypto'`).
- `hmac.new(key, msg, sha256).hexdigest()` → `createHmac('sha256', key).update(msg).digest('hex')`. `base64.b64encode(…digest())` → `.digest('base64')`.
- JWT HS256: `base64url(header) + '.' + base64url(payload)`, e a assinatura é `createHmac('sha256', secret).update(data).digest('base64url')`. `exp`/`iat` em segundos (`Math.floor(Date.now() / 1000)`).
- RS256 (`jwt.encode(..., private_key, 'RS256')`): `createSign('RSA-SHA256')`. A chave vem de variável do projeto, nunca do fonte.
- Se `crypto` do Node estiver bloqueado no Code do iPaaS, é "validar": não trocar por hash caseiro.

## Aplicar

`aplicar-code-traduzido.mjs` escreve `settings.sourceCode.code`. Se o patch do step for objeto com `packageJson`, grava essa string também. Patch em string não mexe no `packageJson`. `valid` fica `true`. `input`, `displayName`, `notes` e `nextAction` ficam como o motor deixou. O iPaaS recalcula a validade no `IMPORT_FLOW`.

Exit 3 quando algum step foi recusado ou não existe. O arquivo ainda é escrito com o que passou.

## QA depois

[verificar-transporte](../migrador-workato-verificar-transporte/SKILL.md) trata `AP-MIGRATION-TODO` como `bloqueia` (o stub de fórmula também ganha `formula vira codigo`, `revisar`). Stub identity (`inputs => inputs`) em step de **variável** é `bloqueia`. Também acusa pill com `output` na primeira chave (`datapill output primeiro`), pill em ponto (`datapill ponto`), segredo literal (`segredo literal`) e índice de loop usado sem `- 1` num Code (`loop por índice`). Traduzir de verdade tira os achados; deixar o stub mantém o bloqueio, que é honesto.

## Scripts

- `scripts/listar-code-stubs.mjs` — só lê; `--out` grava `code-stubs.json`
- `scripts/aplicar-code-traduzido.mjs` — patch `{ "<step>": "<js>" }` ou `{ "<step>": { "code", "packageJson" } }`; `--out` para não sobrescrever
- `scripts/lib/code-stubs.mjs` — `listCodeStubs`, `applyCodeTranslations`, reusa `walkFlowSteps` do QA
