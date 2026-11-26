// Tira pacote npm dos steps CODE que o motor reconhece (template `xlsx`).
// O resto volta em `manual` para a skill reescrever. Não chama Pipefy.
//
//   npx tsx scripts/sem-dependencia.mjs --flow-json flow.json
//   npx tsx scripts/sem-dependencia.mjs --flow-json flow.json --patch patch.json
//
// Sem --patch: troca o template do motor pelo leitor puro e grava se houve troca.
// Com --patch: { "step_3": "<js sem require/import de pacote>" }. Zera packageJson.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { rewriteEngineXlsxImport } from '../engine/lib/xlsx-csv.ts';
import { applyDependencyFree, listCodeDependencies, stripKnownDependencies } from './lib/code-deps.mjs';
import { inspectFlowGraph, syncNamedFlowCopy } from './lib/flow-graph-guard.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

const flowPath = arg('--flow-json') ? resolve(arg('--flow-json')) : null;
const patchPath = arg('--patch') ? resolve(arg('--patch')) : null;
const outPath = arg('--out') ? resolve(arg('--out')) : flowPath;

if (!flowPath) {
  console.error('uso: npx tsx scripts/sem-dependencia.mjs --flow-json <flow.json> [--patch <patch.json>] [--out <flow.json>]');
  process.exit(2);
}

function writeFlow(flow) {
  if (!inspectFlowGraph(flow).ok) {
    console.log(JSON.stringify({ ok: false, reason: 'invalid_flow_graph' }));
    process.exit(3);
  }
  writeFileSync(outPath, `${JSON.stringify(flow)}\n`);
  if (basename(outPath) === 'flow.json') syncNamedFlowCopy(outPath);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

if (!existsSync(flowPath) || !readJson(flowPath)) {
  console.log(JSON.stringify({ ok: false, reason: 'file_not_found', path: flowPath }));
  process.exit(2);
}

if (patchPath) {
  if (!existsSync(patchPath)) {
    console.log(JSON.stringify({ ok: false, reason: 'file_not_found', path: patchPath }));
    process.exit(2);
  }
  const patch = readJson(patchPath);
  if (!patch) {
    console.log(JSON.stringify({ ok: false, reason: 'invalid_json', patch: patchPath }));
    process.exit(2);
  }
  const result = applyDependencyFree(readJson(flowPath), patch);
  if (result.applied.length) writeFlow(result.flow);
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
}

const before = listCodeDependencies(readJson(flowPath));
const result = stripKnownDependencies(readJson(flowPath), rewriteEngineXlsxImport);
if (result.rewritten.length) writeFlow(result.flow);
console.log(
  JSON.stringify(
    {
      ok: result.manual.length === 0,
      rewritten: result.rewritten,
      manual: result.manual,
      before,
      flow: outPath,
    },
    null,
    2,
  ),
);
process.exit(0);
