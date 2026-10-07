// Grava o JS traduzido nos steps CODE do flow.json. Mexe em
// settings.sourceCode.code e marca o step valid — piece, input, notes e encadeamento ficam iguais.
// Nao chama Pipefy. Nao edita mapa/KB/engine.
//
//   node scripts/aplicar-code-traduzido.mjs --flow-json flow.json --patch patch.json [--out outro.json]
//
// patch.json: { "step_3": "export const code = ..." }
//   ou { "step_3": { "code": "export const code = ...", "packageJson": "{\"dependencies\":{\"xlsx\":\"0.18.5\"}}" } }
// String grava só o code. Objeto também grava packageJson.
//
// Exit 0 = tudo aplicado. Exit 3 = algum step recusado/desconhecido. Exit 2 = arquivo/uso.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyCodeTranslations } from './lib/code-stubs.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

const flowPath = arg('--flow-json') ? resolve(arg('--flow-json')) : null;
const patchPath = arg('--patch') ? resolve(arg('--patch')) : null;
const outPath = arg('--out') ? resolve(arg('--out')) : flowPath;

if (!flowPath || !patchPath) {
  console.error('uso: node scripts/aplicar-code-traduzido.mjs --flow-json <flow.json> --patch <patch.json> [--out <flow.json>]');
  process.exit(2);
}
for (const path of [flowPath, patchPath]) {
  if (!existsSync(path)) {
    console.log(JSON.stringify({ ok: false, reason: 'file_not_found', path }));
    process.exit(2);
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const flow = readJson(flowPath);
const patch = readJson(patchPath);
if (!flow || !patch) {
  console.log(JSON.stringify({ ok: false, reason: 'invalid_json', flow: flowPath, patch: patchPath }));
  process.exit(2);
}

const result = applyCodeTranslations(flow, patch);
if (result.applied.length) writeFileSync(outPath, `${JSON.stringify(result.flow)}\n`);

const ok = result.unknown.length === 0 && result.rejected.length === 0;
console.log(
  JSON.stringify(
    {
      ok,
      applied: result.applied,
      unknown: result.unknown,
      rejected: result.rejected,
      pending: result.pending,
      flow: outPath,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 3);
