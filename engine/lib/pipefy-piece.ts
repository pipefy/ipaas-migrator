// piece-pipefy das próximas traduções. A KB continua no snapshot 0.1.9;
// o destino (Invenergy ST) tem 0.2.4, e o input de leitura de card ganhou
// as listas de campo. Valores copiados do gabarito Offshore (schema 23).

export const PIPEFY_PIECE_VERSION = '0.2.4';

const CARD_READ_ACTIONS = new Set(['getCardById', 'getCardsByFieldValue']);

export const PIPEFY_CARD_FIELDS: Record<string, string[]> = {
  comments: ['id', 'text', 'created_at', 'author_name'],
  assignees: ['name', 'email', 'id', 'locale', 'timezone'],
  card_info: [
    'uuid',
    'suid',
    'age',
    'title',
    'comments_count',
    'createdAt',
    'current_phase_age',
    'done',
    'due_date',
    'emailMessagingAddress',
    'expired',
    'late',
    'started_current_phase_at',
    'updated_at',
    'url',
    'creatorEmail',
    'current_phase',
  ],
  created_by: ['email', 'id', 'locale', 'name', 'timezone'],
  attachments: ['createdAt', 'createdBy', 'field', 'path', 'phase', 'url'],
  inbox_emails: [
    'bcc',
    'body',
    'cc',
    'from',
    'fromName',
    'id',
    'main_to',
    'message_id',
    'sent_via_automation',
    'state',
    'subject',
    'to',
    'updated_at',
    'user',
    'attachments',
  ],
  phases_history: ['duration', 'phase', 'firstTimeIn', 'lastTimeIn', 'lastTimeOut', 'created_at', 'became_late'],
  child_relations: ['name', 'pipe', 'repo', 'cards'],
  parent_relations: ['name', 'pipe', 'repo', 'cards'],
};

export interface UpdateListFieldAdd {
  nodeId: string;
  fieldId: string;
  fieldValue: string;
  operation: 'ADD';
}

/** ADDs extraídos da mutation. `residualQuery` guarda o que não é ADD. */
export interface UpdateListFieldSplit {
  adds: UpdateListFieldAdd[];
  residualQuery: string | null;
}

function graphqlQuery(input: Record<string, any>): string | null {
  const body = input?.body;
  if (typeof body === 'string') return body;
  if (!body || typeof body !== 'object') return null;
  if (typeof body.query === 'string') return body.query;
  if (typeof body.data === 'string') return body.data;
  if (body.data && typeof body.data === 'object' && typeof body.data.query === 'string') return body.data.query;
  return null;
}

function unescapeGraphql(query: string): string {
  let prev = '';
  let current = query;
  while (current !== prev) {
    prev = current;
    current = current.replace(/\\"/g, '"');
  }
  return current;
}

/** `#{pill.gsub(...).upcase}` deixa a `}` do Ruby depois que a pill vira `{{ }}`. */
function stripRubyInterpolationClose(query: string): string {
  return query.replace(
    /(\{\{[\s\S]*?\}\})((?:\s*\.[A-Za-z_][\w]*(?:\([^)]*\))?)+)\}/g,
    '$1$2',
  );
}

/** Pula `{{...}}` e conta chaves/colchetes do GraphQL ainda abertos. */
function braceDepth(source: string): number {
  const stack: string[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source.startsWith('{{', i)) {
      const end = source.indexOf('}}', i + 2);
      if (end === -1) return 1;
      i = end + 1;
      continue;
    }
    const ch = source[i];
    if (ch === '{' || ch === '[') stack.push(ch);
    else if ((ch === '}' || ch === ']') && stack.length) stack.pop();
  }
  return stack.length;
}

function cleanEdge(raw: string): string {
  let text = raw.trim().replace(/[,\s]+$/, '').trim();
  while ((text.endsWith('}') || text.endsWith(']')) && braceDepth(text.slice(0, -1).trim()) === 0) {
    text = text.slice(0, -1).trim().replace(/[,\s]+$/, '').trim();
  }
  return text;
}

function scanBalanced(source: string, start: number): string | null {
  const open = source[start];
  const closeOf: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
  const close = closeOf[open];
  if (!close) return null;
  const stack: string[] = [close];
  for (let i = start + 1; i < source.length; i++) {
    if (source.startsWith('{{', i)) {
      const end = source.indexOf('}}', i + 2);
      if (end === -1) return null;
      i = end + 1;
      continue;
    }
    const ch = source[i];
    if (ch === '{' || ch === '[' || ch === '(') stack.push(closeOf[ch]!);
    else if (ch === '}' || ch === ']' || ch === ')') {
      if (stack.at(-1) !== ch) return null;
      stack.pop();
      if (stack.length === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function rawKey(source: string, key: string, stops: string[]): string | null {
  const match = source.match(new RegExp(`\\b${key}\\s*:`));
  if (!match || match.index == null) return null;
  const rest = source.slice(match.index + match[0].length);
  let end = rest.length;
  for (const stop of stops) {
    const next = rest.search(new RegExp(`\\b${stop}\\s*:`));
    if (next !== -1 && next < end) end = next;
  }
  return cleanEdge(rest.slice(0, end));
}

/** Literal GraphQL: aspas, pill, número ou array de um elemento. `""` vale string vazia. */
function unwrapGraphqlLiteral(raw: string): string | null {
  const text = cleanEdge(raw);
  if (text === 'null') return null;
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    if (text.length === 2) return '';
    return unwrapGraphqlLiteral(text.slice(1, -1));
  }
  if (!text) return null;
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    if (!inner || topLevelComma(inner)) return null;
    return unwrapGraphqlLiteral(inner);
  }
  return text;
}

function topLevelComma(source: string): boolean {
  for (let i = 0; i < source.length; i++) {
    if (source.startsWith('{{', i)) {
      const end = source.indexOf('}}', i + 2);
      if (end === -1) return false;
      i = end + 1;
      continue;
    }
    if (source[i] === ',') return true;
  }
  return false;
}

interface GraphqlEntry {
  text: string;
  start: number;
  end: number;
}

function valuesClause(query: string): { start: number; end: number; body: string } | null {
  const match = query.match(/\bvalues\s*:/);
  if (!match || match.index == null) return null;
  let i = match.index + match[0].length;
  while (query[i] === ' ' || query[i] === '\n' || query[i] === '\t') i++;
  if (query[i] !== '{' && query[i] !== '[') return null;
  const body = scanBalanced(query, i);
  if (!body) return null;
  return { start: i, end: i + body.length, body };
}

function entrySpans(body: string): GraphqlEntry[] {
  if (body.startsWith('{')) return [{ text: body, start: 0, end: body.length }];
  const entries: GraphqlEntry[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body.startsWith('{{', i)) {
      const end = body.indexOf('}}', i + 2);
      if (end === -1) break;
      i = end + 1;
      continue;
    }
    if (body[i] !== '{') continue;
    const text = scanBalanced(body, i);
    if (!text) break;
    entries.push({ text, start: i, end: i + text.length });
    i += text.length - 1;
  }
  return entries;
}

function removeSpans(source: string, spans: Array<[number, number]>): string {
  let out = source;
  const ordered = [...spans].sort((a, b) => b[0] - a[0]);
  for (const [start, end] of ordered) {
    const before = out.slice(0, start);
    const after = out.slice(end);
    const commaBefore = before.match(/,\s*$/);
    const commaAfter = after.match(/^\s*,/);
    let from = start;
    let to = end;
    if (commaAfter) to += commaAfter[0].length;
    else if (commaBefore) from -= commaBefore[0].length;
    out = out.slice(0, from) + out.slice(to);
  }
  return out;
}

interface FieldsCall {
  start: number;
  end: number;
  nodeId: string | null;
  entries: GraphqlEntry[];
  valuesStart: number;
}

/** Cada `updateFieldsValues(...)`, com o alias (`n1:`) e o selection set. */
function fieldsCalls(query: string): FieldsCall[] {
  const calls: FieldsCall[] = [];
  for (const match of query.matchAll(/updateFieldsValues/gi)) {
    if (match.index == null) continue;
    const before = query.slice(0, match.index);
    const alias = before.match(/([A-Za-z_][\w]*)\s*:\s*$/);
    const start = alias ? match.index - alias[0].length : match.index;
    const paren = query.indexOf('(', match.index);
    if (paren === -1) continue;
    const args = scanBalanced(query, paren);
    if (!args) continue;
    let end = paren + args.length;
    let cursor = end;
    while (query[cursor] === ' ' || query[cursor] === '\n' || query[cursor] === '\t') cursor++;
    if (query[cursor] === '{') {
      const selection = scanBalanced(query, cursor);
      if (selection) end = cursor + selection.length;
    }
    const inner = args.slice(1, -1);
    const nodeId = unwrapGraphqlLiteral(rawKey(inner, 'nodeId', ['values']) ?? '');
    const values = valuesClause(inner);
    const entries = values ? entrySpans(values.body) : [];
    calls.push({
      start,
      end,
      nodeId,
      entries,
      valuesStart: values ? paren + 1 + values.start : -1,
    });
  }
  return calls;
}

function callStillUseful(query: string): boolean {
  const withoutWrapper = query.replace(/TODO_FORMULA\s*\(/g, '');
  return /[A-Za-z_][\w]*\s*\(/.test(withoutWrapper);
}

/**
 * `updateFieldsValues` com `operation: ADD` vira updateListField.
 * Vários ADD viram uma lista. Alias que não é ADD (REPLACE, outro campo,
 * updateCardField) permanece em `residualQuery`.
 */
export function updateListFieldFromGraphql(input: Record<string, any>): UpdateListFieldSplit | null {
  const source = graphqlQuery(input);
  if (!source || !/updateFieldsValues/i.test(source)) return null;
  const query = stripRubyInterpolationClose(unescapeGraphql(source));
  const calls = fieldsCalls(query);
  if (!calls.length) return null;

  const adds: UpdateListFieldAdd[] = [];
  const drop: Array<[number, number]> = [];
  for (const call of calls) {
    if (!call.entries.length || call.valuesStart < 0) continue;
    const kept: GraphqlEntry[] = [];
    const added: GraphqlEntry[] = [];
    for (const entry of call.entries) {
      const operation = unwrapGraphqlLiteral(rawKey(entry.text, 'operation', ['fieldId', 'value']) ?? '');
      const fieldId = unwrapGraphqlLiteral(rawKey(entry.text, 'fieldId', ['value', 'operation']) ?? '');
      const fieldValue = unwrapGraphqlLiteral(rawKey(entry.text, 'value', ['fieldId', 'operation']) ?? '');
      if (operation !== 'ADD') {
        kept.push(entry);
        continue;
      }
      if (!call.nodeId || !fieldId || fieldValue == null) return null;
      adds.push({ nodeId: call.nodeId, fieldId, fieldValue, operation: 'ADD' });
      added.push(entry);
    }
    if (!added.length) continue;
    if (!kept.length) {
      drop.push([call.start, call.end]);
      continue;
    }
    for (const entry of added) drop.push([call.valuesStart + entry.start, call.valuesStart + entry.end]);
  }
  if (!adds.length) return null;
  const edited = removeSpans(query, drop);
  const residualQuery = callStillUseful(edited) ? edited : null;
  return { adds, residualQuery };
}

export function replaceGraphqlQuery(input: Record<string, any>, query: string): Record<string, any> {
  const clone = structuredClone(input);
  const body = clone?.body;
  if (typeof body === 'string') {
    clone.body = query;
    return clone;
  }
  if (!body || typeof body !== 'object') return clone;
  if (typeof body.query === 'string') body.query = query;
  else if (typeof body.data === 'string') body.data = query;
  else if (body.data && typeof body.data === 'object' && typeof body.data.query === 'string') body.data.query = query;
  return clone;
}

const DYNAMIC_FIELD_PROPS = ['phaseFields', 'startFormFields'] as const;

function fieldPropertyType(controlType: string | undefined): string {
  const control = (controlType ?? '').toLowerCase();
  if (control === 'text-area' || control === 'text_area') return 'LONG_TEXT';
  if (control === 'number' || control === 'integer') return 'NUMBER';
  if (control === 'checkbox') return 'CHECKBOX';
  return 'SHORT_TEXT';
}

/**
 * O canvas só desenha phaseFields/startFormFields se o schema estiver em
 * propertySettings. A chave é o id do campo no Pipefy (o slug, ex. request_identifier).
 */
export function pipefyPropertySettings(
  input: Record<string, any>,
  fields: { name: string; label?: string; controlType?: string; optional?: boolean }[] | undefined,
): Record<string, any> {
  const settings: Record<string, any> = {};
  for (const key of Object.keys(input)) settings[key] = { type: 'MANUAL' };
  for (const prop of DYNAMIC_FIELD_PROPS) {
    const value = input[prop];
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const schema: Record<string, unknown> = {};
    for (const fieldKey of Object.keys(value)) {
      const def = fields?.find((field) => field.name === fieldKey);
      schema[fieldKey] = {
        displayName: def?.label?.trim() || fieldKey,
        required: def?.optional === false,
        type: fieldPropertyType(def?.controlType),
      };
    }
    if (Object.keys(schema).length) settings[prop] = { type: 'MANUAL', schema };
  }
  return settings;
}

export function withPipefyCardFields(actionName: string, input: Record<string, any>): Record<string, any> {
  if (!CARD_READ_ACTIONS.has(actionName)) return input;
  const fields: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(PIPEFY_CARD_FIELDS)) fields[key] = [...values];
  return { ...input, ...fields };
}
