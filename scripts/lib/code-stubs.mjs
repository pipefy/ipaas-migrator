// Lista e substitui os stubs CODE `AP-MIGRATION-TODO` do flow.json.
// Nao chama Pipefy. Nao edita mapa/KB/engine. Escreve settings.sourceCode.code e marca valid.
import { walkFlowSteps } from './verify-transport.mjs';

export const TODO_MARKER = 'AP-MIGRATION-TODO';

const OPKEY_RE = /AP-MIGRATION-TODO[^\n"]*"([^"]+)"/;
const ORIGINAL_OPEN = /--- (RUBY|PYTHON|JAVASCRIPT) ORIGINAL \(Workato\) ---/;
const ORIGINAL_CLOSE = /--- FIM (RUBY|PYTHON|JAVASCRIPT) ---/;

const LANGUAGES = [
  [/\/invoke_custom_ruby_code$/, 'ruby'],
  [/\/invoke_custom_py_code$/, 'python'],
  [/\/invoke_custom_js_code$/, 'javascript'],
];

export function flowSteps(flow) {
  const out = [];
  for (const f of flow?.flows ?? []) walkFlowSteps(f?.trigger, out);
  return out;
}

export function isCodeStub(step) {
  if (step?.type !== 'CODE') return false;
  return String(step?.settings?.sourceCode?.code ?? '').includes(TODO_MARKER);
}

export function opKeyFromStub(code) {
  return String(code ?? '').match(OPKEY_RE)?.[1] ?? null;
}

/** O stub embute Ruby, Python ou JavaScript original como comentario de bloco (` * ` por linha). */
export function embeddedRuby(code) {
  const text = String(code ?? '');
  const open = text.match(ORIGINAL_OPEN);
  const close = text.match(ORIGINAL_CLOSE);
  if (!open || !close || close.index == null || open.index == null || close.index < open.index) return '';
  return text
    .slice(open.index + open[0].length, close.index)
    .split('\n')
    .slice(1)
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .replace(/\s+$/, '');
}

function languageOf(opKey) {
  for (const [re, lang] of LANGUAGES) if (re.test(String(opKey ?? ''))) return lang;
  return 'logica';
}

/** Passos `action` / `trigger` da receita, na ordem da arvore `code`. */
export function recipeSteps(recipe) {
  const raw = recipe?.code ?? {};
  let root = raw;
  if (typeof raw === 'string') {
    try {
      root = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.provider && node.name) out.push(node);
    for (const child of node.block ?? []) walk(child);
  };
  walk(root);
  return out;
}

/**
 * Onde o JS traduzido le os dados. Ruby: o motor achata `code_input.data` em
 * `settings.input`. Python / JS: o input Workato inteiro entra, e os campos
 * ficam um nivel abaixo.
 */
function inputPathOf(step) {
  const data = step?.settings?.input?.code_input?.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return { path: 'inputs.code_input.data', keys: Object.keys(data) };
  }
  return { path: 'inputs', keys: Object.keys(step?.settings?.input ?? {}) };
}

export function listCodeStubs(flow, recipe = null) {
  const steps = flowSteps(flow).filter(isCodeStub);
  const byOpKey = new Map();
  for (const step of recipeSteps(recipe ?? {})) {
    const key = `${step.provider}/${step.name}`;
    if (!byOpKey.has(key)) byOpKey.set(key, []);
    byOpKey.get(key).push(step);
  }
  const taken = new Map();

  return steps.map((step) => {
    const code = String(step.settings?.sourceCode?.code ?? '');
    const opKey = opKeyFromStub(code);
    const seen = taken.get(opKey) ?? 0;
    taken.set(opKey, seen + 1);
    const origin = byOpKey.get(opKey)?.[seen] ?? null;
    const { path, keys } = inputPathOf(step);
    const source =
      embeddedRuby(code) ||
      String(origin?.input?.code ?? '') ||
      String(step.settings?.input?.code ?? '');

    return {
      name: step.name,
      displayName: step.displayName ?? null,
      opKey,
      language: languageOf(opKey),
      inputPath: path,
      inputKeys: keys,
      source,
    };
  });
}

function patchEntries(patch) {
  const raw = patch && typeof patch === 'object' && patch.steps ? patch.steps : patch;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw);
}

function patchBody(value) {
  if (typeof value === 'string') return { code: value, packageJson: undefined };
  if (value && typeof value === 'object') {
    return { code: String(value.code ?? ''), packageJson: value.packageJson };
  }
  return { code: '', packageJson: undefined };
}

/** `undefined` = não mexer. String JSON de objeto, ou erro. */
export function normalizePackageJson(value) {
  if (value == null) return { text: undefined };
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'package_json_invalido' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'package_json_invalido' };
  }
  return { text: JSON.stringify(parsed) };
}

/**
 * Troca o corpo dos steps CODE pelo JS traduzido e marca valid. Nao mexe em
 * piece, input, notes nem no encadeamento.
 */
export function applyCodeTranslations(flow, patch) {
  const out = structuredClone(flow);
  const byName = new Map(flowSteps(out).map((step) => [step.name, step]));
  const applied = [];
  const unknown = [];
  const rejected = [];

  for (const [name, value] of patchEntries(patch)) {
    const step = byName.get(name);
    if (!step) {
      unknown.push(name);
      continue;
    }
    if (step.type !== 'CODE') {
      rejected.push({ name, reason: 'step_nao_e_code' });
      continue;
    }
    const body = patchBody(value);
    const code = body.code;
    if (!code.trim()) {
      rejected.push({ name, reason: 'codigo_vazio' });
      continue;
    }
    if (code.includes(TODO_MARKER)) {
      rejected.push({ name, reason: 'ainda_tem_marcador' });
      continue;
    }
    if (!/export\s+const\s+code\s*=/.test(code)) {
      rejected.push({ name, reason: 'sem_export_const_code' });
      continue;
    }
    const pkg = normalizePackageJson(body.packageJson);
    if (pkg.error) {
      rejected.push({ name, reason: pkg.error });
      continue;
    }
    step.settings.sourceCode = {
      ...step.settings.sourceCode,
      code,
      ...(pkg.text != null ? { packageJson: pkg.text } : {}),
    };
    step.valid = true;
    applied.push(name);
  }

  return {
    flow: out,
    applied,
    unknown,
    rejected,
    pending: flowSteps(out).filter(isCodeStub).map((step) => step.name),
  };
}

function packageDeps(step) {
  const raw = step?.settings?.sourceCode?.packageJson;
  if (raw == null || raw === '' || raw === '{}') return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const deps = parsed?.dependencies;
    if (!deps || typeof deps !== 'object') return [];
    return Object.keys(deps);
  } catch {
    return [];
  }
}

/** Steps ainda com stub, e os que declararam pacote npm. */
export function codeLibReport(flow) {
  const steps = flowSteps(flow).filter((step) => step?.type === 'CODE');
  const pending = steps.filter(isCodeStub).map((step) => step.name);
  const withLib = [];
  for (const step of steps) {
    const packages = packageDeps(step);
    if (packages.length) withLib.push({ step: step.name, packages });
  }
  return {
    ok: pending.length === 0,
    pending,
    usedLib: withLib.length > 0,
    withLib,
  };
}
