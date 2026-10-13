// Audita flow.json (anexo e/ou draft vivo) vs receita Workato.
// Nao chama Pipefy. Nao edita mapa/KB. Nao publica.
//
//   node scripts/verificar-transporte.mjs --recipe r.json --flow-json f.json \
//     [--live-flow live.json] [--flow-id <ap_flow_id>] [--pipe-id <id>] [--out dir]
//
// Exit 0 = ok (sem bloqueia). Exit 3 = tem bloqueia. Exit 2 = arquivo/uso.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatChat, formatComment, verifyTransport } from './lib/verify-transport.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recipePath = resolve(arg('--recipe') ?? '');
const flowPath = resolve(arg('--flow-json') ?? '');
const livePath = arg('--live-flow') ? resolve(arg('--live-flow')) : null;
const flowId = arg('--flow-id');
const mapPath = resolve(arg('--map') ?? resolve(root, 'mappings/base-map.json'));
const outDir = arg('--out') ? resolve(arg('--out')) : null;
const pipeId = arg('--pipe-id') ?? '';

if (!recipePath || !flowPath) {
  console.error(
    'uso: node scripts/verificar-transporte.mjs --recipe <recipe.json> --flow-json <flow.json> [--live-flow|--flow-id]',
  );
  process.exit(2);
}
if (!existsSync(recipePath) || !existsSync(flowPath)) {
  console.log(JSON.stringify({ ok: false, reason: 'file_not_found', recipe: recipePath, flow: flowPath }));
  process.exit(2);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadEnvFile(p) {
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

function wrapLive(body) {
  const version = body?.version ?? body;
  const trigger = version?.trigger ?? body?.trigger;
  if (!trigger) return null;
  return {
    type: 'SHARED',
    name: version?.displayName ?? body?.displayName,
    status: body?.status ?? null,
    flows: [
      {
        displayName: version?.displayName ?? body?.displayName,
        trigger,
        valid: version?.valid,
        schemaVersion: version?.schemaVersion ?? '20',
      },
    ],
  };
}

async function fetchLive(id) {
  loadEnvFile(resolve(root, '.env'));
  const email = process.env.IPAAS_USER || process.env.IPPAS_USER || '';
  const password =
    process.env.IPPAS_USER_PASSWORD ||
    process.env.IPAAS_USER_PASSWORD ||
    process.env.IPAAS_PASSWORD ||
    '';
  if (!email || !password) return { ok: false, reason: 'missing_credentials' };
  const host = process.env.IPAAS_URL || 'https://ipaas.pipefy.com';
  const signIn = await fetch(`${host}/api/v1/authentication/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const signBody = await signIn.json().catch(() => ({}));
  if (signIn.status !== 200 || !signBody?.token) {
    return { ok: false, reason: 'sign_in_failed', http: signIn.status };
  }
  const got = await fetch(`${host}/api/v1/flows/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${signBody.token}` },
  });
  const body = await got.json().catch(() => ({}));
  if (got.status !== 200 || !body?.id) {
    return { ok: false, reason: 'flow_get_failed', http: got.status };
  }
  const wrapped = wrapLive(body);
  if (!wrapped) return { ok: false, reason: 'flow_has_no_trigger', http: got.status };
  return { ok: true, flow: wrapped, draftStatus: body.status ?? null, raw: body };
}

let recipe;
let anexo;
try {
  recipe = readJson(recipePath);
  anexo = readJson(flowPath);
} catch {
  console.log(JSON.stringify({ ok: false, reason: 'invalid_json' }));
  process.exit(2);
}

let live = null;
let liveMeta = { ok: false };
if (livePath && existsSync(livePath)) {
  const parsed = readJson(livePath);
  live = parsed.type === 'SHARED' ? parsed : wrapLive(parsed);
  liveMeta = { ok: Boolean(live), reason: live ? 'file' : 'invalid_live_json' };
} else if (flowId) {
  liveMeta = await fetchLive(flowId);
  live = liveMeta.flow ?? null;
}

const operations = existsSync(mapPath) ? (readJson(mapPath).operations ?? {}) : {};
const source = live ? 'live' : 'anexo';
const flow = live ?? anexo;
const draftStatus = liveMeta.draftStatus ?? flow?.status ?? null;
const report = verifyTransport({ recipe, flow, operations, source, draftStatus });
report.live = { ok: liveMeta.ok === true, reason: liveMeta.reason ?? null, http: liveMeta.http ?? null };
report.comment = formatComment(report, pipeId || report.recipeId || 'hospedeiro');
report.chat = formatChat(report, pipeId || report.recipeId || 'hospedeiro');

if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'transporte.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(resolve(outDir, 'comment.txt'), `${report.comment}\n`);
  writeFileSync(resolve(outDir, 'chat.txt'), `${report.chat}\n`);
  if (live) writeFileSync(resolve(outDir, 'live.flow.json'), `${JSON.stringify(live, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 3);
