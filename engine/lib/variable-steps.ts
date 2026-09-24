// Steps do piece-store para variavel Workato.
//
// Escalar fica `{campo: valor}` no `put`. Lista fica um array de strings JSON
// no `add_to_list`. A pill de leitura aponta para o `get`.
import type { ParsedStep } from './types.ts';
import { SOURCE_KEY, itemSuffix, type VarDecl, type VarOp } from './variables.ts';

export const STORE_PIECE = '@activepieces/piece-store';

/** Isola cada execucao do flow. Validado ao vivo: run A nao le o que run B escreveu. */
export const STORE_SCOPE = 'RUN';

/**
 * Caminho do valor dentro do output do `store/get`. Vazio = o step devolve o
 * valor cru. O e2e em `scripts/testar-variaveis-ipaas.mjs` fixa isso; se a
 * plataforma envelopar o valor, basta mudar esta constante.
 */
export const STORE_GET_OUTPUT_PATH = '';

/** Referencia de leitura para o output de um `store/get`. */
export function storeGetRef(stepName: string): string {
  return STORE_GET_OUTPUT_PATH ? `${stepName}.${STORE_GET_OUTPUT_PATH}` : stepName;
}

/** Chave de input que carrega o valor anterior da variavel. */
export const PREV_KEY = '__anterior';
/** Chave de input com os campos escritos agora (ja como template AP). */
export const FIELDS_KEY = '__campos';
/** Chave de input com a colecao de origem de um `insert_to_list_batch`. */
export const SOURCE_INPUT_KEY = '__fonte';

function jsKey(name: string): string {
  return JSON.stringify(name);
}

/** `item?.["a"]?.["b"]` a partir do caminho pos-`current_item`. */
function jsItemAccess(path: string[]): string {
  return path.length ? `item?.${path.map((p) => `[${jsKey(p)}]`).join('?.')}` : 'item';
}

function header(decl: VarDecl, op: VarOp): string[] {
  return [
    '/**',
    ` * Variavel Workato "${decl.label}" (${decl.kind === 'list' ? 'lista' : 'escalar'}) — ${op}.`,
    ' * No Workato o valor vive no job e e mutavel; aqui ele vive no output',
    ' * deste step (ou no storage, quando ha escrita dentro de loop/ramo).',
    ' */',
  ];
}

/** Objeto com todos os campos declarados em null: o Workato assume nil. */
function emptyShape(decl: VarDecl): string {
  if (decl.kind === 'list') return '{ "list_items": [] }';
  if (!decl.fields.length) return '{}';
  return `{ ${decl.fields.map((f) => `${jsKey(f)}: null`).join(', ')} }`;
}

export interface VarCodeBody {
  code: string;
  /** Chaves de input que o codigo espera (o chamador preenche os valores). */
  needsPrev: boolean;
  needsSource: boolean;
}

/** Corpo JS do step que calcula o novo valor da variavel. */
export function variableCode(
  decl: VarDecl,
  op: VarOp,
  step: ParsedStep,
  hasFields: boolean,
): VarCodeBody {
  const lines = header(decl, op);

  if (decl.kind === 'scalar') {
    lines.push(
      'export const code = async (inputs) => {',
      `  const vazio = ${emptyShape(decl)};`,
      `  const anterior = inputs.${PREV_KEY} ?? vazio;`,
      `  return { ...vazio, ...anterior, ...(inputs.${FIELDS_KEY} ?? {}) };`,
      '};',
    );
    return { code: lines.join('\n'), needsPrev: op !== 'declare', needsSource: false };
  }

  // Lista
  if (op === 'clear') {
    lines.push('export const code = async (inputs) => {', '  return { "list_items": [] };', '};');
    return { code: lines.join('\n'), needsPrev: false, needsSource: false };
  }

  const source = op === 'insert_batch' || op === 'declare' ? step.input?.list_items?.[SOURCE_KEY] : undefined;
  const isBatch = Boolean(source);
  const atStart = String(step.input?.location ?? 'end') === 'start';

  // `declare_list` sem itens iniciais abre a lista VAZIA. Cair no caminho comum
  // inseriria um item `{}` que nao existe na receita.
  if (op === 'declare' && !isBatch && !hasFields) {
    lines.push('export const code = async (inputs) => {', '  return { "list_items": [] };', '};');
    return { code: lines.join('\n'), needsPrev: false, needsSource: false };
  }

  lines.push('export const code = async (inputs) => {');
  lines.push(
    `  const anterior = Array.isArray(inputs.${PREV_KEY}?.list_items) ? inputs.${PREV_KEY}.list_items : [];`,
  );

  if (isBatch) {
    const raw = (step.input?.list_items ?? {}) as Record<string, unknown>;
    const perItem: string[] = [];
    for (const [field, value] of Object.entries(raw)) {
      if (field === SOURCE_KEY) continue;
      const suffix = itemSuffix(value);
      // Campo sem `current_item` e constante no lote: vem pronto em __campos.
      if (suffix) perItem.push(`    ${jsKey(field)}: ${jsItemAccess(suffix)},`);
    }
    lines.push(
      `  const fonte = Array.isArray(inputs.${SOURCE_INPUT_KEY}) ? inputs.${SOURCE_INPUT_KEY} : [];`,
      '  const novos = fonte.map((item) => ({',
      `    ...(inputs.${FIELDS_KEY} ?? {}),`,
      ...perItem,
      '  }));',
    );
  } else {
    lines.push(`  const novos = [inputs.${FIELDS_KEY} ?? {}];`);
  }

  lines.push(
    atStart
      ? '  return { "list_items": [...novos, ...anterior] };'
      : '  return { "list_items": [...anterior, ...novos] };',
    '};',
  );

  return {
    code: lines.join('\n'),
    needsPrev: op !== 'declare',
    needsSource: isBatch,
  };
}

/**
 * Campos escritos por este passo, ainda em forma Workato (o chamador converte
 * as pills). No batch, os campos com `current_item` saem daqui: eles sao
 * resolvidos item a item dentro do JS, nao por template.
 */
export function writtenFields(step: ParsedStep, op: VarOp): Record<string, unknown> {
  if (op === 'clear') return {};
  if (op === 'insert') return (step.input?.list_item ?? {}) as Record<string, unknown>;
  if (op === 'insert_batch' || (op === 'declare' && step.input?.list_items)) {
    const raw = (step.input?.list_items ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(raw)) {
      if (field === SOURCE_KEY) continue;
      if (!itemSuffix(value)) out[field] = value;
    }
    return out;
  }
  if (op === 'declare') return (step.input?.variables?.data ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries((step.input ?? {}) as Record<string, unknown>)) {
    if (k === 'name' || k === 'input_mode' || v === '=skip') continue;
    out[k] = v;
  }
  return out;
}

/** Um item da lista, no formato que o `add_to_list` guarda: string JSON. */
export function listItemJson(fields: Record<string, unknown>): string {
  const parts = Object.entries(fields).map(([key, value]) => `${JSON.stringify(key)}:${jsonLiteral(value)}`);
  return `{${parts.join(',')}}`;
}

function jsonLiteral(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  return JSON.stringify(String(value));
}

export interface ListBatchField {
  field: string;
  path: string[];
}

/** Campos do lote que dependem de `current_item`. O resto vai pronto em `__campos`. */
export function listBatchFields(step: ParsedStep): ListBatchField[] {
  const raw = (step.input?.list_items ?? {}) as Record<string, unknown>;
  const out: ListBatchField[] = [];
  for (const [field, value] of Object.entries(raw)) {
    if (field === SOURCE_KEY) continue;
    const suffix = itemSuffix(value);
    if (suffix) out.push({ field, path: suffix });
  }
  return out;
}

/**
 * Code que devolve `string[]` para o `add_to_list`. Nao usa o cabecalho de
 * variavel em CODE: o passo que casa com a receita e o Storage.
 */
export function listBatchCode(fields: ListBatchField[]): string {
  const lines = [
    '/**',
    ' * Strings JSON de um insert em lote. O passo seguinte grava no Storage.',
    ' */',
    'export const code = async (inputs) => {',
    '  const fonte = Array.isArray(inputs.__fonte) ? inputs.__fonte : [];',
    '  const fixos = inputs.__campos ?? {};',
    '  return fonte.map((item) => JSON.stringify({',
    '    ...fixos,',
  ];
  for (const field of fields) {
    lines.push(`    ${jsKey(field.field)}: ${jsItemAccess(field.path)},`);
  }
  lines.push('  }));', '};');
  return lines.join('\n');
}

/** O get da lista devolve array (ou o JSON desse array). O loop precisa de objeto. */
export function listReadCode(): string {
  return [
    '/**',
    ' * O Storage guarda cada item como string JSON. O loop le o objeto.',
    ' */',
    'export const code = async (inputs) => {',
    '  let list = inputs.list;',
    "  if (typeof list === 'string') {",
    '    try { list = JSON.parse(list); } catch { return []; }',
    '  }',
    '  if (!Array.isArray(list)) return [];',
    '  return list.map((item) => {',
    "    if (typeof item !== 'string') return item;",
    '    try { return JSON.parse(item); } catch { return item; }',
    '  });',
    '};',
  ].join('\n');
}
