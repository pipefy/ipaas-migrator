// Variaveis Workato: indexa declare/update/list.
//
// No Workato a variavel vive no job e e MUTAVEL. No Activepieces o output de
// um step nao muda depois que ele roda, entao toda variavel vai para o
// piece-store com escopo RUN (isola a execucao). Lista entra por add_to_list
// como array de strings JSON.
import type { ParsedStep } from './types.ts';

export type VarStrategy = 'static' | 'linear' | 'store';
export type VarKind = 'scalar' | 'list';
export type VarOp = 'declare' | 'update' | 'insert' | 'insert_batch' | 'clear';

export interface VarDecl {
  /** `as` do step `declare_*` — e por ele que as pills de leitura referenciam. */
  as: string;
  kind: VarKind;
  label: string;
  fields: string[];
  strategy: VarStrategy;
  /** Chave no storage do AP. Toda variavel usa o piece-store. */
  storeKey: string;
}

export interface VarWrite {
  declareAs: string;
  step: ParsedStep;
  op: VarOp;
  /** A escrita esta dentro de foreach/repeat/ramo de if? */
  contained: boolean;
}

export interface VarIndex {
  decls: Map<string, VarDecl>;
  writes: VarWrite[];
}

/**
 * Blocos que quebram a cadeia reta. `try` fica de fora de proposito: o builder
 * o achata numa cadeia linear (nao vira ramo nem loop no AP).
 */
const CONTAINERS = new Set([
  'foreach',
  'repeat',
  'while_condition',
  'if',
  'elsif',
  'elseif',
  'else',
]);

const OPS: Record<string, VarOp> = {
  declare_variable: 'declare',
  declare_list: 'declare',
  update_variables: 'update',
  update_variable: 'update',
  insert_to_list: 'insert',
  insert_to_list_batch: 'insert_batch',
  clear_list: 'clear',
};

/** Chaves do input de escrita que sao metadados, nao campos da variavel. */
const RESERVED_INPUT_KEYS = new Set(['name', 'input_mode', 'location', 'list_item', 'list_items']);

export const VAR_PROVIDER = 'workato_variable';

/** Chave que o Workato usa no batch para apontar a colecao de origem. */
export const SOURCE_KEY = '____source';

export function isVariableStep(step: ParsedStep): boolean {
  return step.provider === VAR_PROVIDER && Boolean(step.name && OPS[step.name]);
}

export function variableOp(step: ParsedStep): VarOp | undefined {
  return step.provider === VAR_PROVIDER && step.name ? OPS[step.name] : undefined;
}

/**
 * `input.name` das escritas aponta para o declare: `<recipeUuid>:<as>` para
 * lista e `<recipeUuid>:<as>:<campo>` para escalar.
 */
export function parseVarName(name: unknown): { declareAs: string; field?: string } | null {
  if (typeof name !== 'string' || !name) return null;
  const parts = name.split(':');
  if (parts.length >= 3) return { declareAs: parts[1]!, field: parts.slice(2).join(':') };
  if (parts.length === 2) return { declareAs: parts[1]! };
  return /^[0-9a-f]{6,}$/i.test(name) ? { declareAs: name } : null;
}

/** `[{"name":"x",...}]` (schema serializado do Workato) -> nomes dos campos. */
function schemaFields(json: unknown): string[] {
  if (typeof json !== 'string' || !json.trim()) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((f) => f?.name).filter((n): n is string => typeof n === 'string' && !!n);
  } catch {
    return [];
  }
}

function declKind(step: ParsedStep): VarKind {
  return step.name === 'declare_list' ? 'list' : 'scalar';
}

function declFields(step: ParsedStep): string[] {
  if (declKind(step) === 'list') {
    const fromSchema = schemaFields(step.input?.list_item_schema_json);
    if (fromSchema.length) return fromSchema;
    return Object.keys(step.input?.list_items ?? {}).filter((k) => k !== SOURCE_KEY);
  }
  const fromSchema = schemaFields(step.input?.variables?.schema);
  if (fromSchema.length) return fromSchema;
  return Object.keys(step.input?.variables?.data ?? {});
}

function declLabel(step: ParsedStep, kind: VarKind): string {
  const explicit = kind === 'list' ? step.input?.name : undefined;
  return String(step.comment || explicit || step.as || 'variavel');
}

/** Campos escritos por um `update_variables` (o valor novo vem no proprio input). */
export function updateFields(step: ParsedStep): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(step.input ?? {})) {
    if (RESERVED_INPUT_KEYS.has(k)) continue;
    if (v === '=skip') continue;
    out[k] = v;
  }
  return out;
}

export function indexVariables(root: ParsedStep): VarIndex {
  const decls = new Map<string, VarDecl>();
  const writes: VarWrite[] = [];

  const walk = (step: ParsedStep, contained: boolean): void => {
    const op = variableOp(step);
    if (op === 'declare' && step.as) {
      const kind = declKind(step);
      decls.set(step.as, {
        as: step.as,
        kind,
        label: declLabel(step, kind),
        fields: declFields(step),
        strategy: 'store',
        storeKey: `wv_${step.as}`,
      });
      if (!step.skip) writes.push({ declareAs: step.as, step, op, contained });
    } else if (op) {
      const ref = parseVarName(step.input?.name);
      // Passo desativado nao executa: nao muda o estado da variavel.
      if (ref && !step.skip) writes.push({ declareAs: ref.declareAs, step, op, contained });
    }
    const inner = contained || CONTAINERS.has(step.keyword);
    step.children.forEach((child) => walk(child, inner));
  };
  walk(root, false);

  return { decls, writes };
}

function walkStrings(node: unknown, visit: (s: string) => void): void {
  if (typeof node === 'string') visit(node);
  else if (Array.isArray(node)) node.forEach((n) => walkStrings(n, visit));
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => walkStrings(v, visit));
}

export interface StructuredPill {
  provider?: string;
  line?: string;
  path: unknown[];
}

/** Primeira pill estruturada (`_dp('{...}')`) da string. */
export function firstPill(value: unknown): StructuredPill | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/_dp\('(.+?)'\)/);
  if (!match) return null;
  try {
    const dp = JSON.parse(match[1]!);
    return { provider: dp?.provider, line: dp?.line, path: Array.isArray(dp?.path) ? dp.path : [] };
  } catch {
    return null;
  }
}

/**
 * Trecho do caminho DEPOIS do marcador `current_item`. No batch, e o que
 * distingue `edges[i].node.id` da colecao `edges`: o resto vira acesso em JS.
 */
export function itemSuffix(value: unknown): string[] | null {
  const dp = firstPill(value);
  if (!dp) return null;
  const at = dp.path.findIndex(
    (p) => p && typeof p === 'object' && (p as any).path_element_type === 'current_item',
  );
  if (at < 0) return null;
  return dp.path.slice(at + 1).filter((p): p is string => typeof p === 'string');
}

/**
 * Variaveis LIDAS por este passo (sem olhar os filhos). Cobre as duas formas de
 * leitura do Workato: `_('data.workato_variable.<as>.<campo>')` e a pill
 * estruturada `_dp({provider:"workato_variable", line:"<as>"})`.
 */
export function readsOf(step: ParsedStep): Set<string> {
  const found = new Set<string>();
  const visit = (s: string): void => {
    for (const m of s.matchAll(/_\('data\.workato_variable\.([^.']+)/g)) found.add(m[1]!);
    for (const m of s.matchAll(/_dp\('(.+?)'\)/g)) {
      try {
        const dp = JSON.parse(m[1]!);
        if (dp?.provider === VAR_PROVIDER && dp?.line) found.add(String(dp.line));
      } catch {
        // pill malformada: nao da para saber a origem, segue
      }
    }
  };
  // `input.name` da propria escrita nao e leitura — e endereco do declare.
  const { name: _ignored, ...rest } = (step.input ?? {}) as Record<string, unknown>;
  walkStrings(rest, visit);
  if (step.source) visit(step.source);
  walkStrings(step.filter, visit);
  return found;
}
