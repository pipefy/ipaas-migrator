# Copy do tutor (pt / en / es)

Use o bloco do idioma gravado na sessão. Nomes de UI (`Integrations`, `Import`) ficam em inglês, como na tela.

## Idioma (antes de escolher)

```
Which language for this session?
¿En qué idioma seguimos?
Em qual idioma seguimos?

1. Português
2. English
3. Español
```

## pt

### fonte

```
Para traduzir, preciso do JSON da receita Workato (objeto com o campo `code`).
Você escolhe uma fonte.

1. Chave do API client Workato
   Token Bearer do seu workspace (Workspace admin → API clients),
   com leitura de recipes. Vai no `.env` (`WORKATO_API_KEY`).
   Eu abro o arquivo no editor. Você cola a chave lá. Não cole a chave neste chat.

2. Arquivo JSON da receita
   O export ou a resposta de GET /api/recipes/:id.
   Pode mandar um ou vários `.json`.

Qual você quer usar agora: chave ou arquivo?
```

### env

```
Abri o `.env` no editor de texto (<editor>).

Cole o token em WORKATO_API_KEY=  (sem aspas, sem a palavra Bearer).
Salve e feche.

Workspace na Europa: descomente
WORKATO_API_BASE=https://app.eu.workato.com/api

Quando terminar, volte e diga: chave pronta
```

### arquivo

```
Pode enviar os arquivos da receita.

Arraste os `.json` para este chat, ou me passe o caminho no disco.
Aceito um arquivo ou vários.

Se for .zip do Workato, extraia e mande o .json que tem o campo `code`
(não o connection.json).
```

### importar

```
como importar o flow.json

(1) Abra no Pipefy o pipe onde a automação deve viver (você precisa ser admin; Integrações na org).
(2) Clique em Integrations.
(3) Em Build a Flow, clique em Import e escolha o flow.json.
Revise o canvas e as conexões. Não publique até conferir.
```

### navegador

```
O próximo passo é no Pipefy: abrir o pipe, Integrations, Import do flow.json.

Posso abrir o navegador deste agente e ir com você?
Você entra com a sua conta nessa janela (SSO/2FA é com você).
Eu não publico o flow e não peço senha neste chat.

Se preferir, seguimos só daqui: eu mando o print e você clica.

Pode abrir o navegador?
```

### conexoes

```
No flow, ligue as conexões no painel.

Pipefy: Service Account (Client ID e Client Secret) no painel, não neste chat.
Outros (Slack, Google Sheets): Connect e complete o OAuth na janela.
HTTP Request: autentique de novo neste flow (não reutiliza).

Se a conexão iPaaS já existe, pode colar o id em vez de clicar Connect:

Conexão: <id>

Quando terminar, diga: conexões prontas
```

### conexoes-dadas

```
Liguei as conexões que você passou no flow.json:

Conexão: <id>

Importe no mesmo pipe onde essa conexão já existe.
O que não veio no prompt ainda precisa do painel (Connect / Service Account).
HTTP Request autentica de novo neste flow.

Quando terminar, diga: conexões prontas
```

### teste

```
Teste o gatilho com um evento de verdade no pipe (criar ou mover card, mudar campo).
Sem isso o teste não carrega os dados.
Não publique até conferir.
```

### handoff-import

```
Clique em Import e escolha o arquivo .flow.json desta receita.
Quando o canvas abrir, volte aqui. Eu confirmo o título antes de seguir.
```

### mcp-pipefy

```
Você já entrou no Pipefy nesta janela. Dá para ligar o MCP Pipefy neste agente.

O que é: uma ponte entre o chat e a sua conta Pipefy (os pipes e as conexões que você já vê no app).

Como ajuda nesta migração:
- Confiro o pipe de destino e as fases reais (ex. se a receita move para BackLog e este pipe só tem Inbox/Doing/Done).
- Vejo se já existe conexão / Service Account utilizável, em vez de te mandar criar outra.
- Depois do Import, confirmo o que entrou no pipe sem você caçar o flow sozinho.

Não publica o flow. Não pede senha neste chat (o login é o que você já fez no Chrome). Sem isso, seguimos no clique e no print.

Pode ligar o MCP Pipefy?
```

### sa-24h

```
O aviso de 24 horas na tela vale para o token gerado naquele momento.
A Service Account continua existindo depois disso. Gere outro token se o atual expirou.
Não é o prazo da conta.
```

## en

### fonte

```
To translate, I need the Workato recipe JSON (the object with a `code` field).
Pick one source.

1. Workato API client key
   Bearer token from your workspace (Workspace admin → API clients),
   with recipe read access. It goes in `.env` (`WORKATO_API_KEY`).
   I open the file in your editor. Paste the key there. Do not paste it in this chat.

2. Recipe JSON file
   The export or the GET /api/recipes/:id payload.
   You can send one file or several.

Which do you want to use: key or file?
```

### env

```
I opened `.env` in your text editor (<editor>).

Paste the token into WORKATO_API_KEY=  (no quotes, no Bearer prefix).
Save and close.

EU workspace: uncomment
WORKATO_API_BASE=https://app.eu.workato.com/api

When you are done, come back and say: key ready
```

### arquivo

```
You can send the recipe files now.

Drop the `.json` files into this chat, or give me the path on disk.
One file or several is fine.

If you have a Workato .zip, extract it and send the .json that has `code`
(not connection.json).
```

### importar

```
how to import flow.json

(1) In Pipefy, open the pipe for this automation (you must be an admin; Integrations on the org).
(2) Click Integrations.
(3) Under Build a Flow, click Import and choose flow.json.
Review the canvas and connections. Do not publish until you have tested.
```

### navegador

```
The next step is in Pipefy: open the pipe, Integrations, Import of flow.json.

Can I open this agent's browser and walk through it with you?
You sign in in that window (SSO/2FA is on you).
I will not publish the flow and I will not ask for a password in this chat.

If you prefer, we stay here: I send the screenshot and you click.

Open the browser?
```

### conexoes

```
In the flow, connect the accounts in the panel.

Pipefy: Service Account (Client ID and Client Secret) in the panel, not in this chat.
Others (Slack, Google Sheets): Connect and finish OAuth in the window.
HTTP Request: authenticate again in this flow (it does not reuse credentials).

If the iPaaS connection already exists, paste the id instead of clicking Connect:

Connection: <id>

When you are done, say: connections ready
```

### conexoes-dadas

```
I wired the connections you gave into flow.json:

Connection: <id>

Import into the same pipe where that connection already exists.
Anything missing from the prompt still needs the panel (Connect / Service Account).
HTTP Request authenticates again in this flow.

When you are done, say: connections ready
```

### teste

```
Test the trigger with a real event in the pipe (create or move a card, change a field).
Without that, the test does not load card data.
Do not publish until you have checked.
```

### handoff-import

```
Click Import and pick the .flow.json for this recipe.
When the canvas opens, come back here. I will confirm the title before we continue.
```

### mcp-pipefy

```
You already signed into Pipefy in this window. We can turn on Pipefy MCP in this agent.

What it is: a bridge between this chat and your Pipefy account (the pipes and connections you already see in the app).

How it helps this migration:
- I check the destination pipe and the real phases (for example if the recipe moves a card to BackLog and this pipe only has Inbox/Doing/Done).
- I see whether a connection / Service Account already exists, instead of asking you to create another one.
- After Import, I confirm what landed in the pipe so you do not have to hunt for the flow.

It does not publish the flow. It does not ask for a password in this chat (sign-in is what you already did in Chrome). Without it, we stay on clicks and the screenshot.

Turn on Pipefy MCP?
```

### sa-24h

```
The 24-hour notice on screen is the lifetime of the token generated at that moment.
The Service Account itself remains. Generate a new token if this one expired.
It is not the lifetime of the account.
```

## es

### fonte

```
Para traducir, necesito el JSON de la receta Workato (el objeto con el campo `code`).
Elige una fuente.

1. Clave del API client de Workato
   Token Bearer de tu workspace (Workspace admin → API clients),
   con lectura de recipes. Va en `.env` (`WORKATO_API_KEY`).
   Abro el archivo en el editor. Pegas la clave ahí. No la pegues en este chat.

2. Archivo JSON de la receta
   El export o la respuesta de GET /api/recipes/:id.
   Puedes enviar uno o varios `.json`.

¿Cuál quieres usar ahora: clave o archivo?
```

### env

```
Abrí el `.env` en el editor de texto (<editor>).

Pega el token en WORKATO_API_KEY=  (sin comillas, sin la palabra Bearer).
Guarda y cierra.

Workspace en Europa: descomenta
WORKATO_API_BASE=https://app.eu.workato.com/api

Cuando termines, vuelve y di: clave lista
```

### arquivo

```
Puedes enviar los archivos de la receta.

Arrastra los `.json` a este chat, o pásame la ruta en disco.
Acepto uno o varios.

Si es un .zip de Workato, extrae y envía el .json que tiene el campo `code`
(no el connection.json).
```

### importar

```
cómo importar flow.json

(1) En Pipefy, abre el pipe de la automatización (debes ser admin; Integrations en la org).
(2) Haz clic en Integrations.
(3) En Build a Flow, haz clic en Import y elige flow.json.
Revisa el canvas y las conexiones. No publiques hasta probar.
```

### navegador

```
El siguiente paso es en Pipefy: abrir el pipe, Integrations, Import de flow.json.

¿Puedo abrir el navegador de este agente e ir contigo?
Entras con tu cuenta en esa ventana (SSO/2FA es contigo).
No publico el flow y no pido contraseña en este chat.

Si prefieres, seguimos aquí: te mando la captura y tú haces clic.

¿Abro el navegador?
```

### conexoes

```
En el flow, conecta las cuentas en el panel.

Pipefy: Service Account (Client ID y Client Secret) en el panel, no en este chat.
Otras (Slack, Google Sheets): Connect y completa el OAuth en la ventana.
HTTP Request: autentica de nuevo en este flow (no reutiliza).

Si la conexión iPaaS ya existe, pega el id en vez de hacer clic en Connect:

Conexión: <id>

Cuando termines, di: conexiones listas
```

### conexoes-dadas

```
Enlacé en flow.json las conexiones que pasaste:

Conexión: <id>

Importa en el mismo pipe donde esa conexión ya existe.
Lo que no vino en el prompt sigue en el panel (Connect / Service Account).
HTTP Request autentica de nuevo en este flow.

Cuando termines, di: conexiones listas
```

### teste

```
Prueba el disparador con un evento real en el pipe (crear o mover card, cambiar un campo).
Sin eso, la prueba no carga los datos.
No publiques hasta revisar.
```

### handoff-import

```
Haz clic en Import y elige el .flow.json de esta receta.
Cuando abra el canvas, vuelve aquí. Confirmo el título antes de seguir.
```

### mcp-pipefy

```
Ya entraste en Pipefy en esta ventana. Podemos activar el MCP de Pipefy en este agente.

Qué es: un puente entre el chat y tu cuenta de Pipefy (los pipes y las conexiones que ya ves en la app).

Cómo ayuda en esta migración:
- Reviso el pipe de destino y las fases reales (por ejemplo si la receta mueve a BackLog y este pipe solo tiene Inbox/Doing/Done).
- Veo si ya existe una conexión / Service Account usable, en vez de pedirte crear otra.
- Después del Import, confirmo lo que quedó en el pipe sin que busques el flow a solas.

No publica el flow. No pide contraseña en este chat (el login es el que ya hiciste en Chrome). Sin esto, seguimos con clics y la captura.

¿Activo el MCP de Pipefy?
```

### sa-24h

```
El aviso de 24 horas en pantalla vale para el token generado en ese momento.
La Service Account sigue existiendo. Genera otro token si el actual expiró.
No es el plazo de la cuenta.
```
