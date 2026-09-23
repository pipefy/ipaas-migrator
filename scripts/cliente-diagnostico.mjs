// Le o recipe.json e imprime pipes, fases, conexoes, gatilho e cron.
// Nao chama Pipefy. Nao edita mapa.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRecipeProfile } from './lib/recipe-profile.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
}

const PHASE_KEY = /phase|destination_column|dest_phase|to_phase|column_id/i;
const CRON_KEY = /cron/i;

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const v of Object.values(node)) {
    if (v && typeof v === 'object') walk(v, visit);
  }
}

function diagnose(recipe) {
  const profile = parseRecipeProfile(recipe);
  const code = typeof recipe.code === 'string' ? JSON.parse(recipe.code) : recipe.code;
  const phases = new Set();
  const crons = new Set();

  walk(code, (n) => {
    if (n.keyword === 'trigger' || n.provider === 'clock') {
      const input = n.input ?? {};
      for (const [k, v] of Object.entries(input)) {
        if (CRON_KEY.test(k) && v) crons.add(String(v));
      }
    }
    const input = n.input;
    if (!input || typeof input !== 'object') return;
    for (const [k, v] of Object.entries(input)) {
      if (!PHASE_KEY.test(k) || v == null || v === '') continue;
      if (typeof v === 'object') continue;
      phases.add(String(v));
    }
  });

  return {
    name: recipe.name ?? profile.recipe,
    id: profile.recipeId,
    trigger: profile.trigger,
    cron: [...crons],
    pipes: {
      trigger: profile.triggerPipe,
      write: profile.writePipes,
      read: profile.readPipes,
      touched: profile.touched,
      note: 'O pipe do Integrations (onde o flow mora) pode ser outro que estes.',
    },
    phases: [...phases],
    connections: {
      pipefy: profile.pipefyConns,
      external: profile.externals,
      http: profile.httpConns,
    },
  };
}

const recipePath = resolve(arg('--recipe') ?? '');
if (!recipePath || !existsSync(recipePath)) {
  console.log(JSON.stringify({ ok: false, reason: 'recipe_not_found', recipe: recipePath }));
  process.exit(2);
}

let recipe;
try {
  recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
} catch {
  console.log(JSON.stringify({ ok: false, reason: 'invalid_json', recipe: recipePath }));
  process.exit(2);
}

try {
  console.log(JSON.stringify({ ok: true, ...diagnose(recipe) }, null, 2));
} catch (err) {
  console.log(JSON.stringify({ ok: false, reason: 'diagnose_failed', error: String(err?.message ?? err) }));
  process.exit(1);
}
