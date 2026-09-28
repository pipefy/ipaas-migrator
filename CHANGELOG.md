# Changelog do migrador cliente

Kit que a pessoa instala no Cursor, Claude Code ou Codex, traduz a receita na máquina dela e importa o `flow.json` no iPaaS. Não cria card, não publica e não usa o pipe interno de migração.

Há dois arquivos no histórico. O kit sem navegador saiu de linha em 23 set 2026 (última 0.4.3). O número é o `VERSION` dentro do `.tgz` em `dist/`.

| Kit | Versão atual | Arquivo |
| --- | --- | --- |
| Com navegador (vigente) | 0.5.12 | [github.com/pipefy/ipaas-migrator](https://github.com/pipefy/ipaas-migrator) `main` |
| Sem navegador | descontinuado (0.4.3) | não empacota mais |

O Cloud Agent e as skills do pipe interno têm outro histórico, no repositório: `docs/CHANGELOG.md`.

Cada bloco abaixo descreve o tarball daquela data. O motor dentro do pacote é a foto do repositório na hora do `npm run pack-cliente`. O kit vigente para quem migra é o `main` de [github.com/pipefy/ipaas-migrator](https://github.com/pipefy/ipaas-migrator).

## 0.5.12 — 28 set 2026

Planilha no code step declara o pacote `xlsx`. A skill `migrador-workato-sem-dependencia` reescreve esse passo sem pacote, quando o ambiente não instala npm.

- Python que lê xlsx e devolve csv sai com `xlsx` 0.18.5.
- A skill e o script `sem-dependencia.mjs` entram no kit.
- `migrador-workato-cliente-navegador-0.5.12.tgz`

## 0.5.11 — 25 set 2026

O tutor não muda. O motor traduz o que a 1.12.3 fechou no migrador oficial.

- Índice de lista (`pill[0]`, `pill[0]['campo']`) fica na datapill. Não vira Code JS.
- IFs irmãos viram um router que entra em todos os que casam. if / elsif / else entra só no primeiro.
- Catch que só para o job com erro: a continuação fica no Success do passo e o erro no Failure (`failFlow`). Catch que atualiza card, manda e-mail ou avisa no Slack continua no router do fim.
- `migrador-workato-cliente-navegador-0.5.11.tgz`

## 0.5.10 — 25 set 2026

O tutor fala menos. O diagnóstico deixa de tratar conector Pipefy de outra org como externo.

- Conector Pipefy: nome com `pipefy`, ou o OEM `new_connector_6`. Google Docs, Azure AD, WhatsApp, PDF e Omie não entram.
- Duas contas da mesma peça (Slack, planilha) não usam a mesma conexão. A configuração fica pendente. Pipefy segue uma service account.
- Pipe no GraphQL sai de `pipe(id:)` ou `pipe_id`, sem assumir a org 28.
- Sem argumentos, o transpile pede o uso. ID só digitado não aparece como conexão ligada.
- A lista de receitas diz quando o teto cortou o resultado.
- O chat pede o próximo passo em uma ou duas frases. Detalhe técnico só se a pessoa pedir ou se a etapa travar.
- `migrador-workato-cliente-navegador-0.5.10.tgz`

## 0.5.9 — 24 set 2026

O tutor não muda. O motor traduz o que a 1.12.1 fechou no migrador oficial.

- Email by Workato e SMS by Workato não viram SMTP, Gmail nem Twilio. Nota no canvas. O transpile termina em revisão manual.
- Base Pipefy (`create_record`, `record_field_update`) manda o id da tabela e os campos soltos. Lookup table do Workato não é essa base.
- PipeSign `getDocument` é POST GraphQL na Autentique, com nota `REVISAR: pipesign`.
- `js_eval` com `exports.main` e o Python de ids de nós saem em Code JS.
- Planilha com `is_top_left` e `col_N` sem cabeçalho sai com `first_row_headers` false.
- Data com `.days`, `.months` e `.years` entra no catálogo. `%` desconhecido (ex. `%03`) continua fórmula para revisar.
- `present?` e documento `mutation` / `query` compilam. Repeat while pelo índice da lista vira loop. Lista vazia não entra.
- Passo desligado não entra no canvas. `stop` encerra o ramo. `valid` do passo mapeado segue só a prop obrigatória. `ADD` de lista aceita pill no valor.
- `migrador-workato-cliente-navegador-0.5.9.tgz`

## 0.5.8 — 23 set 2026

O tutor não muda. O motor traduz o que a 1.12.0 fechou no migrador oficial.

- `parse_csv` sai como Code JS com as colunas nomeadas. `create_csv_lines` continua no piece-csv.
- `piece-pipefy` sai em `0.2.4` e `piece-subflows` em `0.7.0`.
- `updateFieldsValues` com um `ADD` vira `updateListField`.
- Variável Workato vai para o Storage, escopo Run. Lista é `add_to_list` de strings JSON.
- `try/catch` vira um router no fim do bloco. A mensagem aponta para `['error']['message']`.
- Logger, lista vazia, XLSX lido em Python e busca de card com `include_done` false saem em Code JS puro.
- HTTP preenche headers, query e auth. Arquivo compactado usa a prop `file`.
- Fórmula com `#{...}` compila.
- `migrador-workato-cliente-navegador-0.5.8.tgz`

## 0.5.7 — 23 set 2026

Recipe function sai como subflow (`callableFlow`, `callFlow`, `returnResponse`) em mode `simple`. O `flowId` do call continua o id da Workato. Nota no canvas para trocar pelo externalId no iPaaS.

- `migrador-workato-cliente-navegador-0.5.7.tgz`

## 0.5.6 — 23 set 2026

No início, o agente compara o `VERSION` local com o arquivo `VERSION` em `main` no GitHub. Se o GitHub estiver mais novo, avisa e segue. Falha de rede não trava a instalação.

A doc pública (PT e EN) manda abrir esse repositório, sem fixar o nome de um `.tgz`.

- `migrador-workato-cliente-navegador-0.5.6.tgz`

## 0.5.5 — 23 set 2026

O tutor não muda. O diagrama em PNG sai só na máquina (`mmdc` + Chrome). O kit não envia o Mermaid para kroki.io. Sem Chrome ou sem `mmdc`, segue sem PNG.

- `migrador-workato-cliente-navegador-0.5.5.tgz`

## Descontinuado — kit sem navegador — 23 set 2026

O pack `migrador-workato-cliente` (print + clique) sai de linha. Última versão: **0.4.3**.

- Kit vigente: `migrador-workato-cliente-navegador-0.5.4.tgz`.
- `npm run pack-cliente` gera só o pack com navegador. `--variant sem` recusa.
- A skill `/migrador-workato-cliente` vira stub e manda para `/migrador-workato-cliente-navegador`.
- Playbook e README da variante sem navegador ficam no repo como histórico.

## 0.4.3 e 0.5.4 — 23 set 2026

Os dois kits. O tutor não muda. O motor é o da 1.8.0. O passo `Repeat while` → `LOOP_ON_ITEMS` fica no migrador oficial; este kit não traz essa skill.

- Sem navegador: `migrador-workato-cliente-0.4.3.tgz`
- Com navegador: `migrador-workato-cliente-navegador-0.5.4.tgz`
- `*` vira multiplicação numérica, com nota. No Ruby, string `*` n repete o texto.
- `.to_currency(unit:, precision:, separator:)` vira `replace(format_currency(valor; unidade); "."; separador)`, com nota. O milhar continua vírgula. `delimiter` diferente de vírgula não entra.
- `.match?` de texto literal, sem flag e sem metacaractere, vira `contains`.

## 0.4.2 e 0.5.3 — 23 set 2026

Os dois kits. O tutor não muda. O motor é o da 1.7.0.

- Sem navegador: `migrador-workato-cliente-0.4.2.tgz`
- Com navegador: `migrador-workato-cliente-navegador-0.5.3.tgz`
- Fórmula que fica `TODO_FORMULA` ganha nota com o texto da receita e o passo.
- Passo desligado sem app não vira piece TODO.
- Omie sem URL sai com o endpoint. Token literal vira variável do projeto.

## 0.4.1 e 0.5.2 — 22 set 2026

Os dois kits. O tutor não muda. O motor dentro do `.tgz` passa a gravar a datapill com colchetes.

- Sem navegador: `migrador-workato-cliente-0.4.1.tgz`
- Com navegador: `migrador-workato-cliente-navegador-0.5.2.tgz`
- Formato: `{{trigger['data']['card']['id']}}`, `{{trigger['data']['new_value']}}`, `{{step_1['data']['card']['current_phase']['id']}}`
- O import insere `['output']`. Ponto vira `{trigger['output'].data.card.id}` e quebra no GraphQL.

## 0.5.1 — 21 set 2026 — só com navegador

Empacotado de manhã. A variante sem navegador permanece 0.4.0.

- Datapill de Pipefy no `flow.json` passa a usar a chave `data`, com ponto: `{{trigger.data.card.id}}`, `{{trigger.data.new_value}}`, `{{step_1.data.card.current_phase.id}}`.
- No import, o iPaaS (Activepieces a partir de 0.85.4) coloca `['output']` em volta. A chave que o GraphQL lê continua `data`.
- O texto da skill desta versão ainda documenta esse formato com ponto.

## 0.5.0 — 18 set 2026 — só com navegador

Resposta ao uso real: o tutor devolvia clique para a pessoa mesmo depois de ela pedir para o agente fazer.

- A instalação só anuncia “kit pronto” depois do smoke (`examples/smoke.recipe.json`).
- Antes do Import, um diagnóstico lê a receita (gatilho, cron, pipes, fases, conexões) sem chamar a API do Pipefy.
- O agente traduz quando a pessoa pede. Pergunta aberta fica para decisão de efeito externo: abrir o Chrome, ligar o MCP, publicar.
- O Chrome do agente abre depois do ok. O MCP Pipefy entra depois do login, com um bloco que explica o que faz. Sem o ok, o tutor segue no print.
- Estado da sessão em cinco campos: arquivo gerado, importação confirmada, configuração incompleta, lógica pendente, teste validado.
- O diagrama sai em PNG (`mmdc`). O arquivo do flow tem nome legível (`<slug>.flow.json`) em `output/`.

## 0.4.0 — 18 set 2026 — os dois kits

- O chat aceita `Conexão: <id>` (id da conexão iPaaS). O `flow.json` já sai com `{{connections['<id>']}}`.
- Playbooks e as páginas públicas (PT e EN) passam a explicar esse atalho.
- O motor do pacote já traz variáveis Workato, delay e o recorte de fórmula Ruby (entraram em 0.3.0 e 0.2.0).

## 0.3.0 — 18 set 2026 — tutor e duas variantes

- O agente vira tutor da jornada inteira: instalar, idioma, chave ou arquivo, traduzir, importar, conexões, teste.
- A primeira pergunta humana é o idioma: português, English ou español.
- Dois packs: sem navegador (print e clique) e com navegador (Chrome do agente só depois do ok).
- MCP do Pipefy só se a pessoa entrar no Chrome e autorizar. O pack não leva Bituca, MCP de iPaaS nem Chrome DevTools.
- Variável Workato no motor do pacote: valor que não muda vira step CODE; escrita em cadeia reta aponta para a última escrita; escrita dentro de loop ou ramo usa Storage com escopo Run.

## 0.2.0 — 17 set 2026

- Ordem fixa: instala, pergunta a fonte, age.
- Chave do API client abre o `.env` no editor do sistema (Bloco de notas, TextEdit ou `xdg-open`). O token não entra no chat.
- Arquivo: a pessoa envia os `.json`.
- No fim, o agente mostra o print anotado: pipe, Integrations, Import.
- Entram as páginas para Help Center e Developers (`docs/migrar-receitas-workato.md` e `docs/migrate-workato-recipes.md` dentro do pack).
- `sleep` e `N.seconds.from_now` viram o delay do iPaaS. Um recorte de fórmula Ruby vira JavaScript no step. Ruby fora desse recorte continua marcado para revisão.

## 0.1.0 — 15 set 2026

Primeiro kit, no recorte da call com CS.

- Motor, mapas, skill e playbook num `.tgz`. Sem skills do pipe interno, sem `AGENTS.md`, sem `.env`.
- A pessoa manda um `.json` ou um id com `WORKATO_API_KEY`.
- Saída: `flow.json`, diagrama e descrição. A importação é manual, no pipe que ela escolher.
- A API usada é a do workspace (`GET /api/recipes`), com a chave dela.

## De onde saiu

Versões fechadas no chat Client version of migrator (`8fdc4335-9b7e-4ff0-87fb-2dfe5bd7624c`). O `Conexão: <id>` e o salto para 0.4.0 vieram de Connection setup and migration (`54e4a1e0-9672-4719-8f14-53912b359455`). A troca de `output` por `data` veio de Datapill mapping issue (`a47add13-c8d4-4ae9-aa5b-f66b9f37c953`).
