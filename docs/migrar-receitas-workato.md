---
title: Como migrar receitas do Workato para Integrações da Pipefy
excerpt: Como traduzir uma receita Workato em um flow do iPaaS e importar o JSON no pipe.
hidden: false
---

# Como migrar receitas do Workato para Integrações da Pipefy

O kit traduz uma receita Workato em um flow das [Integrações da Pipefy](https://help.pipefy.com/pt-BR/articles/12587595-introducao-a-integracoes-da-pipefy). Você roda isso na sua máquina (Cursor, Claude Code ou Codex) e importa o `flow.json` no pipe da automação.

Depois da importação, conexões, Service Account e testes seguem a doc de Integrações.

Para importar você precisa ser admin do pipe e ter Integrações na organização. O conector Pipefy autentica com [Service Account](https://help.pipefy.com/pt-BR/articles/9027789-contas-de-servico), não com o login pessoal. Ver [Primeiros passos com o iPaaS](https://help.pipefy.com/pt-BR/articles/12589348-como-comecar-com-as-integracoes-da-pipefy).

## O que o kit faz

1. Instala o motor (Node.js) e a skill no agente.
2. Lê a receita pelo API client do seu workspace Workato ou por um arquivo `.json`.
3. Gera `flow.json`, um diagrama e uma descrição. Se você colar `Conexão: <id>`, o flow já sai ligado.
4. Mostra como importar: pipe, Integrations, Import.

O kit não publica o flow, não escolhe o pipe e não autentica OAuth. Sem o id da conexão, ligue no painel depois de importar e teste o gatilho.

## O que você precisa

| | |
| --- | --- |
| Agente | Cursor, Claude Code ou Codex. ChatGPT e Claude.ai não executam o script. |
| Node.js 18.17 ou mais novo | Sem permissão na máquina, fale com o TI. |
| Receita | API client Workato ou o JSON com campo `code`. |
| Pipefy | Integrações na org e admin no pipe de destino. |

## 1. Instalar

O kit vigente está sempre em [github.com/pipefy/ipaas-migrator](https://github.com/pipefy/ipaas-migrator), na branch `main`. O número da versão é o arquivo `VERSION` nessa branch. Não use um `.tgz` antigo.

Clone ou baixe esse repositório, abra a pasta no Cursor, Claude Code ou Codex e cole:

```
Instale o migrador com navegador e vamos migrar a receita.
```

No início, o agente compara o `VERSION` da pasta com o do GitHub e avisa se `main` estiver mais novo. A instalação segue mesmo assim. Depois ele instala a skill, pergunta o idioma (português, English, español) e como você vai entregar a receita. O Chrome do agente só abre se você disser ok. Depois do login, explica o MCP Pipefy e pede outro ok. Sem ok, segue no print de Import.

## 2. Fonte da receita

Escolha um caminho.

### API client do Workato

O kit chama a [Developer API](https://docs.workato.com/workato-api) (`GET /api/recipes`) com Bearer token de um API client. A chave antiga (`x-user-token`) não serve.

1. No Workato, abra Workspace admin, API clients.
2. Crie um client com leitura de recipes e o escopo de projeto certo.
3. No chat, diga que vai usar chave. O agente abre o `.env` no editor (Bloco de notas no Windows).
4. Cole o token em `WORKATO_API_KEY=`. Sem aspas. Sem a palavra Bearer.
5. Volte ao chat e diga que a chave está pronta. Não cole o token no chat.

A URL padrão é `https://www.workato.com/api`. Conta na Europa: no `.env`, `WORKATO_API_BASE=https://app.eu.workato.com/api`. Outras regiões: [base URLs](https://docs.workato.com/workato-api).

Quem cria API client: e-mail root do workspace, Environment admin/Admin, ou role com privilégio de clients. Ver [How to generate an API token](https://docs.workato.com/workato-api#how-to-generate-an-api-token).

### Arquivo JSON

Mande no chat o `.json` da receita. É o objeto de [`GET /api/recipes/:id`](https://docs.workato.com/workato-api/recipes), com campo `code`.

Se tiver um `.zip` do Workato, extraia e envie o `.json` da receita, não o `connection.json`.

## 3. Traduzir

Com API, o agente lista `id`, nome e gatilho e pergunta qual migrar. Com arquivo, usa o JSON que você mandou.

Ele mostra o resumo e só traduz quando você confirma.

Saída em `output/<id>/`:

| Arquivo | Uso |
| --- | --- |
| `flow.json` | Importar no iPaaS |
| `recipe_diagram.png` | Diagrama da receita |
| `recipe_description.md` | Texto para revisar o que a receita faz |
| `routing.json` | `ipaas_ready` ou `manual_revision` |

Se uma operação Workato não tiver mapa, `routing.json` vem `manual_revision` e `blocked_reason` explica. O diagrama e a descrição saem mesmo assim. O motor não inventa peça do iPaaS.

## 4. Importar

No Pipefy, abra o pipe da automação:

1. Selecione o pipe (você precisa ser admin).
2. Clique em Integrations.
3. Em Build a Flow, clique em Import e escolha o `flow.json`.

![Pipe, Integrations e Import](../importar/01-integrations-import.png)

Revise o canvas e as conexões. Não publique antes de testar.

Se a conexão iPaaS **já existe** naquele pipe, cole o id no chat (antes ou depois de traduzir):

```
Conexão: <id>
```

Também vale `Connection:` e `Conexión:`. Várias: uma linha cada, ou `Conexão Slack: <id>`. O `flow.json` já sai com o auth. Importe no **mesmo** pipe dessa conexão.

Dá para criar flow [do zero ou por template](https://help.pipefy.com/pt-BR/articles/12589348-como-comecar-com-as-integracoes-da-pipefy). Este kit só cobre o Import do JSON traduzido.

## 5. Depois de importar

1. Sem `Conexão: <id>`: no conector Pipefy, crie ou reutilize uma conexão com Service Account (Client ID e Client Secret). O pipe precisa estar autorizado nessa conta. [Primeiros passos com o iPaaS](https://help.pipefy.com/pt-BR/articles/12589348-como-comecar-com-as-integracoes-da-pipefy) e [Contas de serviço](https://help.pipefy.com/pt-BR/articles/9027789-contas-de-servico).
2. Nos outros conectores (Slack, Google Sheets, HTTP), autentique no painel do flow o que ainda não veio no prompt.
3. Teste o gatilho com um evento de verdade no pipe (criar ou mover card, mudar campo). Sem isso o teste não carrega os dados. [Introdução a Integrações](https://help.pipefy.com/pt-BR/articles/12587595-introducao-a-integracoes-da-pipefy).

O conector HTTP Request não reutiliza credencial entre flows do mesmo pipe. As outras conexões autenticadas reutilizam.

## Problemas comuns

| Erro | O que checar |
| --- | --- |
| `missing_token` | `WORKATO_API_KEY` no `.env`. Não cole a chave no chat. |
| `unauthorized` ou 401 | Token, role e escopo do API client. |
| `not_found` ou 404 | O ID da receita é desse workspace. |
| `tsx_missing` | Peça no chat para instalar de novo. |
| `manual_revision` | `blocked_reason` no `routing.json`. |
| Aba Integrations some | App de Integrações na org; você é admin daquele pipe. |
| Trigger não dispara no teste | Faça a ação no pipe (criar, mover, atualizar campo). |
| Conexão no flow fica vazia | Cole `Conexão: <id>` no chat e traduza de novo, ou ligue no painel. |

## Ver também

- [Introdução a Integrações da Pipefy](https://help.pipefy.com/pt-BR/articles/12587595-introducao-a-integracoes-da-pipefy)
- [Primeiros passos com o iPaaS da Pipefy](https://help.pipefy.com/pt-BR/articles/12589348-como-comecar-com-as-integracoes-da-pipefy)
- [Contas de serviço](https://help.pipefy.com/pt-BR/articles/9027789-contas-de-servico)
- [Como usar a API do Pipefy](https://help.pipefy.com/pt-BR/articles/5580799-como-usar-a-api-do-pipefy)
- [Pipefy Developers](https://developers.pipefy.com/docs/getting-started)
- [Workato Developer API](https://docs.workato.com/workato-api)
- [Workato Recipes API](https://docs.workato.com/workato-api/recipes)
