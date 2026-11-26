// Invariantes do grafo Activepieces: nome único, sem ciclo, sem o mesmo objeto
// em dois pais, router com um filho por ramo. Não chama Pipefy.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const LINK_KEYS = ['nextAction', 'firstLoopAction', 'onFailureAction'];

function isStep(node) {
  return Boolean(node && typeof node === 'object' && node.type);
}

/**
 * @param {unknown} flow
 */
export function inspectFlowGraph(flow) {
  const trigger = flow?.flows?.[0]?.trigger ?? flow?.trigger ?? null;
  const names = [];
  const missingNames = [];
  const cycles = [];
  const routerMismatches = [];
  let aliasing = false;
  const seen = new Set();

  const visit = (node, stack) => {
    if (!node || typeof node !== 'object') return;
    if (stack.has(node)) {
      cycles.push(typeof node.name === 'string' && node.name ? node.name : '(sem nome)');
      return;
    }
    if (seen.has(node)) {
      aliasing = true;
      return;
    }
    seen.add(node);
    if (isStep(node)) {
      if (typeof node.name !== 'string' || !node.name.trim()) missingNames.push(String(node.type));
      else names.push(node.name);
      if (node.type === 'ROUTER') {
        const branches = Array.isArray(node.settings?.branches) ? node.settings.branches.length : 0;
        const children = Array.isArray(node.children) ? node.children.length : 0;
        if (branches !== children) routerMismatches.push(node.name || '(sem nome)');
      }
    }
    const next = new Set(stack);
    next.add(node);
    for (const key of LINK_KEYS) visit(node[key], next);
    const forks = node.continueOnFailureBranches;
    if (forks && typeof forks === 'object') {
      visit(forks.onSuccess, next);
      visit(forks.onFailure, next);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child, next);
    }
  };

  visit(trigger, new Set());

  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  const duplicateNames = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name, count]) => ({ name, count }));

  return {
    ok: duplicateNames.length === 0 && missingNames.length === 0 && cycles.length === 0 && routerMismatches.length === 0 && !aliasing,
    totalSteps: names.length + missingNames.length,
    uniqueNames: counts.size,
    duplicateNames,
    missingNames,
    cycles,
    routerMismatches,
    aliasing,
  };
}

/** Copia flow.json para cada `<slug>.flow.json` da mesma pasta. */
export function syncNamedFlowCopy(flowPath) {
  const file = String(flowPath ?? '');
  if (basename(file) !== 'flow.json') return [];
  const dir = dirname(file);
  const raw = readFileSync(file);
  const updated = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.flow.json') || name === 'flow.json') continue;
    const dest = join(dir, name);
    writeFileSync(dest, raw);
    updated.push(dest);
  }
  return updated;
}
