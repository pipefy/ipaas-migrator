---
title: Migrate Workato recipes to Pipefy Integrations
excerpt: How to translate a Workato recipe into an iPaaS flow and import the JSON into a pipe.
hidden: false
---

# Migrate Workato recipes to Pipefy Integrations

This kit turns a Workato recipe into a [Pipefy Integrations](https://help.pipefy.com/en/articles/12587595-introduction-to-pipefy-s-integrations) flow. You run it on your machine (Cursor, Claude Code, or Codex) and import `flow.json` into the pipe that should own the automation.

After import, connections, Service Accounts, and tests follow the Integrations docs.

You need to be an admin of that pipe, with Integrations enabled on the org. The Pipefy connector uses a [Service Account](https://help.pipefy.com/en/articles/9027789-service-accounts), not your personal login. See [Getting started with Pipefy’s Integrations](https://help.pipefy.com/en/articles/12589348-getting-started-with-pipefy-s-integrations).

## What the kit does

1. Installs the Node.js engine and the agent skill.
2. Reads the recipe from your Workato API client or from a `.json` file.
3. Writes `flow.json`, a diagram, and a description. If you paste `Connection: <id>`, the flow is already wired.
4. Shows how to import: pipe, Integrations, Import.

It does not publish the flow, pick the pipe, or finish OAuth. Without a connection id, connect accounts in the panel after import and test the trigger.

## What you need

| | |
| --- | --- |
| Agent | Cursor, Claude Code, or Codex. ChatGPT and Claude.ai cannot run the script. |
| Node.js 18.17+ | If the machine blocks installs, talk to IT. |
| Recipe | A Workato API client, or the JSON with a `code` field. |
| Pipefy | Integrations on the org, admin on the destination pipe. |

## 1. Install

The current kit is always on [github.com/pipefy/ipaas-migrator](https://github.com/pipefy/ipaas-migrator), branch `main`. The version number is the `VERSION` file on that branch. Do not keep an old `.tgz`.

Clone or download that repository, open the folder in Cursor, Claude Code, or Codex, and paste:

```
Install the migrator with browser and let's migrate a recipe.
```

At the start, the agent compares the folder's `VERSION` with GitHub and tells you if `main` is newer. Install continues either way. It then installs the skill, asks the language (português, English, español), and how you will provide the recipe. It only opens its Chrome if you say yes. After you sign in, it explains Pipefy MCP and asks again. Without that OK, it stays on the Import screenshot.

## 2. Recipe source

Pick one.

### Workato API client

The kit calls the [Developer API](https://docs.workato.com/workato-api) (`GET /api/recipes`) with a Bearer token from an API client. Legacy `x-user-token` keys do not work.

1. In Workato, open Workspace admin, API clients.
2. Create a client that can read recipes, with the right project scopes.
3. In the chat, say you will use a key. The agent opens `.env` in your editor (Notepad on Windows).
4. Paste the token into `WORKATO_API_KEY=`. No quotes. No `Bearer` prefix.
5. Go back to the chat and say the key is ready. Do not paste the token in the chat.

Default URL: `https://www.workato.com/api`. EU workspace: set `WORKATO_API_BASE=https://app.eu.workato.com/api` in `.env`. Other regions: [base URLs](https://docs.workato.com/workato-api).

Who can create API clients: workspace root email, Environment admin/Admin, or a custom role with the clients privilege. See [How to generate an API token](https://docs.workato.com/workato-api#how-to-generate-an-api-token).

### JSON file

Send the recipe `.json` in the chat. It is the object from [`GET /api/recipes/:id`](https://docs.workato.com/workato-api/recipes) and it must include `code`.

If you have a Workato `.zip` export, extract it and send the recipe `.json`, not `connection.json`.

## 3. Translate

With an API key, the agent lists `id`, name, and trigger, then asks which recipe to migrate. With a file, it uses the JSON you sent.

It shows a short summary and waits for you to confirm before translating.

Files land in `output/<id>/`:

| File | Use |
| --- | --- |
| `flow.json` | Import into iPaaS |
| `recipe_diagram.png` | Recipe diagram |
| `recipe_description.md` | What the recipe does |
| `routing.json` | `ipaas_ready` or `manual_revision` |

If a Workato operation has no map, `routing.json` is `manual_revision` and `blocked_reason` says why. You still get the diagram and the description. The engine does not invent iPaaS pieces.

## 4. Import

In Pipefy, open the pipe for the automation:

1. Select the pipe (you must be an admin).
2. Click Integrations.
3. Under Build a Flow, click Import and choose `flow.json`.

![Pipe, Integrations, and Import](../importar/01-integrations-import.png)

Review the canvas and connections. Do not publish until you have tested.

If the iPaaS connection **already exists** on that pipe, paste the id in chat (before or after translating):

```
Connection: <id>
```

`Conexão:` and `Conexión:` also work. Several ids: one line each, or `Connection Slack: <id>`. `flow.json` comes out with auth already set. Import into the **same** pipe as that connection.

You can also [build a flow from scratch or from a template](https://help.pipefy.com/en/articles/12589348-getting-started-with-pipefy-s-integrations). This kit only covers Import of the translated JSON.

## 5. After import

1. Without `Connection: <id>`: on the Pipefy connector, create or reuse a connection with a Service Account (Client ID and Client Secret). That account needs access to the pipe. [Getting started with Pipefy’s Integrations](https://help.pipefy.com/en/articles/12589348-getting-started-with-pipefy-s-integrations).
2. For other connectors (Slack, Google Sheets, HTTP), authenticate in the flow panel anything still missing from the prompt.
3. Test the trigger with a real event in the pipe (create or move a card, change a field). Without that, the test does not load card data. [Introduction to Pipefy’s Integrations](https://help.pipefy.com/en/articles/12587595-introduction-to-pipefy-s-integrations).

HTTP Request does not reuse credentials across flows in the same pipe. Other authenticated connections do.

## Common problems

| Error | What to check |
| --- | --- |
| `missing_token` | `WORKATO_API_KEY` in `.env`. Do not paste the key in chat. |
| `unauthorized` or 401 | API client token, role, and project scope. |
| `not_found` or 404 | The recipe ID belongs to that workspace. |
| `tsx_missing` | Ask the agent to install again. |
| `manual_revision` | `blocked_reason` in `routing.json`. |
| No Integrations tab | Integrations app on the org; you are an admin of that pipe. |
| Trigger test does nothing | Do the action in the pipe (create, move, update a field). |
| Flow has empty connections | Paste `Connection: <id>` in chat and translate again, or connect in the panel. |

## See also

- [Introduction to Pipefy’s Integrations](https://help.pipefy.com/en/articles/12587595-introduction-to-pipefy-s-integrations)
- [Getting started with Pipefy’s Integrations](https://help.pipefy.com/en/articles/12589348-getting-started-with-pipefy-s-integrations)
- [Pipefy Developers](https://developers.pipefy.com/docs/getting-started)
- [Workato Developer API](https://docs.workato.com/workato-api)
- [Workato Recipes API](https://docs.workato.com/workato-api/recipes)
