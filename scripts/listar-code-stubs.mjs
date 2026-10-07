// Lista os steps CODE que o motor deixou com AP-MIGRATION-TODO.
// Nao chama Pipefy. Nao edita mapa/KB/engine. So le.
//
//   node scripts/listar-code-stubs.mjs --flow-json flow.json [--recipe recipe.json] [--out dir]
//
// Exit 0 = leu. Exit 2 = arquivo/uso.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listCodeStubs } from './lib/code-stubs.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

const flowPath = arg('--flow-json') ? resolve(arg('--flow-json')) : null;
const recipePath = arg('--recipe') ? resolve(arg('--recipe')) : null;
const outDir = arg('--out') ? resolve(arg('--out')) : null;

if (!flowPath) {
  console.error('uso: node scripts/listar-code-stubs.mjs --flow-json <flow.json> [--recipe <recipe.json>] [--out <dir>]');
  process.exit(2);
}
if (!existsSync(flowPath)) {
  console.log(JSON.stringify({ ok: false, reason: 'file_not_found', flow: flowPath }));
  process.exit(2);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const flow = readJson(flowPath);
if (!flow) {
  console.log(JSON.stringify({ ok: false, reason: 'invalid_json', flow: flowPath }));
  process.exit(2);
}
const recipe = recipePath && existsSync(recipePath) ? readJson(recipePath) : null;

const stubs = listCodeStubs(flow, recipe);
const report = { ok: true, total: stubs.length, stubs };

if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'code-stubs.json'), `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));
