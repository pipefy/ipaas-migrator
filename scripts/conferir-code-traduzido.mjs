// Segundo passo da conversão: o flow final não leva AP-MIGRATION-TODO.
// Grava code-lib.json ao lado do flow. Exit 4 se ainda houver stub.
//
//   node scripts/conferir-code-traduzido.mjs --flow-json flow.json

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { codeLibReport } from './lib/code-stubs.mjs';

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return null;
  return process.argv[i + 1];
}

const flowPath = arg('--flow-json');
if (!flowPath) {
  console.error('uso: node scripts/conferir-code-traduzido.mjs --flow-json <flow.json>');
  process.exit(2);
}

const flow = JSON.parse(readFileSync(resolve(flowPath), 'utf8'));
const report = codeLibReport(flow);
const side = resolve(dirname(resolve(flowPath)), 'code-lib.json');
writeFileSync(side, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, report: side }, null, 2));
process.exit(report.ok ? 0 : 4);
