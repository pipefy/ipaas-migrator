---
name: migrador-workato-traduzir-code
description: Reescreve para JavaScript os steps CODE que o motor deixou com AP-MIGRATION-TODO no flow.json (Ruby, Python py_eval, JS js_eval). Roda no mesmo turno do transpile, antes de anexar ou reimportar. Não mexe em piece, input, notes nem no encadeamento. Use when the user invokes /migrador-workato-traduzir-code, or says "traduzir code", "traduzir o Ruby", "resolver os AP-MIGRATION-TODO", or logo depois de rodar o transpile.
disable-model-invocation: true
---

# Traduzir code

Entrada: o `flow.json` e o `recipe.json` que o transpile acabou de escrever. No migrador interno, a pasta é `/tmp/transpilar/<card>/`. No kit cliente, é `output/<id>/`. Os comandos abaixo usam esse caminho.

O motor é determinístico e **não** traduz: `buildCodeStub` deixa `AP-MIGRATION-TODO` e `return inputs`. Esta skill escreve o JavaScript desses steps. Sem stub, não faz nada.

Saída em **uma** interação — completar no mesmo turno, sem perguntar se pode seguir.

Fora do escopo:

- `TODO_FORMULA` e os steps `formula_*` — o compilador de fórmulas já emite o JS deles
- Ruby que é só `sleep N` — vira `delayFor`, não chega aqui
- Sticky notes `REVISAR: try/catch` / `REVISAR: stop_with_error` — continuam notas
- Anexar, mover card, criar flow, publicar

Esta skill **não** chama Pipefy, **não** edita `mappings/`, `kb/` nem `engine/`, **não** usa `--force`.

## Workflow

```
- [ ] 1. Listar os stubs
- [ ] 2. Escrever o JS de cada um
- [ ] 3. Aplicar no flow.json
- [ ] 4. Conferir que não sobrou marcador
- [ ] 5. Devolver a linha `code:` para quem chamou
```

### 1. Listar

```bash
node scripts/listar-code-stubs.mjs \
  --flow-json /tmp/transpilar/<card>/flow.json \
  --recipe /tmp/transpilar/<card>/recipe.json \
  --out /tmp/transpilar/<card>
```

`total: 0`: não há o que traduzir. Parar e devolver `code: nenhum stub`.

Cada stub traz:

| Campo | O que é |
| --- | --- |
| `name` | nome do step no flow (`step_3`) — é a chave do patch |
| `opKey` | operação Workato (`py_eval/invoke_custom_py_code`) |
| `language` | `ruby`, `python`, `javascript` ou `logica` |
| `inputPath` | de onde o JS lê os dados |
| `inputKeys` | campos disponíveis nesse caminho |
| `source` | o código original (Ruby embutido no stub, ou o `code` da receita) |

### 2. Escrever o JS

Formato Activepieces, o mesmo do stub:

```js
export const code = async (inputs) => {
  const { file_content, sheet_name } = inputs.code_input.data;
  // ...
  return { excel_content: ... };
};
```

Regras:

- Usar o `inputPath` do stub. Ruby: `inputs.<campo>` (o motor achata `code_input.data`). Python e JS: `inputs.code_input.data.<campo>`, porque o input Workato inteiro entrou no step.
- `inputKeys` só com `code`: o passo Workato não tinha pill de entrada; o JS não lê nada de fora.
- `language: logica` com `source` vazio: passo nativo Workato sem piece no iPaaS (`logger/log_message`). A intenção está no `notes` do mapa; devolver o que os passos seguintes leem.
- Retornar o objeto final. Quem consome são as pills `{{step_N['campo']}}` dos passos seguintes — manter os **mesmos nomes de chave** que o Ruby/Python devolvia.
- `js_eval`: converter `exports.main = async ({ a, b }) => …` para `export const code`. O corpo em geral aproveita.
- Planilha (`pandas` `to_excel` / `read_excel`, `openpyxl`): o padrão é o pacote `xlsx` no `packageJson`. Uma aba, sem senha e sem gráfico. `.xls` binário, senha, pivot, gráfico ou várias abas: traduzir o que o corpo faz com a lib, ou o bloco sem lib de [sem-dependencia](../migrador-workato-sem-dependencia/reference.md) se não houver pacote que cubra. Não deixar `AP-MIGRATION-TODO`.
- Não apagar o Ruby/Python original: manter como comentário de bloco no topo.
- Preservar o comportamento. Não inventar campo, endpoint ou regra que o original não tem.
- Token literal no input ou no fonte de uma integração: o motor troca por `{{variables['PROVEDOR_TOKEN']}}` e deixa a nota `REVISAR: token`. Traduzir o JS com `fetch`, lendo esse input. Não copiar o segredo para o JS, o comentário ou a nota.
- Lógica ambígua: traduzir o que o corpo diz, com o original em comentário. Não deixar `AP-MIGRATION-TODO` no flow que vai anexar.
- Pacote npm quando o código precisa (planilha `xlsx`, por exemplo): o patch do step é objeto `{ "code", "packageJson" }`. Sem necessidade de pacote, `packageJson` fica `{}`.

O que **não** fazer no JS: chamar a API do Pipefy (isso é step de piece), embutir segredo, trocar `data` por `output` nas pills, reescrever datapill em ponto (o contrato é colchete, `{{trigger['data']['card']['id']}}`).

### 3. Aplicar

Patch: um arquivo JSON com `nome do step` → código.

```json
{
  "step_3": "export const code = async (inputs) => {\n  ...\n};"
}
```

String grava só o código e deixa o `packageJson` como está. Quando o step precisa de lib, o valor do patch é objeto com `code` e `packageJson`.

```bash
node scripts/aplicar-code-traduzido.mjs \
  --flow-json /tmp/transpilar/<card>/flow.json \
  --patch /tmp/transpilar/<card>/code-patch.json
```

Escreve `settings.sourceCode.code` e marca o step `valid: true`. Piece, `settings.input`, notes e encadeamento ficam iguais. Exit 0 = tudo aplicado; exit 3 = algum recusado.

| Recusa | Motivo |
| --- | --- |
| `ainda_tem_marcador` | o texto ainda tem `AP-MIGRATION-TODO` |
| `codigo_vazio` | patch em branco |
| `sem_export_const_code` | falta `export const code =` |
| `step_nao_e_code` | o nome aponta para um step de piece |
| `unknown` | nome de step que não existe no flow |

Recusa é erro do patch, não do flow: corrigir o texto e rodar de novo. Não editar o `flow.json` à mão.

### 4. Conferir

```bash
node scripts/conferir-code-traduzido.mjs \
  --flow-json /tmp/transpilar/<card>/flow.json
```

Exit 0: nenhum `AP-MIGRATION-TODO`. `code-lib.json` lista os steps com pacote (`usedLib`). Exit 4: ainda há stub. Traduzir esses steps e aplicar de novo. Não devolver o flow com marcador.

### 5. Relato

Uma linha para o comentário de quem chamou (o transpile):

```
code: step_3 traduzido (csv para xlsx, lib xlsx); step_6 traduzido
```

Sem step de código: `code: nenhum stub`. Se `usedLib` for true, a linha inclui `lib: <pacotes>`.

## Não fazer

- Traduzir fórmula (`TODO_FORMULA`) ou mexer nos steps `formula_*`
- Mudar piece, `settings.input`, `notes` ou `nextAction`
- Transformar sticky note `REVISAR:` em step
- Editar `mappings/`, `kb/` ou `engine/`
- Anexar no card, mover fase, criar flow, `IMPORT_FLOW` ou publicar (é o transpile que segue)
- Deixar `AP-MIGRATION-TODO` no código traduzido
- Imprimir senha / `sk-`

## Estado observado

Formato do stub, `inputPath` e casos vistos: [reference.md](reference.md).
