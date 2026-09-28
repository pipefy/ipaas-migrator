// Lista e tira pacotes npm dos steps CODE. Não chama Pipefy.
// Builtin do Node (`node:zlib`, `fs`, `Buffer`) não conta.

const CHILD_KEYS = ['nextAction', 'firstLoopAction', 'onFailureAction'];

const BUILTIN = new Set([
  'assert',
  'buffer',
  'crypto',
  'events',
  'fs',
  'http',
  'https',
  'os',
  'path',
  'punycode',
  'querystring',
  'stream',
  'string_decoder',
  'timers',
  'url',
  'util',
  'zlib',
]);

const IMPORT_RE = /\b(?:require\s*\(\s*|from\s+)['"]([^'"]+)['"]/g;

function walk(node, acc) {
  if (!node || typeof node !== 'object') return acc;
  if (node.type) acc.push(node);
  for (const key of CHILD_KEYS) if (node[key]) walk(node[key], acc);
  const branches = node.continueOnFailureBranches;
  if (branches) {
    walk(branches.onSuccess, acc);
    walk(branches.onFailure, acc);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) walk(child, acc);
  }
  return acc;
}

export function flowCodeSteps(flow) {
  const out = [];
  for (const item of flow?.flows ?? []) walk(item?.trigger, out);
  if (!out.length && flow?.trigger) walk(flow.trigger, out);
  return out.filter((step) => step.type === 'CODE');
}

export function importedPackages(code) {
  const out = [];
  const seen = new Set();
  for (const match of String(code ?? '').matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (!spec || spec.startsWith('.') || spec.startsWith('node:')) continue;
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (!name || BUILTIN.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

export function declaredPackages(packageJson) {
  if (!packageJson || packageJson === '{}') return [];
  try {
    const deps = JSON.parse(String(packageJson)).dependencies ?? {};
    return Object.keys(deps);
  } catch {
    return String(packageJson).includes('"dependencies"') ? ['?'] : [];
  }
}

export function packagesOf(step) {
  const code = String(step?.settings?.sourceCode?.code ?? '');
  const declared = declaredPackages(step?.settings?.sourceCode?.packageJson);
  return [...new Set([...importedPackages(code), ...declared])];
}

export function listCodeDependencies(flow) {
  return flowCodeSteps(flow)
    .map((step) => ({ name: step.name, packages: packagesOf(step) }))
    .filter((item) => item.packages.length);
}

/**
 * `rewrite(code)` devolve o JS sem pacote, ou null quando não reconhece.
 * Step reescrito sai com `packageJson` `{}`.
 */
export function stripKnownDependencies(flow, rewrite) {
  const out = structuredClone(flow);
  const rewritten = [];
  const manual = [];
  for (const step of flowCodeSteps(out)) {
    const packages = packagesOf(step);
    if (!packages.length) continue;
    const code = String(step.settings?.sourceCode?.code ?? '');
    const next = rewrite(code);
    if (!next || importedPackages(next).length) {
      manual.push({ name: step.name, packages });
      continue;
    }
    step.settings.sourceCode = { ...step.settings.sourceCode, code: next, packageJson: '{}' };
    rewritten.push(step.name);
  }
  return { flow: out, rewritten, manual };
}

function patchEntries(patch) {
  const raw = patch && typeof patch === 'object' && patch.steps ? patch.steps : patch;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw);
}

/**
 * Grava JS sem pacote e zera `packageJson`. Recusa se o texto ainda importa lib.
 */
export function applyDependencyFree(flow, patch) {
  const out = structuredClone(flow);
  const byName = new Map(flowCodeSteps(out).map((step) => [step.name, step]));
  const applied = [];
  const unknown = [];
  const rejected = [];
  for (const [name, value] of patchEntries(patch)) {
    const step = byName.get(name);
    if (!step) {
      unknown.push(name);
      continue;
    }
    const code = typeof value === 'string' ? value : String(value?.code ?? '');
    if (!code.trim()) {
      rejected.push({ name, reason: 'codigo_vazio' });
      continue;
    }
    if (!/export\s+const\s+code\s*=/.test(code)) {
      rejected.push({ name, reason: 'sem_export_const_code' });
      continue;
    }
    if (importedPackages(code).length) {
      rejected.push({ name, reason: 'ainda_tem_pacote' });
      continue;
    }
    step.settings.sourceCode = { ...step.settings.sourceCode, code, packageJson: '{}' };
    applied.push(name);
  }
  return {
    flow: out,
    applied,
    unknown,
    rejected,
    pending: listCodeDependencies(out),
  };
}
