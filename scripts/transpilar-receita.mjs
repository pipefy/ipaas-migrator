// Roda o motor numa receita Workato e grava flow.json + diagrama PNG + roteamento.
// Nao chama Pipefy. Nao edita mapa/KB. Uma linha JSON por objeto (sem parser de chaves).
//
//   node scripts/transpilar-receita.mjs --recipe /tmp/card.recipe.json --out /tmp/transpilar/card
//   [--connection-ids id,id] [--connections-json c.json] [--hints-text 'Conexão: id']

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRecipeProfile } from './lib/recipe-profile.mjs';
import { applyBindings, hintsFromArgv, planBindings } from './lib/bind-connections.mjs';
import { writeMermaidPng } from './lib/mermaid-png.mjs';
import { slugify } from './lib/slug.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recipePath = resolve(arg('--recipe') ?? '');
const outDir = resolve(arg('--out') ?? '');
const connectionsPath = arg('--connections-json');
const hints = hintsFromArgv();

if (!recipePath || !outDir) {
  console.error('uso: node scripts/transpilar-receita.mjs --recipe <recipe.json> --out <dir> [--connection-ids id,id] [--connections-json <c>]');
  process.exit(2);
}

await main();

async function main() {
  if (!existsSync(recipePath)) {
    console.log(JSON.stringify({ ok: false, reason: 'recipe_not_found', recipe: recipePath }));
    process.exit(2);
  }

  const raw = readFileSync(recipePath, 'utf8');
  let recipe;
  try {
    recipe = JSON.parse(raw);
  } catch {
    console.log(JSON.stringify({ ok: false, reason: 'invalid_json', recipe: recipePath }));
    process.exit(2);
  }
  const profile = parseRecipeProfile(recipe);
  const tables = (profile.tables ?? []).filter((t) => t && t !== 'table');
  const hasTable = (profile.tables ?? []).length > 0;

  mkdirSync(outDir, { recursive: true });
  const tsx = resolve(root, 'node_modules/.bin/tsx');
  const engine = resolve(root, 'engine/run.ts');
  if (!existsSync(tsx)) {
    console.log(JSON.stringify({ ok: false, reason: 'tsx_missing', hint: 'npm ci' }));
    process.exit(2);
  }

  const ran = spawnSync(tsx, [engine, recipePath], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (ran.error || ran.status) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: 'engine_failed',
        status: ran.status,
        stderr: String(ran.stderr ?? '').slice(0, 400),
      }),
    );
    process.exit(1);
  }

  const objects = [];
  for (const line of String(ran.stdout ?? '').split(/\n/)) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      objects.push(JSON.parse(t));
    } catch {
      /* linha incompleta — ignora */
    }
  }

  const flow = objects.find((o) => o?.type === 'SHARED');
  const diagram = objects.find((o) => o?.type === 'recipe_diagram');
  const routing = objects.find((o) => o?.destination === 'ipaas_ready' || o?.destination === 'manual_revision');

  if (!flow || !routing) {
    console.log(JSON.stringify({ ok: false, reason: 'engine_output_incomplete', parsed: objects.length }));
    process.exit(1);
  }

  const slug = slugify(recipe.name ?? flow.flows?.[0]?.displayName ?? flow.name ?? 'flow');
  const flowPath = resolve(outDir, 'flow.json');
  const flowNamedPath = resolve(outDir, `${slug}.flow.json`);
  const mermaidPath = resolve(outDir, 'recipe_diagram.mmd');
  const pngPath = resolve(outDir, 'recipe_diagram.png');
  const routingPath = resolve(outDir, 'routing.json');
  const mermaid = String(diagram?.mermaid ?? 'flowchart TD\n  empty["sem diagrama"]\n');
  let outFlow = flow;
  let bound = null;
  if (hints.length) {
    let listed = [];
    if (connectionsPath && existsSync(connectionsPath)) {
      try {
        listed = JSON.parse(readFileSync(connectionsPath, 'utf8'));
      } catch {
        listed = [];
      }
    }
    const plan = planBindings({
      recipe,
      flow,
      connections: listed,
      placeholders: [],
      pipeId: arg('--pipe-id') ?? '',
      hints,
      allowSynthetic: true,
    });
    if (plan.bindings.length) {
      outFlow = applyBindings(structuredClone(flow), plan.bindings).flow;
    }
    bound = {
      ready: plan.ready,
      bindings: plan.bindings.map((b) => ({
        label: b.label,
        piece: b.piece,
        externalId: b.externalId,
        given: b.given,
      })),
      missing: plan.missing,
    };
    writeFileSync(resolve(outDir, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  }
  writeFileSync(flowPath, `${JSON.stringify(outFlow)}\n`);
  copyFileSync(flowPath, flowNamedPath);
  writeFileSync(mermaidPath, mermaid);
  writeFileSync(routingPath, `${JSON.stringify(routing, null, 2)}\n`);
  const todos = routing.todos ?? routing.unmapped_operations ?? [];
  const statusPath = resolve(outDir, 'status.json');
  writeFileSync(
    statusPath,
    `${JSON.stringify(
      {
        receita: recipe.name ?? null,
        id: recipe.id != null ? String(recipe.id) : null,
        arquivo: true,
        importacao: false,
        configuracao: bound?.missing?.length ? 'incompleta' : bound?.ready ? 'ligada' : 'incompleta',
        logica: Array.isArray(todos) && todos.length ? 'pendente' : routing.destination === 'manual_revision' ? 'pendente' : 'mapeada',
        teste: false,
        mapped: routing.mapped_operations ?? null,
        unmapped: routing.unmapped_operations ?? null,
      },
      null,
      2,
    )}\n`,
  );
  const png = await writeMermaidPng(mermaid, pngPath);

  console.log(
    JSON.stringify(
      {
        ok: true,
        destination: routing.destination,
        status: routing.status,
        mapped: routing.mapped_operations ?? null,
        unmapped: routing.unmapped_operations ?? null,
        todos: routing.todos ?? null,
        hasRouter: routing.has_router ?? null,
        hasCodeRuby: routing.has_code_ruby ?? null,
        blockedReason: routing.blocked_reason ?? null,
        displayName: flow.flows?.[0]?.displayName ?? flow.name,
        triggerValid: flow.flows?.[0]?.trigger?.valid ?? null,
        hasTable,
        tables,
        migrateTo: hasTable ? 'table' : 'pipe',
        connections: bound,
      png: png.ok
        ? { ok: true, via: png.via, path: png.path, bytes: png.bytes }
        : { ok: false, reason: png.reason, error: png.error ?? null },
        files: {
          flow: flowPath,
          flowNamed: flowNamedPath,
          png: png.ok ? png.path : null,
          mermaid: mermaidPath,
          routing: routingPath,
          status: statusPath,
        },
      },
      null,
      2,
    ),
  );
}
