---
name: migrador-workato-cliente-navegador
description: Tutor 0.5 do kit cliente com navegador (kit vigente). Instala e só anuncia pronto após smoke. Traduz, diagnostica pipes/fases, importa no Chrome do agente depois do ok, oferece MCP Pipefy após o login. Aceita Conexão: <id>. Use when the user invokes /migrador-workato-cliente-navegador, /migrador-workato-cliente, or says "migrar receita", "instale o migrador", "install the migrator", "migrador cliente", "quero migrar", "migrar receita com navegador", "instale o migrador com navegador", "importa essa receita", or cola "Conexão: <id>".
disable-model-invocation: true
---

# Migrador Workato (cliente) v5 — com navegador

Você **executa** a jornada. O cliente decide o processo (qual receita, qual pipe, se liga MCP). Não descobre sozinho path, install ou onde clicar.

Pergunte só se o destino é ambíguo, falta um dado, ou a ação tem efeito externo (OAuth, publicar). “Importa essa receita” / “traduz essa” = motor + diagnóstico + abrir Import. Sem segundo “pode traduzir?”.

O Chrome do agente **só abre depois do ok**. MCP Pipefy **só depois do login e de outro ok**, com o bloco que explica o que é e como ajuda. Sem Bituca, sem MCP de iPaaS, sem Chrome DevTools no pack.

Textos: [copy.md](copy.md). Detalhe: [reference.md](reference.md).

Não cria card. Não publica. Não usa OEM. Não cola segredo no chat.

Invocar **autoriza** descompactar o `.tgz`, `npm ci`, `instalar-cliente.mjs --navegador`, `cliente-versao.mjs` (GET público do `VERSION` em `github.com/pipefy/ipaas-migrator`), smoke do motor, abrir `.env`, GET Workato, ler `.env` (sem imprimir), abrir o navegador do agente depois do ok, e `mcp_auth` em `user-pipefy` depois do ok do MCP.

## Tom

Fale com quem usa o Pipefy, não com quem mantém o motor. Uma ou duas frases. Uma pergunta por vez, só se for decisão (qual receita, qual pipe, abrir o navegador).

Não abra com kit, peça, datapill, MCP, auth, flow, schema ou destino interno. Diga o que a pessoa faz agora.

- Idioma: inferir do chat (já falou PT → `pt`). Perguntar só se ambíguo.
- Códigos (`manual_revision`, `mapped`, `blocked_reason`, path, id de conexão) só se ela pedir “detalhes” ou se a etapa travou. Aí uma linha do que houve e o próximo passo.
- Nunca escrever `outputs/` (não existe). O arquivo que você cita é o `files.flowNamed`, conferido com `ls`.
- Não anunciar “kit pronto” sem smoke. Arquivo gerado não é automação pronta: o próximo passo é importar, conferir conexões e testar.

## Estado da sessão

Não comece cada mensagem com bloco técnico. Guarde para você:

```
receita: <nome> (<id>)
etapa: <arquivo | importacao | conexoes | teste>
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
| Lógica pendente | `AP-MIGRATION-TODO`, Ruby, CODE, `manual_revision` |
| Teste validado | viu run ou evento real |

Não use “sem bloqueios” / “sem pendências técnicas” como pronto. Contagem de operações mapeadas não prova que funciona.

## Workflow

```
- [ ] 1. Instalação + versão no GitHub + smoke
- [ ] 2. Idioma (inferir; perguntar só se ambíguo)
- [ ] 3. Fonte, se ainda não veio
- [ ] 4. Receita + diagnóstico + motor
- [ ] 5. Pedir navegador (ok) → Import (verificar resultado)
- [ ] 6. Após login: pedir MCP Pipefy (explicar + ok)
- [ ] 7. Conexões / SA + teste. Não publicar
```

### 1. Instalação

Em silêncio, nesta ordem. **Não** diga instalado no meio.

| Probe | Se faltar |
| --- | --- |
| Motor: `engine/run.ts` + `scripts/transpilar-receita.mjs` | A pasta tem que ser o kit de `https://github.com/pipefy/ipaas-migrator` (`main`). Se só houver `.tgz`, descompactar. Sem kit: pedir para abrir esse GitHub. **Parar.** Não clonar GitLab. |
| `node -v` ≥ 18.17 | Pedir Node ou TI. **Parar.** |
| `node_modules/.bin/tsx` | `npm ci` na raiz do pack. Falhou → **parar.** |
| Skill | `node scripts/instalar-cliente.mjs --navegador` |
| Versão | `node scripts/cliente-versao.mjs`. Se `update` é `true`, avisar a versão do GitHub e o link `repo`, e **seguir**. Rede falhou (`ok: false`): uma linha e seguir. Não baixar nem trocar arquivos. |
| Smoke | `node scripts/transpilar-receita.mjs --recipe examples/smoke.recipe.json --out .tmp/smoke`. Se o fixture não estiver em `examples/`, use `docs/cliente/smoke.recipe.json`. Sem `ok: true` e sem `files.flow` no disco: **não** anunciar pronto. |

Se `update` é `true`, a primeira frase do anúncio é o aviso (versão local, versão no GitHub, link). Depois:

```
kit pronto  (migrador cliente <local>, com navegador)

------

node: <versão>
dependências: ok
smoke: ok
skill: instalada
github: em dia | há <remote>
```

### 2. Idioma

Se o chat já está em PT/EN/ES: grave e siga. Senão: bloco `Idioma` em copy.md. **Parar.**

### 3. Fonte

Se já mandou JSON, ID ou “usa a chave”: não pergunte. Senão bloco `fonte`.

### 4. Receita + diagnóstico + motor

“Importa / traduz essa” já é confirmação.

```bash
node scripts/cliente-diagnostico.mjs --recipe output/<id>/recipe.json
```

Mostre **antes** do Import, em linguagem de quem usa o pipe (preencha com o JSON, sem inventar):

```
A receita <nome> usa <Pipefy, Slack, …>.
Ela começa quando <evento em uma frase>. Lê <pipe ou “não identifiquei o pipe”> e altera <pipe>.
Confirme em qual pipe a automação deve ficar.
```

Se houver revisão: `Há <N> etapas para revisar antes do teste.` Sem revisão, não fale de TODO, Ruby ou CODE.

Se não deu para preparar a importação: `Não consegui preparar esta automação. Revise: <operação e o que fazer>.` O código fica em “detalhes”.

Depois do arquivo: `O rascunho foi gerado. Agora importe, confira as conexões e faça um teste.`

Se o ID da conexão foi só informado: `ID da conexão incluído. Confirme a conexão no Pipefy antes de testar.` Não diga que está ligada.

```bash
node scripts/transpilar-receita.mjs \
  --recipe output/<id>/recipe.json \
  --out output/<id>
```

`Conexão: <id>` no chat: acrescente `--connection-ids` e `--hints-text`.

Confira no disco `files.flowNamed` (ex. `.../alerta-mr-sem-revisores.flow.json`). Cite **esse** path. Leia `status.json`. Mostre PNG se `png.ok`.

Não editar `mappings/`, `kb/`, `engine/`. Não `--force`. Não traduzir Ruby.

Step de planilha declara o pacote `xlsx`. Se o teste disser que o pacote não instalou, use a skill `migrador-workato-sem-dependencia` nesse `*.flow.json` e importe de novo.

### 5. Navegador e Import

Se ainda não pediu: bloco `navegador`. **Parar.** Pedido uma vez por sessão.

- **Não:** print `importar/01-integrations-import.png` + bloco `importar`. Handoff curto (copy `handoff-import`). Quando ela voltar, continue; não cole o mesmo print de novo.
- **Sim:** abra o Chrome **deste** agente. SSO: Take Control, espere. Guie pipe → Integrations → Import → o `*.flow.json` **desta** receita.
  - Depois de cada clique: snapshot. O título/nome no canvas tem que ser **esta** receita.
  - Iframe: Take Control + `handoff-import`, depois retome.
  - **Não publique.**
- Nunca: “vou abrir” sem ok. Nunca confirmar Import olhando o flow anterior.

### 6. MCP Pipefy (depois do login no Chrome)

Bloco `mcp-pipefy` no idioma. **Parar.**

- **Não:** segue no clique. Não insista.
- **Sim:** `mcp_auth` no namespace `user-pipefy`. Probe `list_organizations` ou `search_pipes`. Cruzar fases/conexões do diagnóstico com o pipe real (`get_pipe`, fases). Listar conexões iPaaS se o catálogo responder.
- `needsAuth` / ausente depois do ok: uma linha, tutor continua. Não instalar Bituca / DevTools / MCP de iPaaS.

### 7. Conexões e teste

Se MCP listou conexão `ACTIVE` da peça: reusar (ou `Conexão: <id>`). Senão: guiar SA (criar, acesso ao pipe, voltar ao formulário do flow). Tokens “24 horas” na tela = validade do **token gerado**, não da Service Account.

HTTP Request autentica de novo neste flow. OAuth: Take Control, uma vez.

Teste: evento real no pipe. Sem run visível, `teste` continua falso. **Não publicar.**

Outra receita: volte ao 4. Não reinstalar. Não perguntar idioma.

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
