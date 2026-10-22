// Variaveis Workato: indexa declare/update/list.
//
// No Workato a variavel vive no job e e MUTAVEL. No Activepieces o output de
// um step nao muda depois que ele roda. O piece-store (escopo RUN) so entra
// quando o valor acumula nas voltas de um loop ou sai de um ramo e e lido em
// outro. Escalar escrito e lido no mesmo caminho e `linear`: a leitura e a
// datapill da saida do step que escreveu por ultimo.
//
// Escalar no Storage: um `put` por campo. A chave e o nome do campo
// (Numero_grupo_ADC) e o valor e o escalar. Lista entra por add_to_list como
// array de strings JSON numa chave `wv_<as>`.
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
  /**
   * Chave no storage do AP. Lista: `wv_<as>`. Escalar: vazio — cada campo usa
   * o proprio nome (`scalarStorageKey`).
   */
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
  /** Passos dentro de foreach/repeat: rodam uma vez por volta. */
  inLoop: Set<ParsedStep>;
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

/** Chave do `put`/`get` de um campo escalar: o nome do campo no Workato. */
export function scalarStorageKey(field: string): string {
  return field;
}

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

/** Declare escalar legado: `input` com `type`, `name` (label) e `value` em vez de `variables.schema`. */
export function isLegacyNameValueDeclare(step: ParsedStep): boolean {
  const input = step.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  if ((input as Record<string, unknown>).variables) return false;
  return typeof (input as Record<string, unknown>).name === 'string' && 'value' in input;
}

function declFields(step: ParsedStep): string[] {
  if (declKind(step) === 'list') {
    const fromSchema = schemaFields(step.input?.list_item_schema_json);
    if (fromSchema.length) return fromSchema;
    return Object.keys(step.input?.list_items ?? {}).filter((k) => k !== SOURCE_KEY);
  }
  if (isLegacyNameValueDeclare(step)) return ['value'];
  const fromSchema = schemaFields(step.input?.variables?.schema);
  if (fromSchema.length) return fromSchema;
  return Object.keys(step.input?.variables?.data ?? {});
}

function declLabel(step: ParsedStep, kind: VarKind): string {
  if (kind === 'scalar' && isLegacyNameValueDeclare(step)) {
    return String(step.comment || step.input?.name || step.as || 'variavel');
  }
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

/** O passo grava algum valor? Declare sem `data` e update so com `=skip` nao. */
export function writesValue(step: ParsedStep): boolean {
  const op = variableOp(step);
  if (op === 'update') return Object.keys(updateFields(step)).length > 0;
  if (op !== 'declare' || step.name !== 'declare_variable') return op !== undefined;
  if (isLegacyNameValueDeclare(step)) return (step.input as Record<string, unknown>).value != null;
  const data = step.input?.variables?.data;
  if (!data || typeof data !== 'object') return false;
  return Object.values(data as Record<string, unknown>).some((value) => value != null);
}

/** `declare_list` sem item inicial nem colecao de origem. */
export function isEmptyListDeclare(step: ParsedStep): boolean {
  if (step.provider !== VAR_PROVIDER || step.name !== 'declare_list') return false;
  const items = step.input?.list_items;
  return !items || typeof items !== 'object' || Object.keys(items).length === 0;
}

const LOOPS = new Set(['foreach', 'repeat', 'while_condition']);
const BRANCHES = new Set(['elsif', 'elseif', 'else']);

interface Place {
  parent: ParsedStep | null;
  index: number;
}

/**
 * Escalar `linear`: todas as escritas no mesmo bloco, fora de catch, e toda
 * leitura depois da primeira escrita com valor, no mesmo bloco ou dentro de
 * um passo seguinte dele (nunca em outro ramo do mesmo `if`). Assim o valor
 * nao acumula entre voltas nem cruza ramo; a pill aponta para o step.
 */
function isLinearScalar(
  decl: VarDecl,
  writes: VarWrite[],
  reads: ParsedStep[],
  places: Map<ParsedStep, Place>,
  inCatch: Set<ParsedStep>,
): boolean {
  if (decl.kind !== 'scalar' || decl.storeKey) return false;
  const own = writes.filter((write) => write.declareAs === decl.as);
  if (!own.length || own.some((write) => inCatch.has(write.step))) return false;
  const parent = places.get(own[0]!.step)?.parent;
  if (!parent || own.some((write) => places.get(write.step)?.parent !== parent)) return false;
  const valued = own.filter((write) => writesValue(write.step));
  if (!valued.length) return false;
  const first = Math.min(...valued.map((write) => places.get(write.step)!.index));

  return reads.every((read) => {
    let top: ParsedStep | null = read;
    while (top && places.get(top)?.parent !== parent) top = places.get(top)?.parent ?? null;
    if (!top) return false;
    if (parent.keyword === 'if' && BRANCHES.has(top.keyword)) return false;
    return places.get(top)!.index > first;
  });
}

export function indexVariables(root: ParsedStep): VarIndex {
  const decls = new Map<string, VarDecl>();
  const writes: VarWrite[] = [];
  const places = new Map<ParsedStep, Place>([[root, { parent: null, index: 0 }]]);
  const inCatch = new Set<ParsedStep>();
  const inLoop = new Set<ParsedStep>();
  const readers = new Map<string, ParsedStep[]>();

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
        storeKey: kind === 'list'
          ? `wv_${step.as}`
          : isLegacyNameValueDeclare(step)
            ? String(step.input?.name ?? '').trim()
            : '',
      });
      if (!step.skip) writes.push({ declareAs: step.as, step, op, contained });
    } else if (op) {
      const ref = parseVarName(step.input?.name);
      // Passo desativado nao executa: nao muda o estado da variavel.
      if (ref && !step.skip) writes.push({ declareAs: ref.declareAs, step, op, contained });
    }
    if (!step.skip) {
      for (const as of readsOf(step)) readers.set(as, [...(readers.get(as) ?? []), step]);
    }
    const inner = contained || CONTAINERS.has(step.keyword);
    step.children.forEach((child, index) => {
      places.set(child, { parent: step, index });
      if (step.keyword === 'catch' || inCatch.has(step)) inCatch.add(child);
      if (LOOPS.has(step.keyword) || inLoop.has(step)) inLoop.add(child);
      walk(child, inner);
    });
  };
  walk(root, false);

  for (const decl of decls.values()) {
    if (isLinearScalar(decl, writes, readers.get(decl.as) ?? [], places, inCatch)) decl.strategy = 'linear';
  }

  return { decls, writes, inLoop };
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

/** Marcador interno: o indice da linha no `.map` do lote, nao uma pill do flow. */
export const BATCH_INDEX_PILL = '{{__batch_index__}}';

function currentIndexPrefix(path: unknown[]): string[] | null {
  if (!path.length) return null;
  const last = path[path.length - 1];
  if (!last || typeof last !== 'object' || (last as { path_element_type?: string }).path_element_type !== 'current_index') {
    return null;
  }
  const prefix = path.slice(0, -1);
  if (!prefix.every((part) => typeof part === 'string')) return null;
  return prefix as string[];
}

function sameStringPath(left: unknown[], right: string[]): boolean {
  return left.length === right.length && left.every((part, i) => part === right[i]);
}

/**
 * Formula de campo do `insert_to_list_batch` cujo `current_index` e o da lista
 * `____source`. Troca esse `_dp` pelo marcador do `.map`. Outro `current_index`
 * (lista diferente, ou chave que o JSON nao nomeia) fica de fora.
 */
export function rewriteBatchIndex(value: unknown, source: unknown): string | null {
  if (typeof value !== 'string' || !value.includes('current_index')) return null;
  if (typeof source !== 'string' || [...source.matchAll(/_dp\('/g)].length !== 1) return null;
  const sourceBody = source.trim().replace(/^=/, '').trim();
  if (!/^(?:#\{_dp\('.*'\)\}|_dp\('.*'\))$/s.test(sourceBody)) return null;
  const src = firstPill(source);
  if (!src?.line) return null;
  const sourcePath = src.path.filter((part): part is string => typeof part === 'string');
  if (sourcePath.length !== src.path.length) return null;

  let indexes = 0;
  let mismatched = false;
  const out = value.replace(/#\{_dp\('(.+?)'\)\}|_dp\('(.+?)'\)/g, (full, wrapped: string, bare: string) => {
    const json = wrapped ?? bare;
    let dp: { line?: string; path?: unknown[] };
    try {
      dp = JSON.parse(json);
    } catch {
      return full;
    }
    const prefix = currentIndexPrefix(Array.isArray(dp.path) ? dp.path : []);
    if (!prefix) return full;
    indexes += 1;
    if (String(dp.line ?? '') !== String(src.line) || !sameStringPath(prefix, sourcePath)) {
      mismatched = true;
      return full;
    }
    return BATCH_INDEX_PILL;
  });
  if (!indexes || mismatched || !out.includes(BATCH_INDEX_PILL)) return null;
  return out;
}

/**
 * Variaveis LIDAS por este passo (sem olhar os filhos). Cobre as duas formas de
 * leitura do Workato: `_('data.workato_variable.<as>.<campo>')` e a pill
 * estruturada `_dp({provider:"workato_variable", line:"<as>"})`.
 */
function visitVariableRefs(
  step: ParsedStep,
  onAs: (as: string) => void,
  onScalarField: (as: string, field: string) => void,
): void {
  const visit = (s: string): void => {
    for (const m of s.matchAll(/_\('data\.workato_variable\.([^.']+)(?:\.([^.'\)]+))?/g)) {
      onAs(m[1]!);
      if (m[2]) onScalarField(m[1]!, m[2]!);
    }
    for (const m of s.matchAll(/_dp\('(.+?)'\)/g)) {
      try {
        const dp = JSON.parse(m[1]!);
        if (dp?.provider !== VAR_PROVIDER || !dp?.line) continue;
        const as = String(dp.line);
        onAs(as);
        const path = Array.isArray(dp.path) ? dp.path : [];
        const field = path.find((part: unknown) => typeof part === 'string');
        if (typeof field === 'string') onScalarField(as, field);
      } catch {
        // pill malformada: nao da para saber a origem, segue
      }
    }
  };
  // `input.name` da propria escrita nao e leitura — e endereco do declare.
  const { name: _ignored, ...rest } = (step.input ?? {}) as Record<string, unknown>;
  walkStrings(rest, visit);
  if (step.source) visit(step.source);
  for (const pair of step.indexPairs ?? []) visit(pair.pill);
  walkStrings(step.filter, visit);
}

export function readsOf(step: ParsedStep): Set<string> {
  const found = new Set<string>();
  visitVariableRefs(step, (as) => found.add(as), () => {});
  return found;
}

/**
 * Campos escalares lidos por este passo (`as` do declare -> nomes dos campos).
 * `list_items` fica de fora: a lista continua numa chave so.
 */
export function scalarFieldReads(step: ParsedStep): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  visitVariableRefs(
    step,
    () => {},
    (as, field) => {
      if (!field || field === 'list_items') return;
      const set = found.get(as) ?? new Set<string>();
      set.add(field);
      found.set(as, set);
    },
  );
  return found;
}
