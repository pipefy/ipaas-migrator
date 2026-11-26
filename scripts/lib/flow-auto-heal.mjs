// Cura determinística de grafo e de erros mecânicos do verificador.
// Não chama Pipefy. Não mascara duplicação em massa, ciclo ou alias.

import { inspectFlowGraph } from './flow-graph-guard.mjs';

const LINK_KEYS = ['nextAction', 'firstLoopAction', 'onFailureAction'];
const PIPEFY_PIECE = '@activepieces/piece-pipefy';
const TABLES_PIECE = '@activepieces/piece-tables';
const LOOKUP_HANDOVER = 'ATENÇÃO NA VIRADA';
const OUTPUT_PILL_RE = /\{\{\s*([A-Za-z_]\w*)\s*(?:\[\s*'output'\s*\]|\.output\b)/g;

function isStep(node) {
  return Boolean(node && typeof node === 'object' && node.type);
}

function triggerOf(flow) {
  return flow?.flows?.[0]?.trigger ?? flow?.trigger ?? null;
}

function notesOf(flow) {
  if (Array.isArray(flow?.flows?.[0]?.notes)) return flow.flows[0].notes;
  if (Array.isArray(flow?.notes)) return flow.notes;
  return null;
}

export function collectGraphSteps(flow) {
  const steps = [];
  const seen = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (isStep(node)) steps.push(node);
    for (const key of LINK_KEYS) visit(node[key]);
    const forks = node.continueOnFailureBranches;
    if (forks && typeof forks === 'object') {
      visit(forks.onSuccess);
      visit(forks.onFailure);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };
  visit(triggerOf(flow));
  return steps;
}

function subtreeKey(node) {
  const seen = new WeakSet();
  return JSON.stringify(node, (_key, value) => {
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[cycle]';
      seen.add(value);
    }
    return value;
  });
}

function cascadingDuplicate(steps) {
  const groups = new Map();
  for (const step of steps) {
    if (typeof step.name !== 'string' || !step.name) continue;
    const list = groups.get(step.name) ?? [];
    list.push(subtreeKey(step));
    groups.set(step.name, list);
  }
  for (const keys of groups.values()) {
    if (keys.length > 1 && new Set(keys).size < keys.length) return true;
  }
  return false;
}

function takenNames(steps) {
  return new Set(steps.map((step) => step.name).filter((name) => typeof name === 'string' && name));
}

function nextFree(taken, prefix) {
  let n = 1;
  while (taken.has(`${prefix}_${n}`)) n += 1;
  const name = `${prefix}_${n}`;
  taken.add(name);
  return name;
}

function prefixFor(type) {
  if (type === 'ROUTER') return 'router';
  if (type === 'LOOP_ON_ITEMS') return 'loop';
  return 'step';
}

function pillMentions(step, name) {
  const settings = step?.settings ? { ...step.settings } : {};
  delete settings.sourceCode;
  const blob = JSON.stringify(settings);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\{\\{\\s*${escaped}(?![\\w])`).test(blob);
}

function assignMissingNames(steps, applied) {
  const taken = takenNames(steps);
  for (const step of steps) {
    if (typeof step.name === 'string' && step.name.trim()) continue;
    const name = nextFree(taken, prefixFor(step.type));
    step.name = name;
    applied.push({ kind: 'passo sem nome', step: name, detail: `nome ${name}` });
  }
}

function stepSignature(node) {
  return JSON.stringify(node, (key, value) => {
    if (LINK_KEYS.includes(key) || key === 'children' || key === 'continueOnFailureBranches' || key === 'lastUpdatedDate') {
      return undefined;
    }
    return value;
  });
}

function collapseRepeatedClones(flow, applied) {
  const counts = new Map();
  for (const step of collectGraphSteps(flow)) {
    if (typeof step.name !== 'string' || !step.name) continue;
    counts.set(step.name, (counts.get(step.name) ?? 0) + 1);
  }
  const kept = new Map();
  let removed = 0;
  const seen = new Set();
  const remember = (node) => {
    if (isStep(node) && typeof node.name === 'string' && node.name && !kept.has(node.name)) {
      kept.set(node.name, stepSignature(node));
    }
  };
  const isRepeatedClone = (node) => {
    if (!isStep(node) || typeof node.name !== 'string' || !node.name) return false;
    const previous = kept.get(node.name);
    return previous === stepSignature(node) && (counts.get(node.name) ?? 0) >= 3;
  };
  const firstFresh = (node, guard) => {
    if (!node || typeof node !== 'object' || guard.has(node)) return null;
    guard.add(node);
    if (isStep(node) && node.name && !isRepeatedClone(node)) return node;
    for (const key of LINK_KEYS) {
      const found = firstFresh(node[key], guard);
      if (found) return found;
    }
    const forks = node.continueOnFailureBranches;
    if (forks && typeof forks === 'object') {
      const found = firstFresh(forks.onSuccess, guard) || firstFresh(forks.onFailure, guard);
      if (found) return found;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = firstFresh(child, guard);
        if (found) return found;
      }
    }
    return null;
  };
  const place = (child) => {
    if (!isRepeatedClone(child)) {
      remember(child);
      return child;
    }
    removed += 1;
    const hoisted = firstFresh(child, new Set());
    remember(hoisted);
    return hoisted;
  };
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    remember(node);
    for (const key of LINK_KEYS) {
      const next = place(node[key]);
      if (next !== node[key]) node[key] = next;
      visit(node[key]);
    }
    const forks = node.continueOnFailureBranches;
    if (forks && typeof forks === 'object') {
      for (const key of ['onSuccess', 'onFailure']) {
        const next = place(forks[key]);
        if (next !== forks[key]) forks[key] = next;
        visit(forks[key]);
      }
    }
    if (Array.isArray(node.children)) {
      node.children.forEach((child, index) => {
        const next = place(child);
        if (next !== child) node.children[index] = next;
        visit(node.children[index]);
      });
    }
  };
  visit(triggerOf(flow));
  if (removed) {
    const names = [...counts.entries()].filter(([, count]) => count >= 3).map(([name]) => name);
    applied.push({
      kind: 'nome repetido',
      step: names.join(', '),
      detail: `${removed} copia(s) removida(s)`,
    });
  }
  return removed;
}

function renameDuplicates(steps, report, applied, skipped, collapsed = false) {
  const explosion = [...(report?.revisar ?? []), ...(report?.bloqueia ?? [])].some((item) => item?.kind === 'explosão de passos');
  const live = inspectFromSteps(steps);
  if ((!collapsed && explosion) || live.cycles.length || live.aliasing || cascadingDuplicate(steps)) {
    if (live.duplicateNames.length) {
      skipped.push({
        kind: 'nome repetido',
        step: live.duplicateNames.map((item) => item.name).join(', '),
        reason: 'duplicacao_em_massa',
      });
    }
    return;
  }
  const groups = new Map();
  steps.forEach((step, index) => {
    if (typeof step.name !== 'string' || !step.name) return;
    const list = groups.get(step.name) ?? [];
    list.push({ step, index });
    groups.set(step.name, list);
  });
  const taken = takenNames(steps);
  for (const [name, occurrences] of groups) {
    if (occurrences.length < 2) continue;
    const ambiguous = occurrences.slice(1).some(({ index }) =>
      steps.slice(index).some((step) => pillMentions(step, name)),
    );
    if (ambiguous) {
      skipped.push({ kind: 'nome repetido', step: name, reason: 'referencia_ambigua' });
      continue;
    }
    const prefix = name.replace(/_\d+$/, '') || prefixFor(occurrences[0].step.type);
    for (const { step } of occurrences.slice(1)) {
      const renamed = nextFree(taken, prefix);
      step.name = renamed;
      applied.push({ kind: 'nome repetido', step: renamed, detail: `${name} virou ${renamed}` });
    }
  }
}

function inspectFromSteps(steps) {
  if (!steps.length) return inspectFlowGraph({});
  const head = steps[0];
  return inspectFlowGraph({ flows: [{ trigger: head }] });
}

function alignRouters(steps, applied, skipped) {
  for (const step of steps) {
    if (step.type !== 'ROUTER') continue;
    const branches = step.settings?.branches;
    if (!Array.isArray(branches) || !Array.isArray(step.children)) {
      skipped.push({ kind: 'router desalinhado', step: step.name ?? '', reason: 'filho_extra' });
      continue;
    }
    const hasFallback = branches.some((branch) => branch?.branchType === 'FALLBACK');
    if (step.children.length === branches.length + 1 && step.children.at(-1) == null && !hasFallback) {
      branches.push({ branchName: 'Senao', branchType: 'FALLBACK' });
      applied.push({ kind: 'router desalinhado', step: step.name ?? '', detail: 'ramo Senao' });
      continue;
    }
    while (step.children.length > branches.length && step.children.at(-1) == null) step.children.pop();
    if (step.children.length < branches.length) {
      while (step.children.length < branches.length) step.children.push(null);
      applied.push({ kind: 'router desalinhado', step: step.name ?? '', detail: 'filho vazio' });
      continue;
    }
    if (step.children.length !== branches.length && step.children.slice(branches.length).some((child) => child != null)) {
      skipped.push({ kind: 'router desalinhado', step: step.name ?? '', reason: 'filho_extra' });
    }
  }
}

function skipStructural(steps, skipped) {
  const graph = inspectFromSteps(steps);
  if (graph.cycles.length) {
    skipped.push({ kind: 'ciclo no grafo', step: graph.cycles.join(', '), reason: 'ciclo' });
  }
  if (graph.aliasing) {
    skipped.push({ kind: 'ciclo no grafo', step: '', reason: 'aliasing' });
  }
}

function rewriteTree(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => rewriteTree(item, fn));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'sourceCode') {
      out[key] = child;
      continue;
    }
    out[fn(key)] = rewriteTree(child, fn);
  }
  return out;
}

function bracketsFromDots(text) {
  return String(text).replace(/\{\{[^{}]*\}\}/g, (pill) => {
    if (!/\{\{\s*[A-Za-z_]\w*\.[A-Za-z_]/.test(pill)) return pill;
    return pill.replace(/\.([A-Za-z_]\w*)/g, "['$1']");
  });
}

function healDotted(steps, applied) {
  for (const step of steps) {
    if (!step.settings) continue;
    const before = JSON.stringify(step.settings);
    step.settings = rewriteTree(step.settings, bracketsFromDots);
    if (JSON.stringify(step.settings) !== before) {
      applied.push({ kind: 'datapill ponto', step: step.name ?? '', detail: 'colchetes' });
    }
  }
}

function codeReturnsOutputKey(step) {
  const raw = String(step?.settings?.sourceCode?.code ?? step?.settings?.sourceCode ?? '');
  const code = raw.includes('AP-MIGRATION-TODO') ? raw : raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return /[{,]\s*["']?output["']?\s*:/.test(code);
}

function outputStripNames(steps) {
  const names = new Set();
  for (const step of steps) {
    if (step.name === 'trigger' || step.type === 'LOOP_ON_ITEMS') names.add(step.name);
    if (String(step.settings?.pieceName ?? '') === PIPEFY_PIECE && step.name) names.add(step.name);
    if (step.type === 'CODE' && step.name && !codeReturnsOutputKey(step)) names.add(step.name);
  }
  if (steps.some((step) => step.name === 'trigger')) names.add('trigger');
  return names;
}

function stripOutputPrefix(text, names) {
  return String(text).replace(OUTPUT_PILL_RE, (full, name) => {
    if (!names.has(name)) return full;
    return `{{${name}`;
  });
}

function healOutput(steps, applied) {
  const names = outputStripNames(steps);
  for (const step of steps) {
    if (!step.settings) continue;
    const before = JSON.stringify(step.settings);
    step.settings = rewriteTree(step.settings, (text) => stripOutputPrefix(text, names));
    if (JSON.stringify(step.settings) !== before) {
      applied.push({ kind: 'datapill output', step: step.name ?? '', detail: 'sem output na frente' });
    }
  }
}

function lookupIds(recipe) {
  const ids = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const provider = String(node.provider ?? '');
    const name = String(node.name ?? '');
    const input = node.input && typeof node.input === 'object' ? node.input : {};
    const op = `${provider}/${name}`;
    const raw = op.startsWith('lookup_table/') || provider === 'lookup_table'
      ? input.lookup_table_id
      : provider.startsWith('workato_db_table')
        ? input.table_id
        : null;
    if (raw != null && /^\d+$/.test(String(raw).trim())) ids.add(String(raw).trim());
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') walk(value);
    }
  };
  walk(recipe?.code ?? recipe);
  return ids;
}

function healTables(steps, recipe, applied) {
  const ids = lookupIds(recipe);
  for (const step of steps) {
    if (String(step.settings?.pieceName ?? '') !== TABLES_PIECE) continue;
    const tableId = String(step.settings?.input?.table_id ?? '').trim();
    if (tableId && ids.has(tableId)) {
      step.settings.input.table_id = '';
      applied.push({ kind: 'lookup table_id', step: step.name ?? '', detail: 'table_id vazio' });
    }
    const filters = step.settings?.input?.filters?.filters;
    if (!Array.isArray(filters)) continue;
    let changed = false;
    for (const filter of filters) {
      if (filter?.operator && filter.operator !== String(filter.operator).toLowerCase()) {
        filter.operator = String(filter.operator).toLowerCase();
        changed = true;
      }
    }
    if (changed) applied.push({ kind: 'filtro operador', step: step.name ?? '', detail: 'eq' });
  }
}

function informative(content) {
  if (content.includes(LOOKUP_HANDOVER)) return false;
  if (/n[ãa]o traz esse teto/i.test(content)) return false;
  return content.includes('AVISO: repeat adaptado') || content.includes('query_list implementada') || content.includes('Foi adaptada');
}

function dropInformativeNotes(flow, applied) {
  const notes = notesOf(flow);
  if (!notes) return;
  const before = notes.length;
  const kept = notes.filter((note) => !informative(String(note?.content ?? '')));
  if (kept.length === before) return;
  if (Array.isArray(flow?.flows?.[0]?.notes)) flow.flows[0].notes = kept;
  else flow.notes = kept;
  applied.push({ kind: 'nota informativa', step: '', detail: `${before - kept.length} nota(s)` });
}

function sameJson(left, right) {
  const encode = (value) => {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, item) => {
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[ref]';
        seen.add(item);
      }
      return item;
    });
  };
  return encode(left) === encode(right);
}

function worseGraph(before, after) {
  return after.cycles.length > before.cycles.length
    || (after.aliasing && !before.aliasing)
    || after.missingNames.length > before.missingNames.length
    || after.routerMismatches.length > before.routerMismatches.length;
}

/**
 * @param {{ flow: unknown, recipe?: unknown, report?: { revisar?: { kind?: string }[], bloqueia?: { kind?: string }[] } }} input
 */
export function autoHealFlow({ flow, recipe = null, report = null } = {}) {
  const next = structuredClone(flow);
  const applied = [];
  const skipped = [];
  const beforeGraph = inspectFlowGraph(next);
  let steps = collectGraphSteps(next);
  skipStructural(steps, skipped);
  if (!beforeGraph.cycles.length && !beforeGraph.aliasing) {
    const removed = collapseRepeatedClones(next, applied);
    steps = collectGraphSteps(next);
    renameDuplicates(steps, report, applied, skipped, removed > 0);
    assignMissingNames(steps, applied);
    alignRouters(steps, applied, skipped);
  }
  healDotted(steps, applied);
  healOutput(steps, applied);
  healTables(steps, recipe, applied);
  dropInformativeNotes(next, applied);
  const afterGraph = inspectFlowGraph(next);
  if (worseGraph(beforeGraph, afterGraph)) {
    return { changed: false, flow, applied: [], skipped };
  }
  const changed = !sameJson(next, flow);
  return { changed, flow: changed ? next : flow, applied, skipped };
}
