# Referência — migrador cliente (com navegador)

Versão: **0.5.11**. Variante **com navegador** (`migrador-workato-cliente-navegador`). Kit vigente no GitHub: `https://github.com/pipefy/ipaas-migrator` (`main`, arquivo `VERSION`). A variante sem navegador (`migrador-workato-cliente`) saiu de linha em 23 set 2026 (última 0.4.3).

Tutor: instalação + versão no GitHub + smoke → idioma (inferir) → chave ou arquivo → diagnóstico → motor → ok do Chrome → Import (verificar canvas) → ok do MCP Pipefy → conexões → teste.

## Pastas

| Onde | Como achar |
| --- | --- |
| Pack descompactado | pasta com `engine/run.ts` + `VERSION` + `PLAYBOOK.md` |
| Repo do kit | `github.com/pipefy/ipaas-migrator` (só este kit) |
| Só o `.tgz` | `migrador-workato-cliente-navegador*.tgz` no cwd, anexo ou pasta pai. Descompactar. |
| Helper interno | `workato_migrator_helper` — não clonar e não publicar |

O cliente **não** clona o GitLab do helper. O kit vigente é sempre o `main` de `github.com/pipefy/ipaas-migrator`. Paths de saída: `output/` (nunca `outputs/`).

## Versão no GitHub

No início, antes de anunciar o kit pronto:

```bash
node scripts/cliente-versao.mjs
```

GET público de `https://api.github.com/repos/pipefy/ipaas-migrator/contents/VERSION?ref=main`. Compara com o `VERSION` local (no helper, `CLIENT_VERSION`).

| Campo | O que fazer |
| --- | --- |
| `update: true` | Avisar `local`, `remote` e `repo`. Seguir a jornada. Não baixar nem sobrescrever a pasta. |
| `update: false` e `ok: true` | GitHub em dia. Seguir. |
| `ok: false` | Uma linha (rede ou versão ilegível). Seguir. |

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

Datapills Pipefy no `flow.json` (schema 20): `{{trigger['data']['card']['id']}}`, `{{trigger['data']['new_value']}}`, `{{step_1['data']['card']['current_phase']['id']}}`. Não reescrever para `output` nem para ponto. O iPaaS insere `['output']` no import. Ponto vira `{trigger['output'].data.card.id}` e quebra no GraphQL.

`--connection-ids` / `--hints-text` (`Conexão: <id>`) injeta `{{connections['<id>']}}` no flow. Sem listagem iPaaS, o id vai cru. Importe no pipe onde a conexão existe.

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
# dist/migrador-workato-cliente-navegador-0.5.11.tgz
```

`npm run pack-cliente` gera só este pack. `--variant sem` recusa (kit descontinuado).

Não leva skills internas, `.env`, Bituca, nem `AGENTS.md`.
