# Copy do tutor (pt / en / es)

Use o bloco do idioma da sessão. Nomes de botão (`Integrations`, `Import`) ficam como na tela. Uma pergunta por bloco. Sem peça, datapill, schema, auth ou destino interno.

## Idioma (antes de escolher)

```
Em qual idioma seguimos?

1. Português
2. English
3. Español
```

## pt

### fonte

```
Como você quer trazer a receita?

1. API do Workato — eu abro um arquivo, você cola a chave lá. Não cole neste chat.
2. JSON da receita — me passe o caminho no disco, ou arraste o arquivo.

API ou JSON?
```

### env

```
Abri o arquivo da chave no editor (<editor>).

Cole depois de WORKATO_API_KEY=  (sem aspas).
Salve e volte dizendo: chave pronta

Conta na Europa: descomente a linha WORKATO_API_BASE da Europa.
```

### arquivo

```
Me passe o caminho do arquivo da receita, ou arraste o arquivo aqui.

Se vier um .zip, use o arquivo da receita, não o das conexões.
```

### importar

```
No Pipefy, abra o pipe da automação (você precisa ser admin).
Integrations → Import → o arquivo desta receita.
Confira e teste antes de publicar.
```

### navegador

```
O próximo passo é importar no Pipefy.

Posso abrir o navegador e ir com você? O login é seu. Eu não publico.

Se preferir, eu mando o print e você clica.

Pode abrir?
```

### conexoes

```
No painel da automação, ligue as contas (Pipefy, Slack, planilha).
A chave da conta fica no painel, não neste chat.

Se a conexão já existe, cole:

Conexão: <id>

Quando terminar: conexões prontas
```

### conexoes-dadas

```
Incluí o ID da conexão no rascunho. Confirme essa conexão no Pipefy antes de testar.

A importação, quando chegar a hora, é no mesmo pipe dessa conexão.
O que faltou, ligue no painel.

Quando terminar: conexões prontas
```

### atualizacao-falhou

```
Não consegui atualizar o migrador.

Posso te guiar para atualizar na mão? Sem isso eu não traduzo a receita.

Pode atualizar na mão?
```

### atualizacao-manual

```
Abra https://github.com/pipefy/ipaas-migrator (branch main).
Baixe o ZIP e substitua esta pasta.
Mantenha o arquivo .env e a pasta output/.
Quando terminar, diga: atualizei
```

### conexao-antes

```
Antes de importar, vamos deixar a conexão certa.

Se a conta já existe no Pipefy, cole:

Conexão: <id>

Se não existe, eu te guio a criar no painel. A chave fica lá, não neste chat.

Quando a conexão estiver definida: conexão pronta
```

### downloads

```
O arquivo da receita está pronto.

Posso copiar só o flow.json para a sua pasta Downloads? O diagrama fica onde está.

Pode copiar?
```

### teste

```
Faça um teste de verdade: crie ou mova um card, ou mude um campo.
Não publique antes de conferir.
```

### handoff-import

```
Clique em Import e escolha o arquivo desta receita.
Quando a tela abrir, volte aqui.
```

### mcp-pipefy

```
Você já entrou no Pipefy. Posso consultar seus pipes e conexões daqui, para conferir o destino sem você procurar na tela.

Não publico e não peço senha. Se não quiser, seguimos pelo print.

Pode ligar?
```

### sa-24h

```
As 24 horas valem para a chave gerada agora, não para a conta.
Se expirou, gere outra.
```

## en

### fonte

```
How should I get the recipe?

1. Workato API — I open a file, you paste the key there. Do not paste it in this chat.
2. Recipe JSON — give me the path, or drop the file here.

API or JSON?
```

### env

```
I opened the key file in your editor (<editor>).

Paste it after WORKATO_API_KEY=  (no quotes).
Save and come back: key ready

EU account: uncomment the Europe WORKATO_API_BASE line.
```

### arquivo

```
Give me the path to the recipe file, or drop the file here.

If you have a .zip, use the recipe file, not the connections file.
```

### importar

```
In Pipefy, open the pipe for this automation (you need to be an admin).
Integrations → Import → this recipe's file.
Check it and test before you publish.
```

### navegador

```
Next step is to import in Pipefy.

Can I open the browser and go with you? You sign in. I will not publish.

If you prefer, I send the screenshot and you click.

Open it?
```

### conexoes

```
In the automation panel, connect the accounts (Pipefy, Slack, spreadsheet).
The account key stays in the panel, not in this chat.

If the connection already exists, paste:

Connection: <id>

When you are done: connections ready
```

### conexoes-dadas

```
I added the connection ID to the draft. Confirm that connection in Pipefy before you test.

When we import, it has to be the same pipe as that connection.
Connect anything missing in the panel.

When you are done: connections ready
```

### atualizacao-falhou

```
I could not update the migrator.

Can I walk you through a manual update? I will not translate the recipe until then.

Update it by hand?
```

### atualizacao-manual

```
Open https://github.com/pipefy/ipaas-migrator (branch main).
Download the ZIP and replace this folder.
Keep the .env file and the output/ folder.
When you are done, say: updated
```

### conexao-antes

```
Before we import, let's set the right connection.

If the account already exists in Pipefy, paste:

Connection: <id>

If it does not, I will guide you in the panel. The key stays there, not in this chat.

When the connection is set: connection ready
```

### downloads

```
The recipe file is ready.

Can I copy only the flow.json into your Downloads folder? The diagram stays where it is.

Copy it?
```

### teste

```
Run a real test: create or move a card, or change a field.
Do not publish until you have checked.
```

### handoff-import

```
Click Import and pick this recipe's file.
When the screen opens, come back here.
```

### mcp-pipefy

```
You are already in Pipefy. I can look up your pipes and connections from here, so we can check the destination without you hunting on screen.

I will not publish and I will not ask for a password. If you skip this, we stay with the screenshot.

Turn it on?
```

### sa-24h

```
The 24 hours apply to the key generated just now, not to the account.
If it expired, generate another one.
```

## es

### fonte

```
¿Cómo traemos la receta?

1. API de Workato — abro un archivo, pegas la clave ahí. No la pegues en este chat.
2. JSON de la receta — pásame la ruta, o arrastra el archivo.

¿API o JSON?
```

### env

```
Abrí el archivo de la clave en el editor (<editor>).

Pégala después de WORKATO_API_KEY=  (sin comillas).
Guarda y vuelve: clave lista

Cuenta en Europa: descomenta la línea WORKATO_API_BASE de Europa.
```

### arquivo

```
Pásame la ruta del archivo de la receta, o arrástralo aquí.

Si viene un .zip, usa el archivo de la receta, no el de las conexiones.
```

### importar

```
En Pipefy, abre el pipe de la automatización (tienes que ser admin).
Integrations → Import → el archivo de esta receta.
Revisa y prueba antes de publicar.
```

### navegador

```
El siguiente paso es importar en Pipefy.

¿Puedo abrir el navegador e ir contigo? El acceso es tuyo. No publico.

Si prefieres, te mando la captura y tú haces clic.

¿Lo abro?
```

### conexoes

```
En el panel de la automatización, conecta las cuentas (Pipefy, Slack, hoja de cálculo).
La clave de la cuenta queda en el panel, no en este chat.

Si la conexión ya existe, pega:

Conexión: <id>

Cuando termines: conexiones listas
```

### conexoes-dadas

```
Incluí el ID de la conexión en el borrador. Confirma esa conexión en Pipefy antes de probar.

Cuando llegue la importación, es en el mismo pipe de esa conexión.
Lo que falte, conéctalo en el panel.

Cuando termines: conexiones listas
```

### atualizacao-falhou

```
No pude actualizar el migrador.

¿Te guío para actualizar a mano? Sin eso no traduzco la receta.

¿Actualizas a mano?
```

### atualizacao-manual

```
Abre https://github.com/pipefy/ipaas-migrator (branch main).
Baja el ZIP y sustituye esta carpeta.
Conserva el archivo .env y la carpeta output/.
Cuando termines, di: actualicé
```

### conexao-antes

```
Antes de importar, dejemos la conexión correcta.

Si la cuenta ya existe en Pipefy, pega:

Conexión: <id>

Si no existe, te guío en el panel. La clave se queda ahí, no en este chat.

Cuando la conexión esté definida: conexión lista
```

### downloads

```
El archivo de la receta está listo.

¿Puedo copiar solo el flow.json a tu carpeta Descargas? El diagrama se queda donde está.

¿Lo copio?
```

### teste

```
Haz una prueba de verdad: crea o mueve un card, o cambia un campo.
No publiques antes de revisar.
```

### handoff-import

```
Haz clic en Import y elige el archivo de esta receta.
Cuando se abra la pantalla, vuelve aquí.
```

### mcp-pipefy

```
Ya entraste en Pipefy. Puedo consultar tus pipes y conexiones desde aquí, para revisar el destino sin que lo busques en la pantalla.

No publico y no pido contraseña. Si no quieres, seguimos con la captura.

¿Lo activo?
```

### sa-24h

```
Las 24 horas valen para la clave generada ahora, no para la cuenta.
Si expiró, genera otra.
```
