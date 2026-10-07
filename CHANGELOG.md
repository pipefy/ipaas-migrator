# Changelog do migrador cliente

Kit que a pessoa instala no Cursor, Claude Code ou Codex, traduz a receita na máquina dela e importa o `flow.json` no iPaaS. Não cria card, não publica e não usa o pipe interno de migração.

Há dois arquivos no histórico. O kit sem navegador saiu de linha em 23 set 2026 (última 0.4.3). O número é o `VERSION` dentro do `.tgz` em `dist/`.

| Kit | Versão atual | Arquivo |
| --- | --- | --- |
| Com navegador (vigente) | 0.6.6 | [github.com/pipefy/ipaas-migrator](https://github.com/pipefy/ipaas-migrator) `main` |
| Sem navegador | descontinuado (0.4.3) | não empacota mais |

O Cloud Agent e as skills do pipe interno têm outro histórico, no repositório: `docs/CHANGELOG.md`.

Cada bloco abaixo descreve o tarball daquela data. O motor dentro do pacote é a foto do repositório na hora do `npm run pack-cliente`. O kit vigente para quem migra é o `main` de [github.com/pipefy/ipaas-migrator](https://github.com/pipefy/ipaas-migrator).

## 0.6.6 — 7 out 2026

O kit passa a levar a skill que reescreve o passo de código e os scripts que ela chama. O motor desta leva trata variável escalar, lista, CSV, Docs, GraphQL, template e tabelas do Workato.

- Entram `migrador-workato-traduzir-code`, `listar-code-stubs.mjs`, `aplicar-code-traduzido.mjs` e `conferir-code-traduzido.mjs`. O instalador copia essa skill junto com a de tirar dependência npm. No kit cliente os arquivos da receita ficam em `output/<id>/`.
- Variável escalar vira um `put` por campo. Lista do Workato sai com `items`.
- CSV cabe numa função só, para o sandbox do passo de código. BOM no início do arquivo sai antes do parse.
- Google Docs com `requests` vira `batchUpdate`. Google Sheets copia `columns` para `values`. Outlook copia o fuso do evento.
- GraphQL de registro, campos e card vira chamada no Pipefy. Message template e SOAP deixam nota: o corpo do template não está na receita.
- Data table e lookup table deixam nota: a tabela do iPaaS não herda o id nem as linhas.
- `migrador-workato-cliente-navegador-0.6.6.tgz`

## 0.6.5 — 6 out 2026

Planilha, Drive, calendário, Docs, Outlook, Entra, QuickBooks e o delete da lookup table passam a preencher as props que a receita já trazia.

- Google Sheets aceita `spreadsheet` ou `spreadsheet_id`, e `sheet` ou `sheet_name`.
- Drive copia arquivo, e-mail, papel e pasta. Calendar copia o calendário, a busca e o intervalo. Docs copia o documento.
- Outlook copia calendário, título e horário ao criar, listar ou apagar evento. Membros de grupo do Entra copiam o grupo.
- QuickBooks copia cliente, fornecedor, documento, datas e contas em invoice, bill, expense e vendor. Delete de lookup table copia a tabela e os ids.
- `migrador-workato-cliente-navegador-0.6.5.tgz`

## 0.6.4 — 6 out 2026

Repeat while com lista ou teto de voltas vira loop. Sleep com unidade vira espera. O Python que só sorteia nove dígitos sai traduzido.

- Repeat while que compara índice com o tamanho da lista, ou que tem um teto de voltas, vira `LOOP_ON_ITEMS`. A nota amarela `AVISO: repeat adaptado` diz o que mudou. Paginação, espera de relatório e espera de flag deixam o corpo em seguida, uma vez, com a mesma nota.
- `sleep 2.minutes` (e as outras unidades) vira espera em segundos. `sleep rand(...)` vira passo de código que sorteia na execução. `sleep(30);` continua espera.
- Python que só sorteia um número de nove dígitos (`randint(100000000, 999999999)`) vira o mesmo passo em JavaScript.
- Busca de registros da base Pipefy copia organização, tabela e o flag de concluídos para as props da peça.
- `migrador-workato-cliente-navegador-0.6.4.tgz`

## 0.6.3 — 5 out 2026

O modal do Slack que abre a view vira `views.open`, `views.update` ou `views.push`. Propriedade de projeto vira variável do iPaaS e o canvas lista o que criar.

- `block_kit_modals` (Slack e Slack bot) deixa de ser o trigger New Modal Interaction. Esse trigger começa um flow quando a pessoa envia ou fecha o modal; não abre o modal. O passo que abre sai como `custom_api_call`.
- A nota `AVISO: modal virou callback` lembra que os campos preenchidos saem nesse trigger, não na resposta do POST.
- Propriedade de projeto vira `{{variables['NOME']}}`. A nota `AVISO: variáveis` lista conta, projeto, token no código e credencial Omie.
- `migrador-workato-cliente-navegador-0.6.3.tgz`

## 0.6.2 — 5 out 2026

HTTP com conexão na Workato ganha nota amarela no canvas pedindo para recriar a autenticação. Pill interna do motor sai em colchete e o mapa ganha ajustes de prop.

- Step HTTP de receita com conexão Workato sai com a nota `REVISAR: conexão`. O piece HTTP do iPaaS não importa conexão e o step sai com `authType: "none"`.
- Pill interna (`formula_1.f1`, `loop_2.item['id']`) sai em colchete, sem virar `['output'].f1` no import.
- Uma prop do iPaaS pode juntar várias da Workato (Dropbox `path` = pasta + nome). Propriedade de conta Workato vira variável `{{variables['NOME']}}`.
- 108 operações do mapa com prop, `fixedProps` ou nota ajustados.
- `migrador-workato-cliente-navegador-0.6.2.tgz`

## 0.6.1 — 5 out 2026

O compilador de fórmulas cobre mais Ruby e resolve a fórmula só depois de o passo receber todas as props. Fórmula constante é avaliada na tradução e deixa de gerar passo de código.

- Fórmula sem pill que dá valor fixo vira o valor no campo, sem passo de código.
- `strftime` respeita o fuso. Índice negativo em lista, `where` com nulo, `to_currency` com unidade, precisão e separador, e `decode_base64` entram no catálogo. Código de país vira ISO.
- Comparar pill com literal numérico aceita a string numérica do outro lado e deixa nota.
- A fórmula espera os preenchimentos do passo (cabeçalhos, `searchValue`, props copiadas). Antes, isso criava um passo de código órfão.
- `migrador-workato-cliente-navegador-0.6.1.tgz`

## 0.6.0 — 1 out 2026

Fórmulas que ainda ficavam para revisar passam a sair prontas. Telefone de 12 dígitos vira um passo de código. Update de card sem nenhum campo não entra no fluxo: o canvas segue e uma nota guarda o passo original.

- Mês por extenso, horas, percentual, data de N dias atrás, `strftime`, início do mês e `split` entram no catálogo.
- Telefone com 12 dígitos ganha um 9 depois dos quatro primeiros. Outro comprimento fica igual.
- Código Python ou JavaScript da Workato aparece dentro do passo de código, junto do Ruby.
- Update sem valor de campo não é importado. A nota traz o número e o comentário do passo. Os campos vazios não apagam o que já está no card.
- Um passo sem mapa manda a receita para revisão, e o arquivo ainda traz os passos que já traduzem.
- `migrador-workato-cliente-navegador-0.6.0.tgz`

## 0.5.14 — 30 set 2026

O catch da Workato deixa de ser um router no fim do bloco. Cada passo do try segue quando dá certo e, se falha, executa o catch. O que vem depois do try só entra nesse sucesso.

- Uma falha não executa os passos seguintes do mesmo try.
- Se o catch termina em parar, esse caminho acaba no passo Parar.
- `migrador-workato-cliente-navegador-0.5.14.tgz`

## 0.5.13 — 29 set 2026

Antes de traduzir, o kit instala a versão mais nova do GitHub e tenta corrigir falha de rede, dependência ou smoke. Se não conseguir, pergunta e só então guia a atualização manual. Não traduz nessa espera.

- A primeira pergunta da receita é API do Workato ou JSON. O pipe vem depois.
- A conexão vem antes do convite de importar.
- Com o `*.flow.json` pronto, o tutor pergunta se pode copiar só esse arquivo para Downloads. O PNG não vai.
- O pill `cards_count` de `get_cards_by_field` sai como `count` da lista `data.cards`.
- `phase_id` `"0"` (formulário inicial) vira o id da fase cujo rótulo bate com o dropdown, no mesmo pipe.
- Campos de fase e do formulário inicial saem com o schema que o canvas desenha.
- `return_result` e `call_recipe` não geram um passo de código extra.
- Planilha (xlsx para csv) sai sem pacote npm e sem `Buffer`. `encode_base64` também.
- `stop` vira o passo Parar (`stopFlow`). O fluxo segue só no caminho que não parou.
- `migrador-workato-cliente-navegador-0.5.13.tgz`

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
