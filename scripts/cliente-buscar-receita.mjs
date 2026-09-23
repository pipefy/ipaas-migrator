// Busca receitas na API Workato do *usuario* (nao OEM).
// Nao imprime token. Nao muta (so GET).
//
//   node scripts/cliente-buscar-receita.mjs --list
//   node scripts/cliente-buscar-receita.mjs --id 12389 --out output/12389.recipe.json

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// So WORKATO_API_KEY (workspace do usuario). Nao ler WORKATO_API —
// no helper esse nome e o token OEM da Pipefy.
const TOKEN_KEYS = ['WORKATO_API_KEY'];
const DEFAULT_BASE = 'https://www.workato.com/api';

function flag(name) {
  return process.argv.includes(name);
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const key = t.slice(0, i).trim();
    const val = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    out[key] = val;
  }
  return out;
}

function findEnvPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  const seen = new Set();
  const bases = [process.cwd(), ...parents(process.cwd(), 6), here, ...parents(here, 6)];
  for (const base of bases) {
    const env = resolve(base, '.env');
    if (seen.has(env)) continue;
    seen.add(env);
    if (!existsSync(env)) continue;
    const parsed = parseEnvFile(env);
    if (TOKEN_KEYS.some((k) => parsed[k])) return env;
    if (existsSync(resolve(base, 'package.json'))) return env;
  }
  return null;
}

function parents(from, n) {
  const out = [];
  let dir = resolve(from);
  for (let i = 0; i < n; i++) {
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
    out.push(dir);
  }
  return out;
}

function loadEnv() {
  const fromProcess = {};
  for (const key of [...TOKEN_KEYS, 'WORKATO_API_BASE']) {
    if (process.env[key]) fromProcess[key] = process.env[key];
  }
  const envPath = findEnvPath();
  const fromFile = envPath ? parseEnvFile(envPath) : {};
  return { ...fromFile, ...fromProcess, _envPath: envPath };
}

function tokenOf(env) {
  for (const key of TOKEN_KEYS) {
    const val = String(env[key] ?? '').trim();
    if (val) return val;
  }
  return '';
}

function unwrapRecipe(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.code != null) return body;
  if (body.result && typeof body.result === 'object' && !Array.isArray(body.result)) {
    if (body.result.code != null || body.result.id != null) return body.result;
  }
  return body.id != null ? body : null;
}

function unwrapList(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body?.result)) return body.result;
  return [];
}

async function workatoGet(base, path, token) {
  const url = `${base.replace(/\/$/, '')}${path}`;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = { status: res.status };
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, ok: res.ok };
  }
  return { status: lastErr?.status ?? 0, json: null, ok: false };
}

function summarizeRecipe(r) {
  return {
    id: r.id ?? null,
    name: r.name ?? null,
    running: r.running ?? null,
    folder_id: r.folder_id ?? null,
    trigger: r.trigger_application ?? null,
    apps: r.applications ?? [],
  };
}

function printHelp() {
  console.log(`Uso: node scripts/cliente-buscar-receita.mjs [opcoes]

  --list                 lista receitas do workspace (exclude_code)
  --id <recipe_id>       baixa uma receita
  --out <arquivo.json>   destino do --id (default: output/<id>.recipe.json)
  --page <n>             pagina do --list (default 1)
  --per-page <n>         ate 100 (default 100)
  --max <n>              teto do --list com paginacao (default 300)

Token: WORKATO_API_KEY (env ou .env). Nao usa WORKATO_API (OEM).
Base:  WORKATO_API_BASE (default ${DEFAULT_BASE}).
So GET. Nao imprime a chave.
`);
}

async function main() {
  if (flag('--help') || flag('-h')) {
    printHelp();
    return;
  }

  const env = loadEnv();
  const token = tokenOf(env);
  const base = String(env.WORKATO_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const list = flag('--list');
  const id = arg('--id');

  if (!token) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: 'missing_token',
        hint: 'grave WORKATO_API_KEY no .env (nao cole a chave no chat)',
        env: env._envPath ? 'encontrado' : 'ausente',
      }),
    );
    process.exit(2);
  }
  if (!list && !id) {
    printHelp();
    process.exit(2);
  }

  if (list) {
    const perPage = Math.min(100, Math.max(1, Number(arg('--per-page', '100')) || 100));
    const max = Math.min(500, Math.max(1, Number(arg('--max', '300')) || 300));
    let page = Math.max(1, Number(arg('--page', '1')) || 1);
    const recipes = [];
    while (recipes.length < max) {
      const path = `/recipes?page=${page}&per_page=${perPage}&exclude_code=true`;
      const res = await workatoGet(base, path, token);
      if (res.status === 401 || res.status === 403) {
        console.log(JSON.stringify({ ok: false, reason: 'unauthorized', status: res.status }));
        process.exit(2);
      }
      if (!res.ok) {
        console.log(JSON.stringify({ ok: false, reason: 'http_error', status: res.status }));
        process.exit(1);
      }
      const batch = unwrapList(res.json);
      if (!batch.length) break;
      for (const r of batch) {
        recipes.push(summarizeRecipe(r));
        if (recipes.length >= max) break;
      }
      if (batch.length < perPage) break;
      page += 1;
    }
    console.log(JSON.stringify({ ok: true, count: recipes.length, recipes }, null, 2));
    return;
  }

  const res = await workatoGet(base, `/recipes/${encodeURIComponent(id)}`, token);
  if (res.status === 401 || res.status === 403) {
    console.log(JSON.stringify({ ok: false, reason: 'unauthorized', status: res.status, id }));
    process.exit(2);
  }
  if (res.status === 404) {
    console.log(JSON.stringify({ ok: false, reason: 'not_found', status: 404, id }));
    process.exit(2);
  }
  if (!res.ok) {
    console.log(JSON.stringify({ ok: false, reason: 'http_error', status: res.status, id }));
    process.exit(1);
  }

  const recipe = unwrapRecipe(res.json);
  if (!recipe || recipe.code == null) {
    console.log(JSON.stringify({ ok: false, reason: 'no_code', id }));
    process.exit(1);
  }

  const out = resolve(arg('--out') ?? `output/${id}.recipe.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(recipe, null, 2)}\n`);
  console.log(
    JSON.stringify({
      ok: true,
      id: recipe.id ?? id,
      name: recipe.name ?? null,
      running: recipe.running ?? null,
      file: out,
    }),
  );
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, reason: 'crash', message: String(err?.message ?? err) }));
  process.exit(1);
});
