---
name: migrador-workato-cliente-navegador
description: "Tutor 0.5 do kit cliente com navegador (kit vigente). Instala e só anuncia pronto após smoke. Traduz, diagnostica pipes/fases, importa no Chrome do agente depois do ok, oferece MCP Pipefy após o login. Aceita Conexão: <id>. Use when the user invokes /migrador-workato-cliente-navegador, /migrador-workato-cliente, or says \"migrar receita\", \"instale o migrador\", \"install the migrator\", \"migrador cliente\", \"quero migrar\", \"migrar receita com navegador\", \"instale o migrador com navegador\", \"importa essa receita\", or cola \"Conexão: <id>\"."
disable-model-invocation: true
---

# Migrador Workato (cliente) v5 — com navegador

Você **executa** a jornada. O cliente decide o processo (qual receita, qual pipe, se liga MCP). Não descobre sozinho path, install ou onde clicar.

Pergunte só se o destino é ambíguo, falta um dado, ou a ação tem efeito externo (atualizar na mão, copiar para Downloads, abrir o navegador, OAuth, publicar).

Se a atualização falhar, não traduza. Pergunte se pode atualizar na mão. Sem o sim, pare.

Com a versão em dia, a primeira pergunta da receita é API do Workato ou JSON. O pipe vem depois. A conexão vem antes de sugerir o import. O `*.flow.json` só vai para Downloads com o sim. O PNG não vai.

“Importa essa receita” com o JSON já no chat não pergunta a fonte de novo. Ainda pergunta o pipe, se não veio, e a conexão, se não veio `Conexão: <id>`. Não abre o Import nesse turno.

O Chrome do agente **só abre depois do ok**. MCP Pipefy **só depois do login e de outro ok**, com o bloco que explica o que é e como ajuda. Sem Bituca, sem MCP de iPaaS, sem Chrome DevTools no pack.

Textos: [copy.md](copy.md). Detalhe: [reference.md](reference.md).

Não cria card. Não publica. Não usa OEM. Não cola segredo no chat.

Invocar **autoriza** descompactar o `.tgz`, `npm ci`, `instalar-cliente.mjs --navegador`, `cliente-atualizar.mjs` (baixa o zip de `main` em `github.com/pipefy/ipaas-migrator` e troca o kit, preservando `.env` e `output/`), smoke do motor, abrir `.env`, GET Workato, ler `.env` (sem imprimir), copiar o `*.flow.json` para Downloads depois do ok, abrir o navegador do agente depois do ok, e `mcp_auth` em `user-pipefy` depois do ok do MCP.

## Tom

Fale com quem usa o Pipefy, não com quem mantém o motor. Uma ou duas frases. Uma pergunta por vez, só se for decisão (qual receita, qual pipe, qual conexão, copiar para Downloads, abrir o navegador).

Não abra com kit, peça, datapill, MCP, auth, flow, schema ou destino interno. Diga o que a pessoa faz agora.

- Idioma: inferir do chat (já falou PT → `pt`). Perguntar só se ambíguo.
- Códigos (`manual_revision`, `mapped`, `blocked_reason`, path, id de conexão) só se ela pedir “detalhes” ou se a etapa travou. Aí uma linha do que houve e o próximo passo.
- Nunca escrever `outputs/` (não existe). O arquivo que você cita é o `files.flowNamed`, conferido com `ls`.
- Não anunciar “kit pronto” sem smoke. Arquivo gerado não é automação pronta: o próximo passo é importar, conferir conexões e testar.

## Estado da sessão

Não comece cada mensagem com bloco técnico. Guarde para você:

```
receita: <nome> (<id>)
etapa: <fonte | pipe | conexao | arquivo | downloads | importacao | teste>
arquivo: <path absoluto do *.flow.json>
```

Se ela pedir detalhes, mostre esse bloco. Trocar de receita só com pedido explícito. Não misturar canvas da automação anterior.

## Status (nunca misturar)

Em toda atualização, os cinco. Sem evidência, deixe em aberto.

| Campo | Só marca sim quando |
| --- | --- |
| Arquivo gerado | `ls` do path absoluto ok |
| Importação confirmada | snapshot/URL do canvas **desta** receita |
| Configuração incompleta | falta conexão, pipe hospedeiro ou fase |
| Lógica pendente | restou achado na validação (`bloqueia` ou `revisar`), `AP-MIGRATION-TODO`, Ruby, CODE ou `manual_revision` |
| Teste validado | viu run ou evento real |

Não use “sem bloqueios” / “sem pendências técnicas” como pronto. Contagem de operações mapeadas não prova que funciona.

## Workflow

```
- [ ] 1. Instalação + atualizar se o GitHub estiver mais novo + smoke
- [ ] 2. Idioma (inferir; perguntar só se ambíguo)
- [ ] 3. Fonte: API do Workato ou JSON. Parar. Não pedir o pipe.
- [ ] 4. Diagnóstico. Pedir o pipe. Parar.
- [ ] 5. Conexão. Parar. Só então o motor.
- [ ] 5b. Validar o flow.json. Limpa: seguir. Com achado: perguntar. Parar.
- [ ] 5c. Só com o sim: tentar resolver no flow.json e validar de novo.
- [ ] 5d. O que restou (ou o não): nota adesiva no passo e aviso.
- [ ] 6. Downloads: só o *.flow.json, com o sim. O PNG fica.
- [ ] 7. Pedir navegador (ok) → Import (verificar resultado)
- [ ] 8. Após login: pedir MCP Pipefy (explicar + ok)
- [ ] 9. Teste. Não publicar
```

### 1. Instalação

Em silêncio, nesta ordem. **Não** diga instalado no meio.

| Probe | Se faltar |
| --- | --- |
| Motor: `engine/run.ts` + `scripts/transpilar-receita.mjs` | A pasta tem que ser o kit de `https://github.com/pipefy/ipaas-migrator` (`main`). Se só houver `.tgz`, descompactar. Sem kit: pedir para abrir esse GitHub. **Parar.** Não clonar GitLab. |
| `node -v` ≥ 18.17 | Pedir Node ou TI. **Parar.** |
| `node_modules/.bin/tsx` | `npm ci` na raiz do pack. Falhou → **parar.** |
| Skill | `node scripts/instalar-cliente.mjs --navegador` |
| Versão | `node scripts/cliente-atualizar.mjs`. O script tenta de novo rede, zip, `npm ci` e smoke. Preserva `.env` e `output/`. Se falhar, restaura o kit. |
| Smoke | Se o script não atualizou (`updated` ausente ou false), rode `node scripts/transpilar-receita.mjs --recipe examples/smoke.recipe.json --out .tmp/smoke`. Se o fixture não estiver em `examples/`, use `docs/cliente/smoke.recipe.json`. Sem `ok: true` e sem `files.flow` no disco: **não** anunciar pronto. |

`translate: false`: uma frase do `reason` e o bloco `atualizacao-falhou`. **Parar.** Não busque receita e não rode o motor.

- **Sim:** bloco `atualizacao-manual`. Quando ela disser `atualizei`, rode `cliente-atualizar.mjs` de novo.
- **Não:** pare. Não traduza nesta versão.

`skipped: origem`: esta pasta é a origem do kit. Não baixe. Siga.

`updated: true`: a primeira frase é que atualizou para `remote`. O script já rodou skill e smoke.

Se o GitHub está em dia, anuncie:

```
kit pronto  (migrador cliente <local>, com navegador)

------

node: <versão>
dependências: ok
smoke: ok
skill: instalada
github: em dia | atualizado para <remote>
```

### 2. Idioma

Se o chat já está em PT/EN/ES: grave e siga. Senão: bloco `Idioma` em copy.md. **Parar.**

### 3. Fonte

Se já mandou JSON, ID ou “usa a chave”: não pergunte. Senão bloco `fonte`. **Parar.** Não pergunte o pipe neste turno.

### 4. Pipe

Com a receita no disco, rode o diagnóstico e mostre o resumo. Pergunte o pipe. **Parar.** Não fale de importar.

```bash
node scripts/cliente-diagnostico.mjs --recipe output/<id>/recipe.json
```

Mostre o resumo em linguagem de quem usa o pipe (preencha com o JSON, sem inventar):

```
A receita <nome> usa <Pipefy, Slack, …>.
Ela começa quando <evento em uma frase>. Lê <pipe ou “não identifiquei o pipe”> e altera <pipe>.
Em qual pipe a automação deve ficar?
```

Se houver revisão: `Há <N> etapas para revisar antes do teste.` Sem revisão, não fale de TODO, Ruby ou CODE.

Se não deu para preparar a importação: `Não consegui preparar esta automação. Revise: <operação e o que fazer>.` O código fica em “detalhes”.

### 5. Conexão, depois o motor

Bloco `conexao-antes`. **Parar.** Sem `Conexão: <id>` e sem “conexão pronta”, não rode o motor.

Se o id já veio no chat, não pergunte de novo: confirme o id e rode o motor.

Não diga que a conexão está ligada. Não sugira importar neste turno.

```bash
node scripts/transpilar-receita.mjs \
  --recipe output/<id>/recipe.json \
  --out output/<id>
```

`Conexão: <id>` no chat: acrescente `--connection-ids` e `--hints-text`.

Antes do motor terminar o arquivo que a pessoa vai importar, diga o bloco `traduzindo-code`. Rode o segundo passo: [traduzir-code](../migrador-workato-traduzir-code/SKILL.md) em todo `AP-MIGRATION-TODO`. Lib no `packageJson` quando o código precisar. Depois:

```bash
node scripts/conferir-code-traduzido.mjs \
  --flow-json output/<id>/flow.json
```

Exit 4: a etapa ainda não acabou. Não mostre o rascunho. Exit 0 e `usedLib: true` em `code-lib.json`: bloco `code-com-lib`, com o caminho do `*.flow.json`. O comando sem lib é `npx tsx scripts/sem-dependencia.mjs --flow-json <esse arquivo>`.

Confira no disco `files.flowNamed` (ex. `.../alerta-mr-sem-revisores.flow.json`). Cite **esse** path. Leia `status.json`. Mostre PNG se `png.ok`.

`O rascunho foi gerado.` Não diga para importar ainda.

Não editar `mappings/`, `kb/`, `engine/`. Não `--force`.

### 5b. Validar

Depois do arquivo no disco, antes de Downloads:

```bash
node scripts/verificar-transporte.mjs \
  --recipe output/<id>/recipe.json \
  --flow-json output/<id>/flow.json \
  --out output/<id>
```

Exit 3 é achado, não falha de ferramenta. Exit 2: uma linha do que houve e pare.

Sem `bloqueia` e sem `revisar` (`info` não conta): siga para o passo 6. Não fale da validação. Validador limpo não é "sem pendências" nem teste validado.

Com achado: bloco `validacao-pergunta`. No máximo 3 frases, da tabela em [reference.md](reference.md). O resto vira "e mais N". **Parar.** Não cite `kind`, peça, datapill, schema, `AP-MIGRATION-TODO` nem "Active Pieces".

### 5c. Tentar resolver

Só com o sim. Sem o sim, vá ao 5d.

Bloco `validacao-tentando`. Para cada achado `bloqueia`, depois cada `revisar`, na ordem do `transporte.json`:

1. Leia o trecho daquele passo no `recipe.json` e o step emitido no `flow.json`.
2. Pesquise na web a ação no Workato e o equivalente na plataforma de destino. Não diga ao cliente o nome da documentação consultada.
3. Corrija só `output/<id>/flow.json`: nome de campo, campo obrigatório, fórmula em JavaScript, troca de ação só quando a ação já existe. Sem inventar ação, sem `--force`, sem editar `engine/`, `mappings/` ou `kb/`.
4. Datapill Pipefy continua em colchetes: `{{trigger['data']['card']['id']}}`. Não reescreva para `output` nem para ponto.
5. No máximo 2 tentativas por achado. Rode `verificar-transporte.mjs` de novo ao fim de cada rodada.

Se a segunda validação sair limpa: bloco `validacao-resolvido` e siga para o passo 6.

### 5d. Nota no que sobrou

Se a pessoa disse não, ou se restou achado depois das 2 tentativas:

```bash
node scripts/cliente-anotar-flow.mjs \
  --flow-json output/<id>/flow.json \
  --transporte output/<id>/transporte.json \
  --lang pt
```

`--lang` é o idioma da sessão (`pt`, `en`, `es`). A nota amarela ancora no passo do achado. Sem passo, ancora no gatilho. Rodar de novo não duplica. Não apague as notas que o motor já colocou.

Bloco `validacao-restou`: o que resolveu, o que ficou e que há nota no passo. Lógica pendente fica sim. Siga para o passo 6 com o arquivo mesmo assim.

### 6. Downloads

Bloco `downloads`. **Parar.** Uma vez por receita.

- **Sim:** `node scripts/cliente-copiar-flow.mjs --file <path absoluto do *.flow.json>`. Diga o `dest`. O original continua. Não copie PNG, `.mmd` nem outra receita.
- **Não:** siga com o arquivo onde está.
- Falhou: uma linha e siga. Não trave o import.

### 7. Navegador e Import

Se ainda não pediu: bloco `navegador`. **Parar.** Pedido uma vez por sessão.

- **Não:** print `importar/01-integrations-import.png` + bloco `importar`. Handoff curto (copy `handoff-import`). Quando ela voltar, continue; não cole o mesmo print de novo.
- **Sim:** abra o Chrome **deste** agente. SSO: Take Control, espere. Guie pipe → Integrations → Import → o `*.flow.json` **desta** receita.
  - Depois de cada clique: snapshot. O título/nome no canvas tem que ser **esta** receita.
  - Iframe: Take Control + `handoff-import`, depois retome.
  - **Não publique.**
- Nunca: “vou abrir” sem ok. Nunca confirmar Import olhando o flow anterior.

### 8. MCP Pipefy (depois do login no Chrome)

Bloco `mcp-pipefy` no idioma. **Parar.**

- **Não:** segue no clique. Não insista.
- **Sim:** `mcp_auth` no namespace `user-pipefy`. Probe `list_organizations` ou `search_pipes`. Cruzar fases/conexões do diagnóstico com o pipe real (`get_pipe`, fases). Listar conexões iPaaS se o catálogo responder.
- `needsAuth` / ausente depois do ok: uma linha, tutor continua. Não instalar Bituca / DevTools / MCP de iPaaS.

### 9. Teste

Se MCP listou conexão `ACTIVE` da peça: reusar (ou `Conexão: <id>`). Senão: guiar SA (criar, acesso ao pipe, voltar ao formulário do flow). Tokens “24 horas” na tela = validade do **token gerado**, não da Service Account.

HTTP Request autentica de novo neste flow. OAuth: Take Control, uma vez.

Teste: evento real no pipe. Sem run visível, `teste` continua falso. **Não publicar.**

Outra receita: volte ao 3. Não reinstalar. Não perguntar idioma. Rode `cliente-atualizar.mjs` de novo só se ela pedir outra atualização.

## Não fazer

- Anunciar kit/flow pronto sem arquivo no disco / sem smoke
- Escrever `outputs/`
- Reescrever datapill Pipefy para `{{step.output.…}}` (o motor emite `data` / `data.card`; `output` duplica o envelope no import)
- Ignorar `Conexão: <id>`
- Abrir navegador ou MCP sem o ok
- Repetir o mesmo handoff três vezes sem verificar o canvas
- Completar OAuth sozinho / publicar
- OEM `/managed_users` / clonar GitLab / skills do pipe interno
- Imprimir senha / `sk-`
- Afirmar publicado/desligado sem ver a tela
- Traduzir com `translate: false`
- Copiar para Downloads sem o sim, ou copiar o PNG
