// 1 receita Workato -> stdout: flow Activepieces + diagrama Mermaid + roteamento.
// Sem --force: operacao nao mapeada, JSON invalido, arquivo ausente
// ou gatilho sem piece (receita em branco) vao para manual_revision.
// ROUTER/Ruby com TODO ainda e ipaas_ready.
// O diagrama sai mesmo quando a transpilacao bloqueia.
//
// Uso: node src/run.mjs [caminho.json]
// Padrao: input/recipe.json

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, loadKb, loadMergedMap, ROOT } from './lib/load.ts';
import { ingest } from './lib/ingest.ts';
import { isEmptyWorkatoTrigger, parseRecipe } from './lib/parse-recipe.ts';
import { classifyOps } from './lib/classify.ts';
import { buildFlow } from './lib/flow-builder.ts';
import { emptyDiagram, recipeToDiagram, type RecipeDiagram } from './lib/diagram.ts';
import type { OpClassification, ParsedRecipe, ParsedStep } from './lib/types.ts';

interface Routing {
  status: 'OK' | 'ERROR';
  destination: 'ipaas_ready' | 'manual_revision';
  blocked_reason?: string;
  mapped_operations?: number;
  unmapped_operations?: number;
  unmapped_ops?: string[];
  has_router?: boolean;
  has_code_ruby?: boolean;
  todos?: number;
}

/** Texto que o flow 2 grava em `blocked_reason` no card. */
function formatUnmappedBlock(unmapped: OpClassification[]): {
  reason: string;
  notes: string[];
  keys: string[];
} {
  const keys = unmapped.map((o) => o.opKey);
  const listed = unmapped.map((o) => `${o.opKey} (${o.count}x)`).join('; ');
  const reason = [
    `${unmapped.length} operacao(oes) sem mapa em mappings/base-map.json.`,
    'O motor nao inventa piece/action; sem essas entradas nao gera o flow iPaaS.',
    `Faltando: ${listed}.`,
  ].join(' ');
  const notes = [
    reason,
    ...unmapped.map((o) => `${o.opKey} (${o.count}x) — ausente de mappings/base-map.json`),
  ];
  return { reason, notes, keys };
}

function recipePath(): string {
  const arg = process.argv[2];
  if (arg && !arg.startsWith('--')) return arg;
  return join(ROOT, 'input', 'recipe.json');
}

function hasKeyword(step: ParsedStep, keyword: string): boolean {
  if (step.keyword === keyword) return true;
  return step.children.some((child) => hasKeyword(child, keyword));
}

function blockedFlow(name: string, notes: string[]): unknown {
  const now = '1970-01-01T00:00:00.000Z';
  return {
    name,
    type: 'SHARED',
    summary: '',
    description: notes.join('\n'),
    tags: [],
    blogUrl: '',
    metadata: {},
    author: 'workato-migration',
    categories: [],
    pieces: ['@activepieces/piece-webhook'],
    flows: [
      {
        displayName: name,
        trigger: {
          name: 'trigger',
          valid: false,
          displayName: 'Webhook',
          type: 'PIECE_TRIGGER',
          nextAction: undefined,
          lastUpdatedDate: now,
          settings: {
            propertySettings: {
              authType: { type: 'MANUAL' },
              authFields: { type: 'MANUAL', schema: {} },
            },
            pieceName: '@activepieces/piece-webhook',
            pieceVersion: '0.1.35',
            triggerName: 'catch_webhook',
            input: { authType: 'none', authFields: {} },
          },
        },
        valid: false,
        schemaVersion: '20',
        notes,
      },
    ],
    status: 'PUBLISHED',
  };
}

function emit(flow: unknown, diagram: RecipeDiagram, routing: Routing): void {
  process.stdout.write(`${JSON.stringify(flow)}\n`);
  process.stdout.write(`${JSON.stringify(diagram)}\n`);
  process.stdout.write(`${JSON.stringify(routing)}\n`);
}

function fail(reason: string, extraNotes: string[] = [], diagram?: RecipeDiagram): void {
  const notes = [reason, ...extraNotes];
  emit(blockedFlow('Workato migration blocked', notes), diagram ?? emptyDiagram(reason), {
    status: 'ERROR',
    destination: 'manual_revision',
    blocked_reason: extraNotes.length ? `${reason}. ${extraNotes.join('; ')}` : reason,
  });
}

async function main(): Promise<void> {
  const input = recipePath();
  if (!existsSync(input)) {
    fail(`Receita ausente: ${input}`);
    return;
  }

  let items;
  try {
    items = await ingest(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`JSON da receita invalido: ${message}`);
    return;
  }

  if (items.length === 0) {
    fail('Nenhuma receita Workato encontrada no arquivo (campo code ausente).');
    return;
  }

  const it = items[0]!;
  let recipe: ParsedRecipe;
  try {
    recipe = parseRecipe(it.json, it.file);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`Falha ao parsear a arvore code: ${message}`);
    return;
  }
  const diagram = recipeToDiagram(recipe);
  const cfg = await loadConfig();
  const { kb } = await loadKb(cfg);
  const { merged } = await loadMergedMap(cfg);
  const ops = classifyOps(recipe.opCounts, merged, kb);
  const unmapped = ops.filter((o) => o.status === 'unmapped');
  const mapped = ops.filter((o) => o.status === 'mapped').length;

  if (unmapped.length) {
    const block = formatUnmappedBlock(unmapped);
    emit(blockedFlow('Workato migration blocked', block.notes), diagram, {
      status: 'ERROR',
      destination: 'manual_revision',
      blocked_reason: block.reason,
      mapped_operations: mapped,
      unmapped_operations: unmapped.length,
      unmapped_ops: block.keys,
      has_router: hasKeyword(recipe.root, 'if'),
      has_code_ruby: recipe.hasRuby,
    });
    return;
  }

  if (isEmptyWorkatoTrigger(recipe.root)) {
    const reason = [
      'Gatilho sem piece: a receita nao tem provider/name no trigger (applications vazias).',
      'Sem piece o iPaaS recusa IMPORT_FLOW; fica em revisao de transpilacao.',
    ].join(' ');
    emit(blockedFlow(recipe.name, [reason]), diagram, {
      status: 'ERROR',
      destination: 'manual_revision',
      blocked_reason: reason,
      mapped_operations: mapped,
      unmapped_operations: 0,
      has_router: hasKeyword(recipe.root, 'if'),
      has_code_ruby: recipe.hasRuby,
    });
    return;
  }

  const { flow, todos } = buildFlow(recipe, merged, kb);
  emit(flow, diagram, {
    status: 'OK',
    destination: 'ipaas_ready',
    mapped_operations: mapped,
    unmapped_operations: 0,
    has_router: hasKeyword(recipe.root, 'if'),
    has_code_ruby: recipe.hasRuby,
    todos: todos.length,
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  fail(`Falha no motor: ${message}`);
});
