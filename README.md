# Migrador iPaaS (kit cliente)

Este repositório é só o kit que traduz a receita na máquina de quem migra.
Não inclui o migrador interno.

```bash
git clone https://github.com/pipefy/ipaas-migrator.git
cd ipaas-migrator
npm ci
```

Abra a pasta no Cursor, Claude Code ou Codex e peça para instalar o migrador.
No início, o agente compara o arquivo `VERSION` com o do GitHub e avisa se `main` estiver mais novo.

---

# com navegador

Tutor **com navegador** (0.5.7). Datapill Pipefy sai com colchetes (`{{trigger['data']['card']['id']}}`). A chave é `data`. O agente executa a jornada. O Chrome do coding agent só abre se o agente explicar e você disser ok.

Depois do login nessa janela, o agente explica o MCP Pipefy (ponte com os seus pipes e conexões) e pede outro ok. Sem ok, segue no print. Não pede MCP de iPaaS, Bituca nem Chrome DevTools.

Não é o migrador interno. Não cria card e não publica o flow.

Arquivo gerado não significa flow pronto. Importação, conexões, lógica pendente e teste são quatro coisas diferentes.

## Rápido

1. Node.js 18.17 ou mais novo.
2. Abra o Cursor, Claude Code ou Codex.
3. Abra o kit vigente: [github.com/pipefy/ipaas-migrator](https://github.com/pipefy/ipaas-migrator) (`main`). Cole:

```
Instale o migrador com navegador e vamos migrar a receita.
```

4. O agente compara o `VERSION` com o GitHub, avisa se houver versão mais nova e só anuncia pronto depois do smoke do motor.
5. Idioma: infere do chat. Chave do API client (abre o `.env`) ou arquivo JSON.
6. Diagnóstico da receita (gatilho, pipes, fases) e `*.flow.json` com nome legível.
7. Depois do arquivo ele explica o navegador e pergunta se pode abrir.
8. Não: segue o print de Import. Sim: você entra na janela (SSO é com você). Ele não publica e não pede senha no chat.
9. Depois do login: explica o MCP Pipefy e pergunta se pode ligar.

Se a conexão iPaaS já existe, cole no chat:

```
Conexão: <id>
```

O `flow.json` já sai com o auth. Importe no mesmo pipe dessa conexão.

O pipe do Integrations pode ser outro que o pipe cujos cards a receita mexe. Tokens de 24 horas na tela da Service Account são do token gerado, não da conta.

Playbook: [PLAYBOOK-com-navegador.md](PLAYBOOK-com-navegador.md). A variante sem navegador saiu de linha (0.4.3): [README.md](README.md). Histórico: [CHANGELOG.md](CHANGELOG.md).

Versão: arquivo `VERSION`.
