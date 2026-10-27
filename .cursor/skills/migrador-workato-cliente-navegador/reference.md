# Referência — migrador cliente (com navegador)

Versão: **0.7.13**. Variante **com navegador** (`migrador-workato-cliente-navegador`). Kit vigente no GitHub: `https://github.com/pipefy/ipaas-migrator` (`main`, arquivo `VERSION`). A variante sem navegador (`migrador-workato-cliente`) saiu de linha em 23 set 2026 (última 0.4.3).

Tutor: instalação + atualização no GitHub + smoke → idioma (inferir) → API ou JSON → pipe → conexão → motor → Downloads do `*.flow.json` (com ok) → ok do Chrome → Import (verificar canvas) → ok do MCP Pipefy → teste.

## Pastas

| Onde | Como achar |
| --- | --- |
| Pack descompactado | pasta com `engine/run.ts` + `VERSION` + `PLAYBOOK.md` |
| Repo do kit | `github.com/pipefy/ipaas-migrator` (só este kit) |
| Só o `.tgz` | `migrador-workato-cliente-navegador*.tgz` no cwd, anexo ou pasta pai. Descompactar. |
| Helper interno | `workato_migrator_helper` — não clonar e não publicar |

O cliente **não** clona o GitLab do helper. O kit vigente é sempre o `main` de `github.com/pipefy/ipaas-migrator`. Paths de saída: `output/` (nunca `outputs/`).

## Versão no GitHub

No início, antes de anunciar o kit pronto e antes de traduzir:

```bash
node scripts/cliente-atualizar.mjs
```

GET público de `https://api.github.com/repos/pipefy/ipaas-migrator/contents/VERSION?ref=main`. Se `main` estiver mais novo, baixa o zip e troca os arquivos. Preserva `.env` e `output/`. Tenta de novo rede, zip, `npm ci` e smoke. Se o smoke ainda falhar, restaura a pasta.

| Campo | O que fazer |
| --- | --- |
| `translate: false` | Bloco `atualizacao-falhou`. Sem o sim, não traduzir. Sim: bloco `atualizacao-manual`. No retorno (`atualizei`, `updated`, `actualicé`), rodar de novo. |
| `updated: true` | Uma frase com `remote`. Seguir. Skill e smoke já rodaram. |
| `action: current` | GitHub em dia. Seguir. |
| `skipped: origem` | Pasta do helper. Não baixar. Seguir. |

`node scripts/cliente-versao.mjs` só compara. Não instala.

## Abrir o `.env`

```bash
node scripts/cliente-abrir-env.mjs
```

Copia `.env.example` → `.env` se faltar. Abre no editor do SO. Não imprime o conteúdo.

| SO | Editor |
| --- | --- |
| Windows | Bloco de notas (`notepad.exe`) |
| macOS | TextEdit (`open -e`) |
| Linux | `xdg-open` |

Token: **somente** `WORKATO_API_KEY`. Sem aspas, sem `Bearer `. Não ler `WORKATO_API` (OEM).

EU: `WORKATO_API_BASE=https://app.eu.workato.com/api`.

## API Workato (usuário, não OEM)

Base: `https://www.workato.com/api`. `Authorization: Bearer <token>`.

| Pedido | Path | Script |
| --- | --- | --- |
| Listar | `GET /recipes?exclude_code=true&per_page=100` | `--list` |
| Uma receita | `GET /recipes/:id` | `--id` |

Não usar `/managed_users/...`. Só GET.

## Diagnóstico (antes do Import)

```bash
node scripts/cliente-diagnostico.mjs --recipe output/<id>/recipe.json
```

Lê o JSON. Não chama Pipefy. Devolve gatilho, cron literal, pipes tocados, fases citadas, conexões. O pipe do Integrations pode ser outro.

## Motor

`scripts/transpilar-receita.mjs` → `npx tsx engine/run.ts`. Três JSON, um por linha: SHARED → `flow.json`; mermaid; `{status, destination}`. Cópia nomeada: `<slug>.flow.json`. `status.json` (arquivo / importacao / configuracao / logica / teste). PNG só com `mmdc` + Chrome local. Não envia o diagrama para fora. Mostre o PNG no chat. Sem PNG: siga sem diagrama; não entregue o `.mmd`.

Cite `files.flowNamed` (absoluto). Nunca `outputs/`.

Depois do arquivo, bloco `downloads`. Só com o sim:

```bash
node scripts/cliente-copiar-flow.mjs --file <path do *.flow.json>
```

Copia esse arquivo para Downloads. Não apaga o original. Recusa PNG.

Datapills Pipefy no `flow.json` (schema 20): `{{trigger['data']['card']['id']}}`, `{{trigger['data']['new_value']}}`, `{{step_1['data']['card']['current_phase']['id']}}`. Não reescrever para `output` nem para ponto. O iPaaS insere `['output']` no import. Ponto vira `{trigger['output'].data.card.id}` e quebra no GraphQL.

`--connection-ids` / `--hints-text` (`Conexão: <id>`) injeta `{{connections['<id>']}}` no flow. Sem listagem iPaaS, o id vai cru. Importe no pipe onde a conexão existe.

## Validação (depois do motor)

Roda a mesma verificação do treino do motor, no `flow.json` gerado. Não chama Pipefy. Não publica.

```bash
node scripts/verificar-transporte.mjs \
  --recipe output/<id>/recipe.json \
  --flow-json output/<id>/flow.json \
  --out output/<id>
```

Exit 0: sem `bloqueia`. Siga para Downloads sem comentar. Exit 3: há achado. Exit 2: arquivo. `info` não conta. `revisar` conta como pendência.

A pergunta ao cliente usa o bloco `validacao-pergunta`. No máximo 3 frases, depois "e mais N". Cada frase sai da tabela abaixo, no idioma da sessão. Nunca cite o `kind`, "piece", "datapill", "schema", "AP-MIGRATION-TODO" nem "Active Pieces". A pesquisa na web usa a documentação do Workato e a da plataforma de destino; a conversa fala "o Pipefy" ou "a plataforma de destino".

| kind | pt | en | es |
| --- | --- | --- | --- |
| `valid:false` | Um passo ficou com um campo obrigatório em branco. | A step was left with a required field blank. | Un paso quedó con un campo obligatorio en blanco. |
| `piece TODO` | Não achei um equivalente direto para uma ação do Workato. | I could not find a direct match for a Workato action. | No encontré un equivalente directo para una acción de Workato. |
| `action faltando` | Uma ação do Workato não tem passo correspondente. | A Workato action has no matching step. | Una acción de Workato no tiene paso correspondiente. |
| `TODO_pill` | Um campo dinâmico não foi convertido. | A dynamic field was not converted. | Un campo dinámico no se convirtió. |
| `TODO_FORMULA` | Uma fórmula não foi convertida. | A formula was not converted. | Una fórmula no se convirtió. |
| `AP-MIGRATION-TODO` | Um passo com código precisa de revisão. | A step with code needs a review. | Un paso con código necesita revisión. |
| `HTTP pad` | Uma chamada HTTP ficou incompleta. | An HTTP call was left incomplete. | Una llamada HTTP quedó incompleta. |
| `pill de erro` | A mensagem de erro de um passo não veio. | A step's error message did not come through. | El mensaje de error de un paso no llegó. |
| `python` | Um trecho em Python não virou código. | A Python snippet did not become code. | Un fragmento en Python no se volvió código. |
| outro | Um passo precisa de ajuste antes do teste. | A step needs a fix before the test. | Un paso necesita un ajuste antes de la prueba. |

O reparo, só com o sim, altera apenas `output/<id>/flow.json`. Duas tentativas por achado. Revalide ao fim de cada rodada. Sem inventar ação, sem `--force`, sem editar `engine/`, `mappings/` ou `kb/`. Datapill Pipefy continua com colchetes em `data`.

O que restar (ou se a pessoa disse não) vira nota amarela:

```bash
node scripts/cliente-anotar-flow.mjs \
  --flow-json output/<id>/flow.json \
  --transporte output/<id>/transporte.json \
  --lang pt
```

A nota ancora no passo do achado. Sem passo, ancora no gatilho. Rodar de novo não duplica. Depois, bloco `validacao-restou`.

Smoke da instalação:

```bash
node scripts/transpilar-receita.mjs --recipe examples/smoke.recipe.json --out .tmp/smoke
```

No helper interno o fixture também está em `docs/cliente/smoke.recipe.json`. Sem `ok: true` e sem arquivo no disco, o kit não está pronto.

## Importação

Print: `importar/01-integrations-import.png` (helper: `docs/cliente/importar/01-integrations-import.png`). Não chama `IMPORT_FLOW`.

Chrome do agente só depois do ok. Depois de cada clique: snapshot. O título no canvas tem que ser **esta** receita. Iframe: Take Control + handoff, depois retome. Não publique.

## MCP Pipefy

Depois do login no Chrome: bloco `mcp-pipefy` em copy.md (o que é, como ajuda, ok). `mcp_auth` em `user-pipefy`. Probe `list_organizations` ou `search_pipes`. Cruzar fases com `get_pipe`. Sem ok / `needsAuth` / ausente: tutor continua. Sem Bituca, DevTools, MCP de iPaaS.

Tokens “24 horas” na UI da Service Account = validade do token gerado, não da conta.

## Pack

Esse comando existe só no helper (`workato_migrator_helper`), não no kit publicado.

```bash
node scripts/pack-cliente.mjs --variant navegador
# dist/migrador-workato-cliente-navegador-0.7.13.tgz
```

`npm run pack-cliente` gera só este pack. `--variant sem` recusa (kit descontinuado).

Não leva skills internas, `.env`, Bituca, nem `AGENTS.md`.
