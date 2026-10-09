# Migrador iPaaS (kit cliente)

Este repositório é só o kit que traduz a receita na máquina de quem migra.
Não inclui o migrador interno.

```bash
git clone https://github.com/pipefy/ipaas-migrator.git
cd ipaas-migrator
npm ci
```

Abra a pasta no Cursor, Claude Code ou Codex e peça para instalar o migrador.
No início, o agente instala a versão mais nova do GitHub antes de traduzir. Se a atualização falhar, não traduz.

---

# com navegador

Tutor **com navegador** (0.6.7). Este assistente transforma sua receita Workato em uma automação para importar no Pipefy. O navegador só abre se você disser que pode.

Depois do login nessa janela, o agente explica o MCP Pipefy (ponte com os seus pipes e conexões) e pede outro ok. Sem ok, segue no print. Não pede MCP de iPaaS, Bituca nem Chrome DevTools.

Não é o migrador interno. Não cria card e não publica o flow.

O rascunho foi gerado. A conexão vem antes do import. O `flow.json` só vai para Downloads se você confirmar. Depois importe, confira e faça um teste.

## Rápido

1. Node.js 18.17 ou mais novo.
2. Abra o Cursor, Claude Code ou Codex.
3. Abra o kit vigente: [github.com/pipefy/ipaas-migrator](https://github.com/pipefy/ipaas-migrator) (`main`). Cole:

```
Instale o migrador com navegador e vamos migrar a receita.
```

4. O agente instala a versão mais nova do GitHub antes de traduzir. Se não conseguir, pergunta se você atualiza na mão e não traduz até lá. Só anuncia pronto depois do smoke do motor.
5. Idioma: infere do chat. A primeira pergunta da receita é API do Workato ou JSON.
6. Diagnóstico, o pipe, e a conexão. Aí sai o `*.flow.json`.
7. Pergunta se pode copiar só esse arquivo para Downloads. O diagrama fica na pasta da receita.
8. Depois ele explica o navegador e pergunta se pode abrir.
9. Não: segue o print de Import. Sim: você entra na janela (SSO é com você). Ele não publica e não pede senha no chat.
10. Depois do login: explica o MCP Pipefy e pergunta se pode ligar.

Se a conexão iPaaS já existe, cole no chat:

```
Conexão: <id>
```

O `flow.json` já sai com o auth. Importe no mesmo pipe dessa conexão.

O pipe do Integrations pode ser outro que o pipe cujos cards a receita mexe. Tokens de 24 horas na tela da Service Account são do token gerado, não da conta.

Playbook: [PLAYBOOK.md](PLAYBOOK.md). A variante sem navegador saiu de linha (0.4.3). Histórico: [CHANGELOG.md](CHANGELOG.md).

Versão: arquivo `VERSION`.
