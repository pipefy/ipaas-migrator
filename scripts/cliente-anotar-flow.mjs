// Coloca nota adesiva no passo de cada achado do transporte.json.
//
//   node scripts/cliente-anotar-flow.mjs \
//     --flow-json output/<id>/flow.json \
//     --transporte output/<id>/transporte.json \
//     --lang pt
//
// Só escreve o flow.json. Não chama Pipefy. Não edita mapa, KB nem engine.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { annotateFlow } from './lib/cliente-anotar-flow.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return null;
  return process.argv[i + 1];
}

const flowPath = arg('--flow-json');
const reportPath = arg('--transporte');
const lang = arg('--lang') ?? 'pt';

if (!flowPath || !reportPath) {
  console.error(
    'uso: node scripts/cliente-anotar-flow.mjs --flow-json <flow.json> --transporte <transporte.json> [--lang pt|en|es]',
  );
  process.exit(2);
}

const flowFile = resolve(flowPath);
const reportFile = resolve(reportPath);
if (!existsSync(flowFile) || !existsSync(reportFile)) {
  console.log(JSON.stringify({ ok: false, reason: 'file_not_found' }));
  process.exit(2);
}

let flow;
let report;
try {
  flow = JSON.parse(readFileSync(flowFile, 'utf8'));
  report = JSON.parse(readFileSync(reportFile, 'utf8'));
} catch {
  console.log(JSON.stringify({ ok: false, reason: 'invalid_json' }));
  process.exit(2);
}

const result = annotateFlow(flow, report, lang);
writeFileSync(flowFile, `${JSON.stringify(result.flow, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, added: result.added, notes: result.notes, lang }));
