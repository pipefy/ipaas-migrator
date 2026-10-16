// Conversao de data pills / formulas Workato -> templates Activepieces.
import type { FormulaHit } from './types.ts';
import { decodeRubyStringEscape, parseRubyStringLiteral, parseRubyStringLiteralAt, rubySyntaxFeatures } from './ruby-expr.ts';

const RUBY_METHODS = [
  'where', 'pluck', 'gsub', 'smart_join', 'split', 'slice_after', 'map', 'select',
  'reject', 'to_s', 'to_i', 'to_f', 'strip', 'downcase', 'upcase', 'present?', 'blank?',
];

/** true se a string contem qualquer data pill / formula Workato. */
export function hasPill(s: string): boolean {
  return typeof s === 'string' && (/#\{/.test(s) || s.startsWith('='));
}

/**
 * Formula Workato sem corpo: `=`, `=()`, `=null`, `=clear`. Campo em branco
 * ou "limpar valor" — o equivalente no AP e o campo vazio. `=skip` e outra
 * coisa (nao atualizar) e o builder descarta a chave antes de chegar aqui.
 */
const EMPTY_FORMULA = /^=\s*(?:\(\s*\)|null|clear)?\s*$/i;

/** `="texto"` / `='texto'` sem metodo: literal com prefixo de formula. Nao atravessa a aspa de fechamento. */
const LITERAL_FORMULA = /^=\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*$/;

/** `_dp(...)` / `#{_dp(...)}` com zero ou mais `['campo']` — nao e formula Ruby.
 *  A aspa de fechamento do pill e a primeira: `.*` engolia um `.gsub(..., '')` depois. */
const SIMPLE_PILL = /^(?:#\{)?_(?:dp)?\('[^']*'\)\}?(?:\[['"]\w+['"]\])*$/;

/** JSON path strings are exact keys; only explicit numbers are indexes. */
type PillPathSegment = string | number;

/** Find the call terminator outside JSON strings, including keys containing apostrophes. */
function structuredPillAt(src: string, start: number): { json: string; end: number } | null {
  if (!src.startsWith("_dp('", start)) return null;
  const bodyStart = start + 5;
  let quoted = false;
  for (let i = bodyStart; i < src.length; i++) {
    if (quoted && src[i] === '\\') { i++; continue; }
    if (src[i] === '"') { quoted = !quoted; continue; }
    if (!quoted && src.startsWith("')", i)) return { json: src.slice(bodyStart, i), end: i + 2 };
  }
  return null;
}

type ParsedPillAccess = { segments: PillPathSegment[]; end: number } | 'invalid_literal';

/** Read accesses without interpreting a trailing method as another key. */
function readPillAccess(src: string): ParsedPillAccess | null {
  const segments: PillPathSegment[] = [];
  let i = 0;
  while (src[i] === '[') {
    const m = src.slice(i).match(/^\[(\d+)\]/);
    if (m) {
      const index = Number(m[1]);
      if (!Number.isSafeInteger(index)) return null;
      segments.push(index);
      i += m[0].length;
    } else {
      if (src[i + 1] !== '"' && src[i + 1] !== "'") return null;
      const literal = parseRubyStringLiteralAt(src, i + 1);
      if (!literal || src[literal.end] !== ']') return 'invalid_literal';
      segments.push(literal.value);
      i = literal.end + 1;
    }
  }
  return { segments, end: i };
}

/** Explicit quoted keys stay literal; only unquoted integer accesses are indexes. */
function parsePillAccess(src: string): PillPathSegment[] | null {
  const parsed = readPillAccess(src);
  return parsed && parsed !== 'invalid_literal' && parsed.end === src.length ? parsed.segments : null;
}

function pureStructuredPill(src: string): { json: string; segments: PillPathSegment[] } | null {
  let s = src.trim().replace(/^=\s*/, '');
  const interpolated = s.startsWith('#{');
  if (interpolated) s = s.slice(2);
  const call = structuredPillAt(s, 0);
  if (!call) return null;
  let suffix = s.slice(call.end);
  if (interpolated) {
    if (suffix.startsWith('}')) suffix = suffix.slice(1);
    else if (suffix.endsWith('}')) suffix = suffix.slice(0, -1);
    else return null;
  }
  const segments = parsePillAccess(suffix);
  return segments ? { json: call.json, segments } : null;
}

/**
 * Formula Workato (`=...`) que nao e apenas uma data pill. Ex.: `=now + 24.hours`.
 * Nao ha equivalente direto em template AP, entao vira revisao humana.
 */
export function isRubyExpression(s: string): boolean {
  if (typeof s !== 'string' || !s.startsWith('=')) return false;
  if (EMPTY_FORMULA.test(s)) return false;
  if (LITERAL_FORMULA.test(s) && parseRubyStringLiteral(s.slice(1)) !== null) return false;
  if (isGraphqlFormula(s)) return false;
  const body = s.slice(1).trim();
  if (SIMPLE_PILL.test(body)) return false;
  if (pureStructuredPill(s)) return false;
  if (parseIncludeFormula(s)) return false;
  const peeled = peelTrailingCaseMethod(s);
  if (peeled) {
    const inner = peeled.inner.startsWith('=') ? peeled.inner : `=${peeled.inner}`;
    return isRubyExpression(inner);
  }
  return true;
}

/** `="mutation{...}"` / `="query{...}"` — o miolo e o documento GraphQL, nao Ruby. */
function isGraphqlFormula(s: string): boolean {
  return /^=\s*["']\s*(mutation|query)\b/i.test(s.trim());
}

/** `"A", "B"` / `'A','B'` — lista Ruby de strings. Qualquer outro token aborta. */
export function parseRubyStringList(src: string): string[] | null {
  const values: string[] = [];
  let i = 0;
  const skipSpace = () => { while (i < src.length && /\s/.test(src[i]!)) i++; };
  skipSpace();
  while (i < src.length) {
    const parsed = parseRubyStringLiteralAt(src, i);
    if (!parsed) return null;
    values.push(parsed.value);
    i = parsed.end;
    skipSpace();
    if (i === src.length) return values;
    if (src[i] !== ',') return null;
    i++;
    skipSpace();
  }
  return null;
}

/** `=_dp(...).upcase` / `_dp(...).downcase` — so o metodo de caixa no fim. */
export function peelTrailingCaseMethod(
  input: string,
): { inner: string; method: 'upcase' | 'downcase' } | null {
  if (typeof input !== 'string') return null;
  const m = input.trim().match(/^(.*)\.(upcase|downcase)$/);
  if (!m) return null;
  return { inner: m[1]!, method: m[2] as 'upcase' | 'downcase' };
}

export interface IncludeFormula {
  values: string[];
  needleRaw: string;
  caseFold: boolean;
}

/**
 * `=["A","B"].include?(_dp(...).upcase)` — membership Workato sobre uma lista
 * literal. O needle volta como formula `=` para o convertPills normal.
 */
function nativeMembershipLiteralSafe(value: string): boolean {
  // The native parser checks only the preceding character for an escaped
  // closing quote, and its wrapper splitter does not track quoted delimiters.
  return !value.endsWith('\\') && !value.includes('}::ap-formula-v1');
}

export function parseIncludeFormula(input: string): IncludeFormula | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/^=/, '');
  const m = s.match(/^\[(.*)\]\.include\?\((.+)\)$/s);
  if (!m) return null;
  const values = parseRubyStringList(m[1]!);
  if (!values || values.length === 0) return null;
  let needle = m[2]!.trim();
  let caseFold = false;
  const peeled = peelTrailingCaseMethod(needle);
  if (peeled) {
    needle = peeled.inner;
    caseFold = true;
  }
  // AP is_equal uses loose equality. Without a proven String receiver its
  // result can differ from Ruby Array#include? (e.g. "1" versus Number 1).
  // Keep unknown datapill types in the compiler instead of inferring a type.
  const literalNeedle = parseRubyStringLiteral(needle.replace(/^=\s*/, ''));
  if (literalNeedle === null || !nativeMembershipLiteralSafe(literalNeedle) ||
      values.some((value) => !nativeMembershipLiteralSafe(value))) return null;
  const needleRaw = needle.startsWith('=') || needle.startsWith('#{') ? needle : `=${needle}`;
  if (isRubyExpression(needleRaw) && !peelTrailingCaseMethod(needleRaw)) return null;
  return { values, needleRaw, caseFold };
}

export function wrapApFormula(expr: string): string {
  return `ap-formula-v1::{${expr}}::ap-formula-v1`;
}

/** Workato `cards_count` do get_cards_by_field. A piece devolve a lista, sem esse campo. */
function cardsCountFormula(binding: StepBinding | undefined, stepName: string): string | null {
  if (!binding || typeof binding === 'string' || binding.actionName !== 'getCardsByFieldValue') return null;
  return wrapApFormula(`count(${renderApTemplate(stepName, ['data', 'cards'])})`);
}

/** Nomes oficiais do catalogo AP (`packages/core/formula`): `uppercase` / `lowercase`. */
function apCaseFn(method: string): 'uppercase' | 'lowercase' {
  return method === 'upcase' ? 'uppercase' : 'lowercase';
}

/**
 * `["A","B"].include?(x)` no Workato. AP nao tem `in()`; o equivalente e
 * `contains_item` sobre lista, mas literal de array nao e confiavel no
 * parser — `or(is_equal; ...)` usa so funcoes do catalogo.
 */
function membershipFormula(needle: string, values: string[]): string {
  const eqs = values.map((v) => `is_equal(${needle}; "${escapeFormulaString(v)}")`);
  return eqs.slice(1).reduce((acc, term) => `or(${acc}; ${term})`, eqs[0]!);
}

function escapeFormulaString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * `.gsub('"', "")` tira aspas. Cada ocorrência vira `replace` do catálogo.
 * O resto do texto fica literal. Outro método Ruby no mesmo valor não entra.
 */
function convertQuoteGsubText(s: string): string | null {
  const call = /#\{\s*(\{\{[^{}]+\}\})\.gsub\(\s*'"'\s*,\s*""\s*\)\s*\}|(\{\{[^{}]+\}\})\.gsub\(\s*'"'\s*,\s*""\s*\)/g;
  if (!call.test(s)) return null;
  call.lastIndex = 0;
  const formulas: string[] = [];
  const masked = s.replace(call, (_match, wrapped: string | undefined, bare: string | undefined) => {
    const pill = wrapped ?? bare ?? '';
    formulas.push(wrapApFormula(`replace(${pill}; "\\""; "")`));
    return `\u0000${formulas.length - 1}\u0000`;
  });
  if (detectRubyMethods(masked).length) return null;
  const unquoted = unquoteRubyString(masked.trim());
  const body = unquoted ?? (masked.trim().startsWith('"') || masked.trim().startsWith("'") ? null : masked);
  if (body == null) return null;
  // A decoded NUL belongs to user text. It cannot be confused with a masked
  // call; use the compiler when literal data adds any NUL to the placeholders.
  if ([...body].filter((ch) => ch === '\u0000').length !== formulas.length * 2) return null;
  return body.replace(/\u0000(\d+)\u0000/g, (_match, index) => formulas[Number(index)]!);
}

/** Depois das pills virarem `{{...}}`, fecha `.upcase` / `[].include?` conhecidos. */
function convertKnownRubyAfterPills(out: string): string | null {
  let s = out.trim();
  if (s.startsWith('=')) s = s.slice(1).trim();
  const quoteStrip = convertQuoteGsubText(s);
  if (quoteStrip) return quoteStrip;
  // Limiar numérico que sobrou de uma comparação. Não é fórmula.
  if (/^-?\d+$/.test(s)) return s;

  const include = s.match(/^\[(.*)\]\.include\?\((.+)\)$/s);
  if (include) {
    if (!parseIncludeFormula(s)) return null;
    const values = parseRubyStringList(include[1]!);
    if (!values) return null;
    let needle = include[2]!.trim();
    const peeled = peelTrailingCaseMethod(needle);
    const literalNeedle = parseRubyStringLiteral(peeled ? peeled.inner : needle);
    if (literalNeedle === null) return null;
    needle = JSON.stringify(literalNeedle);
    if (peeled) {
      needle = `${apCaseFn(peeled.method)}(${needle})`;
    }
    return wrapApFormula(membershipFormula(needle, values));
  }

  const caseM = s.match(/^(\{\{[^}]+\}\})\.(upcase|downcase)$/);
  if (caseM) {
    return wrapApFormula(`${apCaseFn(caseM[2]!)}(${caseM[1]})`);
  }

  // O evento ja grava time_zone. convert_timezone devolve texto de exibicao.
  const tz = s.match(
    /^(\{\{[^{}]+\}\})\.in_time_zone\("([A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)+)"\)(?:\+(\d+)\.hours)?$/,
  );
  if (tz) {
    if (!tz[3]) return tz[1]!;
    return wrapApFormula(`add_hours(${tz[1]}; ${tz[3]})`);
  }

  const pillObject = convertPillObject(s);
  if (pillObject) return pillObject;

  const catalog = convertCatalogFormula(s);
  if (catalog) return wrapApFormula(catalog);
  return null;
}

/** `{ "k": {{pill}}, ... }` no body HTTP. Nao e formula: o campo fica o JSON. */
function convertPillObject(s: string): string | null {
  if (!s.startsWith('{') || !s.endsWith('}')) return null;
  const parts = s.slice(1, -1).split(',');
  if (!parts.length) return null;
  for (const part of parts) {
    if (!/^\s*"[^"]+"\s*:\s*\{\{[^{}]+\}\}\s*$/.test(part)) return null;
  }
  return s;
}

/** Literal seguro como argumento de formula: sem aspas, barra ou quebra de linha. */
function isSafeFormulaArg(value: string): boolean {
  return value.length > 0 && !/["'\\\n\r;]/.test(value);
}

/**
 * Recortes Ruby com equivalente EXATO no catalogo de data manipulation do AP
 * (`format_date`, `replace`, ...). So entra aqui o que nao depende de
 * semantica Ruby (inspect de array, `skip`, `quote`): o resto vai para CODE.
 *
 * Argumentos com aspas/barra ficam de fora de proposito — a serializacao da
 * formula nao tem escape documentado, e um argumento mal formado quebraria o
 * campo em silencio.
 */
function convertCatalogFormula(src: string): string | null {
  const s = src.trim();

  // `today` / `today+5.days`
  if (/^today$/.test(s)) return 'today()';
  const todayPlus = s.match(/^today\s*\+\s*(\d+)\.days?$/);
  if (todayPlus) return `add_days(today(); ${todayPlus[1]})`;

  // `{{pill}}+3.hours`
  const plusHours = s.match(/^(\{\{[^{}]+\}\})\s*\+\s*(\d+)\.hours$/);
  if (plusHours) return `add_hours(${plusHours[1]}; ${plusHours[2]})`;

  // `{{pill}}+1`
  const plus = s.match(/^(\{\{[^{}]+\}\})\s*\+\s*(\d+)$/);
  if (plus) return `add(to_number(${plus[1]}); ${plus[2]})`;

  // `{{a}} + ({{b}}.to_f / 60)`
  const plusDiv = s.match(
    /^(\{\{[^{}]+\}\})\s*\+\s*\((\{\{[^{}]+\}\})\.to_f\s*\/\s*(\d+)\)$/,
  );
  if (plusDiv) {
    return `add(to_number(${plusDiv[1]}); divide(to_number(${plusDiv[2]}); ${plusDiv[3]}))`;
  }

  // `(100*((a/b)-1)).round(2)`, com `.to_i` opcional no divisor.
  const percent = s.match(
    /^\(100\*\(\((\{\{[^{}]+\}\})\/(\{\{[^{}]+\}\})(?:\.to_i)?\)-1\)\)(?:\.round\((\d+)\))?$/,
  );
  if (percent) {
    const body = `multiply(subtract(divide(to_number(${percent[1]}); to_number(${percent[2]})); 1); 100)`;
    return percent[3] ? `round(${body}; ${percent[3]})` : body;
  }

  // `({{a}}) / ({{b}}.length)`
  const overLength = s.match(/^\((\{\{[^{}]+\}\})\)\s*\/\s*\((\{\{[^{}]+\}\})\.length\)$/);
  if (overLength) return `divide(to_number(${overLength[1]}); length(${overLength[2]}))`;

  // `{{pill}}/86400.floor` — no Ruby o `.floor` é do literal; a divisão inteira é que arredonda.
  const dayFloor = s.match(/^(\{\{[^{}]+\}\})\/(\d+)\.floor$/);
  if (dayFloor) return `round_down(divide(to_number(${dayFloor[1]}); ${dayFloor[2]}))`;

  // Only an explicit date conversion proves date subtraction; untyped pills use CODE.
  const dateMinus = s.match(/^(\{\{[^{}]+\}\})\.to_date\s*-\s*(\d+)$/);
  if (dateMinus) {
    const date = dateMinus[0].includes('.to_date') ? `to_date(${dateMinus[1]})` : dateMinus[1]!;
    return `add_days(${date}; -${dateMinus[2]})`;
  }

  if (s === 'now.to_date') return 'today()';
  if (s === 'now') return 'now()';

  const daysAgo = s.match(/^(\d+)\.days\.ago$/);
  if (daysAgo) return `subtract_days(now(); ${daysAgo[1]})`;

  const yearsAgo = s.match(/^(\d+)\.years\.ago$/);
  if (yearsAgo) return `subtract_days(now(); ${Number(yearsAgo[1]) * 365})`;

  const nowFmt = s.match(/^now\.strftime\((['"])([^'"\\]+)\1\)$/);
  if (nowFmt) {
    const tokens = strftimeToApTokens(nowFmt[2]!);
    if (tokens) return `format_date(now(); ${tokens})`;
  }

  const todayFmt = s.match(/^today(?:\(\))?\s*\.strftime\((['"])([^'"\\]+)\1\)$/);
  if (todayFmt) {
    const tokens = strftimeToApTokens(todayFmt[2]!);
    if (tokens) return `format_date(today(); ${tokens})`;
  }

  const nowShift = s.match(/^\(now\s*-\s*(\d+)\.days\)\.strftime\((['"])([^'"\\]+)\2\)$/);
  if (nowShift) {
    const tokens = strftimeToApTokens(nowShift[3]!);
    if (tokens) return `format_date(subtract_days(now(); ${nowShift[1]}); ${tokens})`;
  }

  const todayMinus = s.match(
    /^\(today\s*-\s*(\d+)\.days?\)\.strftime\((['"])([^'"\\]+)\2\)(?:\.to_s)?$/,
  );
  if (todayMinus) {
    const tokens = strftimeToApTokens(todayMinus[3]!);
    if (tokens) return `format_date(add_days(today(); -${todayMinus[1]}); ${tokens})`;
  }

  const firstItem = s.match(/^(\{\{[^{}]+\}\})\.first\(\)$/);
  if (firstItem) return `first_item(${firstItem[1]})`;

  const whereChain = convertWhereChain(s);
  if (whereChain) return whereChain;

  // `({{pill}} ± N.days|months|year).strftime("%d/%m/%Y")`.
  // `({{pill}} + ({{meses}}.to_i).months)`. `%` fora do mapa (ex. `%03`) não entra.
  const shifted = parseCalendarShift(s);
  if (shifted) {
    // The AP catalogue lacks faithful month/year normalization and end-of-month
    // clamping. Let the existing Ruby compiler use its calendarAdd helper.
    if (shifted.unit !== 'days') return null;
    const base = rubyCalendarShiftExpr(shifted.date, shifted.amount, shifted.unit);
    if (!shifted.format) return base;
    const tokens = strftimeToApTokens(shifted.format);
    if (!tokens) return null;
    return `format_date(${base}; ${tokens})`;
  }

  const monthStart = s.match(/^(\{\{[^{}]+\}\})\.beginning_of_month$/);
  if (monthStart) return `start_of_month(${monthStart[1]})`;

  // `{{pill}}.split(",")[{{i}}].strip`, com `.gsub('"', "")` opcional.
  const splitAt = s.match(
    /^(\{\{[^{}]+\}\})\.split\(",\"\)\[(\{\{[^{}]+\}\})\](?:\.gsub\('"',""\))?\.strip$/,
  );
  if (splitAt) {
    const item = `split(${splitAt[1]}; ","; ${splitAt[2]})`;
    const cleaned = splitAt[0].includes('.gsub(')
      ? `replace(${item}; "${escapeFormulaString('"')}"; "")`
      : item;
    return `trim(${cleaned})`;
  }

  // `{{pill}}[0]['body'].split("sep").first.strip` — o primeiro pedaço, sem pontas.
  const splitFirst = s.match(
    /^(\{\{[^{}]+\}\})\[0\]\['(\w+)'\]\.split\("([^"\\]+)"\)\.first\.strip$/,
  );
  if (splitFirst && isSafeFormulaArg(splitFirst[2]!) && isSafeFormulaArg(splitFirst[3]!)) {
    const inner = splitFirst[1]!.slice(2, -2);
    return `trim(split({{${inner}[0]['${splitFirst[2]}']}}; "${splitFirst[3]}"; 0))`;
  }

  const whereList = matchWhereList(s);
  if (whereList && /^\{\{[^{}]+\}\}$/.test(whereList.list)) {
    return formatWhereList(whereList.list, whereList.field, whereList.value, whereList.key);
  }

  // `{{pill}}.strftime("%d/%m/%Y")`, com `.to_date` / `.to_time` / `.to_s` / `.to_i` opcionais.
  const strftime = s.match(
    /^(\{\{[^{}]+\}\})(?:\.to_date|\.to_time)?\.strftime\((['"])([^'"\\]+)\2\)(?:\.to_s|\.to_i)?$/,
  );
  if (strftime) {
    const format = strftime[3]!;
    const date = strftime[0].includes('.to_date.strftime') || strftime[0].includes('.to_time.strftime')
      ? `to_date(${strftime[1]})`
      : strftime[1];
    if (format === '%e') return `get_day(${date})`;
    const tokens = strftimeToApTokens(format);
    if (tokens) {
      const fn = /%[HIMSpl]/.test(format) && !/%[dmYy]/.test(format)
        ? 'format_time'
        : 'format_date';
      return `${fn}(${date}; ${tokens})`;
    }
  }

  // `{{pill}}.gsub("de", "para")` encadeado, so com literais seguros
  const gsub = parseGsubChain(s);
  if (gsub) return gsub;

  if (/\[.*janeiro.*dezembro.*\]\[now\.month\s*-\s*1\]/.test(s)) {
    return [
      'switch(get_month(now());',
      'January; janeiro; February; fevereiro; March; março; April; abril;',
      'May; maio; June; junho; July; julho; August; agosto;',
      'September; setembro; October; outubro; November; novembro; December; dezembro)',
    ].join(' ');
  }

  // A pill has no proven String type here. AP contains coerces arrays and
  // numbers to text; let the compiler preserve Ruby receiver semantics.

  // `{{pill}}.match?(/PHD/)` — teste booleano. Sem funcao regex no catalogo;
  // padrao literal (sem metacaractere e sem flag) e `contains`.
  const match = parseLiteralMatch(s);
  if (match) return match;

  // `{{pill}}.split("```json").last.split("```").first`
  const between = s.match(
    /^(\{\{[^{}]+\}\})\.split\("([^"\\]+)"\)\.last\.split\("([^"\\]+)"\)\.first$/,
  );
  if (between && isSafeFormulaArg(between[2]!) && isSafeFormulaArg(between[3]!)) {
    return `extract_between(${between[1]}; "${between[2]}"; "${between[3]}")`;
  }

  // AP is_not_empty only excludes null/empty strings. Ruby present? also
  // excludes false, empty lists/hashes and whitespace; use reviewed CODE.
  return null;
}

/**
 * `.where(name: 'X').pluck('value')...` vira filter_list + pluck.
 * O `.to_json.scan(/"value":.../)` do Workato so relia o campo; nao entra na formula.
 * `.compact.first&.[]('value')` fica para o compilador (o dig extra nao tem funcao).
 */
function convertWhereChain(s: string): string | null {
  const head = s.match(/^(\{\{[^{}]+\}\})\.where\(name:\s*'([^']*)'\)([\s\S]*)$/);
  if (!head) return null;
  const pill = head[1]!;
  const name = head[2]!;
  if (/["\\\n\r;]/.test(name)) return null;
  const list = `filter_list(${pill}; "name"; "${name}")`;
  const plucked = `pluck(${list}; "value")`;
  const first = `first_item(${plucked})`;
  const scan = String.raw`.to_json.scan(/"value":"([^"]+)"/).flatten.first`;
  const tails: Record<string, string> = {
    [`.pluck('value')${scan}`]: first,
    [`.pluck('value')${scan}.to_s`]: first,
    [scan]: first,
    ".pluck('value').first": first,
  };
  return tails[head[3]!] ?? null;
}

type DateUnit = 'days' | 'months' | 'years';

interface CalendarShift {
  date: string;
  amount: string;
  unit: DateUnit;
  format?: string;
}

const PILL = '\\{\\{[^{}]+\\}\\}';
const UNIT = 'days?|months?|years?';

function parseDateUnit(raw: string): DateUnit | null {
  if (/^days?$/i.test(raw)) return 'days';
  if (/^months?$/i.test(raw)) return 'months';
  if (/^years?$/i.test(raw)) return 'years';
  return null;
}

function parseCalendarShift(s: string): CalendarShift | null {
  const literal = s.match(
    new RegExp(
      `^\\((${PILL})(?:\\.to_date)?\\s*([+-])\\s*(\\d+)\\.(${UNIT})\\)(?:\\.strftime\\((['"])([^'"\\\\]+)\\5\\))?(?:\\.to_s)?$`,
    ),
  );
  if (literal) {
    const unit = parseDateUnit(literal[4]!);
    if (!unit) return null;
    const date = literal[0].includes('.to_date') ? `to_date(${literal[1]})` : literal[1]!;
    const amount = literal[2] === '-' ? `-${literal[3]}` : literal[3]!;
    return { date, amount, unit, format: literal[6] };
  }

  const fromPill = s.match(
    new RegExp(
      `^\\((${PILL})(?:\\.to_date)?\\s*([+-])\\s*\\((${PILL})(?:\\.to_i)?\\)\\.(${UNIT})\\)(?:\\.strftime\\((['"])([^'"\\\\]+)\\5\\))?(?:\\.to_s)?$`,
    ),
  );
  if (fromPill) {
    const unit = parseDateUnit(fromPill[4]!);
    if (!unit) return null;
    const date = fromPill[0].includes('.to_date') ? `to_date(${fromPill[1]})` : fromPill[1]!;
    const n = `to_number(${fromPill[3]})`;
    const amount = fromPill[2] === '-' ? `0 - ${n}` : n;
    return { date, amount, unit, format: fromPill[6] };
  }

  const bare = s.match(
    new RegExp(
      `^(${PILL})(?:\\.to_date)?\\s*([+-])\\s*(?:(\\d+)\\.(${UNIT})|\\((${PILL})(?:\\.to_i)?\\)\\.(${UNIT}))$`,
    ),
  );
  if (bare) {
    const date = bare[0].includes('.to_date') ? `to_date(${bare[1]})` : bare[1]!;
    if (bare[3]) {
      const unit = parseDateUnit(bare[4]!);
      if (!unit) return null;
      const amount = bare[2] === '-' ? `-${bare[3]}` : bare[3]!;
      return { date, amount, unit };
    }
    const unit = parseDateUnit(bare[6]!);
    if (!unit) return null;
    const n = `to_number(${bare[5]})`;
    const amount = bare[2] === '-' ? `0 - ${n}` : n;
    return { date, amount, unit };
  }
  return null;
}

/** Ultimo dia do mes (1–12). `Date(year, month, 0)` e o ultimo dia, nao transbordo de dia. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * ActiveSupport: avanca mes/ano e, se o dia nao existir no destino, usa o ultimo
 * dia desse mes. Nao e `new Date(ano, mes + n, dia)`.
 */
export function addRubyCalendarMonths(
  year: number,
  month: number,
  day: number,
  months: number,
): { year: number; month: number; day: number } {
  const zero = year * 12 + (month - 1) + months;
  const y = Math.floor(zero / 12);
  const m = zero - y * 12 + 1;
  return { year: y, month: m, day: Math.min(day, lastDayOfMonth(y, m)) };
}

/**
 * Only days have a faithful direct AP catalogue equivalent. Month/year callers
 * must use the compiler's calendarAdd, never reconstruct an invalid date string.
 */
export function rubyCalendarShiftExpr(date: string, signedAmount: string, unit: DateUnit): string {
  if (unit === 'days') return `add_days(${date}; ${signedAmount})`;
  throw new Error('AP-MIGRATION-UNSUPPORTED-CALENDAR-SHIFT: use the CODE compiler for month/year shifts.');
}

/** `%d/%m/%Y` -> `DD/MM/YYYY`. Devolve null se houver diretiva fora do recorte. */
function strftimeToApTokens(format: string): string | null {
  const map: Record<string, string> = {
    '%d': 'DD', '%m': 'MM', '%Y': 'YYYY', '%y': 'YY',
    '%H': 'HH', '%M': 'mm', '%S': 'ss',
  };
  let out = '';
  for (let i = 0; i < format.length; i++) {
    if (format[i] === '%') {
      const token = map[format.slice(i, i + 2)];
      if (!token) return null;
      out += token;
      i++;
      continue;
    }
    if (!/[\s/:\-.]/.test(format[i]!)) return null;
    out += format[i];
  }
  return out.length ? out : null;
}

/**
 * `.gsub(a, b).gsub(c, d)` sobre uma pill -> replace/remove aninhados.
 * Argumentos aceitos: literal seguro, pill, `pill.to_s` e `today.strftime`.
 * Qualquer outro argumento deixa a cadeia inteira para o compilador.
 */
function parseGsubChain(s: string): string | null {
  const head = s.match(/^(\{\{[^{}]+\}\})/);
  if (!head) return null;
  let expr = head[1]!;
  let i = head[1]!.length;
  let calls = 0;
  while (s.startsWith('.gsub(', i)) {
    i += '.gsub('.length;
    const find = parseGsubArg(s, i);
    if (!find) return null;
    i = skipGsubSpace(s, find.end);
    if (s[i] !== ',') return null;
    i = skipGsubSpace(s, i + 1);
    const to = parseGsubArg(s, i);
    if (!to) return null;
    i = skipGsubSpace(s, to.end);
    if (s[i] !== ')') return null;
    i += 1;
    expr = to.empty ? `remove(${expr}; ${find.expr})` : `replace(${expr}; ${find.expr}; ${to.expr})`;
    calls += 1;
  }
  if (!calls || skipGsubSpace(s, i) !== s.length) return null;
  return expr;
}

function skipGsubSpace(s: string, i: number): number {
  while (s[i] === ' ' || s[i] === '\t') i += 1;
  return i;
}

/** Argumento de `.gsub` com equivalente direto no catalogo AP. */
function parseGsubArg(s: string, start: number): { expr: string; end: number; empty: boolean } | null {
  const i = skipGsubSpace(s, start);
  const pill = s.slice(i).match(/^(\{\{[^{}]+\}\})(\.to_s)?/);
  if (pill) return { expr: pill[1]!, end: i + pill[0]!.length, empty: false };
  const today = s.slice(i).match(/^today(?:\(\))?\s*\.strftime\((['"])([^'"\\]+)\1\)/);
  if (today) {
    const tokens = strftimeToApTokens(today[2]!);
    if (!tokens) return null;
    return { expr: `format_date(today(); ${tokens})`, end: i + today[0]!.length, empty: false };
  }
  const quote = s[i];
  if (quote !== '"' && quote !== "'") return null;
  let value = '';
  let j = i + 1;
  while (j < s.length && s[j] !== quote) {
    if (s[j] === '\\') return null;
    value += s[j];
    j += 1;
  }
  if (s[j] !== quote) return null;
  if (value.length === 0) return { expr: '""', end: j + 1, empty: true };
  if (!isSafeFormulaArg(value)) return null;
  return { expr: `"${value}"`, end: j + 1, empty: false };
}

/**
 * `.match?(/texto/)` sem flag e sem metacaractere. `String#match?` devolve
 * true/false; o catalogo nao tem `regex`, e o teste literal e `contains`.
 * `/a.c/`, `/a|b/` e `/phd/i` ficam de fora (nao sao substring).
 */
function parseLiteralMatch(s: string): string | null {
  const m = s.match(/^(\{\{[^{}]+\}\})\.match\?\(\/((?:\\.|[^/\n])+)\/([imx]*)\)$/);
  if (!m || m[3]) return null;
  const source = m[2]!.replace(/\\\//g, '/');
  if (/[.*+?^$|()[\]{}\\]/.test(source)) return null;
  if (!isSafeFormulaArg(source)) return null;
  return `contains(${m[1]}; "${source}")`;
}

/**
 * Ternario Ruby `cond ? a : b`. O `?` do operador nao cola num identificador
 * (`present?`, `ID?`). Interrogacao no meio da frase, com `:` so depois
 * (rotulo entre pills, `font-weight:`), nao e ternario.
 */
function hasRubyTernary(s: string): boolean {
  return rubySyntaxFeatures(s)?.ternary ?? false;
}

/** metodos Ruby detectados na string (indicam necessidade de step CODE). */
export function detectRubyMethods(s: string): string[] {
  const found = new Set<string>();
  const features = rubySyntaxFeatures(s);
  if (features) {
    for (const m of RUBY_METHODS) if (features.methods.includes(m)) found.add(m);
    if (features.ternary) found.add('ternary');
    return [...found];
  }
  // Preserve conservative detection on malformed/unsupported source; it cannot
  // make a refused formula valid or remove its marker.
  for (const m of RUBY_METHODS) {
    const re = new RegExp('\\.' + m.replace('?', '\\?') + '\\b|\\.' + m.replace('?', '') + '\\(');
    if (re.test(s)) found.add(m);
  }
  if (hasRubyTernary(s)) found.add('ternary');
  return [...found];
}

/** classifica uma string de input como formula (e se precisa de CODE). */
export function analyzeFormula(s: string): FormulaHit | null {
  if (!hasPill(s)) return null;
  if (parseIncludeFormula(s)) return { raw: s, rubyMethods: [], needsCode: false };
  const peeled = peelTrailingCaseMethod(s);
  if (peeled) {
    const inner = peeled.inner.startsWith('=') ? peeled.inner : `=${peeled.inner}`;
    if (!isRubyExpression(inner)) return { raw: s, rubyMethods: [], needsCode: false };
  }
  const rubyMethods = detectRubyMethods(s);
  return { raw: s, rubyMethods, needsCode: rubyMethods.length > 0 };
}

/**
 * Dado o template da colecao iterada (ex. `{{step_3.nodes}}`), devolve o item
 * do foreach que a itera no escopo atual (ex. `loop_2.item`).
 */
export type LoopItemResolver = (collection: string) => string | undefined;

/** Contagem de pills `job_context` já traduzidas nesta receita. */
export type JobContextHits = { name: number; id: number; link: number; created: number; run: number };

export type PillOptions = {
  recipeName?: string;
  recipeId?: string;
  jobContextHits?: JobContextHits;
  /** `as` de passos `skip: true`; consumidores ativos precisam de revisão. */
  skippedAs?: Set<string>;
  /** Aliases repetidos/ambíguos não podem selecionar uma das origens. */
  invalidAs?: Set<string>;
  /**
   * Consumidor tambem desligado: hash solto (passo apagado) nao vira TODO_ref —
   * o step pulado nao precisa da referencia para revisar.
   */
  omitDangling?: boolean;
  /** Nome iPaaS → origem Workato. Propriedade de conta e de projeto. */
  projectVariables?: Map<string, string>;
  /** Campos do catch sem equivalente no iPaaS. O valor vira literal vazio. */
  catchFieldGaps?: Set<string>;
};

/** Marcador interno. `convertPills` tira do texto antes de devolver. */
const FLOW_LINK = '\u0000flow-link\u0000';

/**
 * A pill de mensagem do catch. O clone do `onFailureAction` troca pelo step
 * que falhou: `{{step_N['error']['message']}}`.
 */
export const CATCH_ERROR_TOKEN = '{{__catch_error__}}';

/** O erro do iPaaS não tem `type`. Some antes de gravar o campo. */
const CATCH_TYPE_TOKEN = '\u0000catch-type\u0000';

const CATCH_GAP_KEYS = new Set(['retry_count', 'uuid', 'step', 'line_number', 'action']);

/** `message` aponta para o step que falhou. O resto não existe no iPaaS. */
function renderCatchField(key: string, options: PillOptions | undefined): string | null {
  if (key === 'message' || key === '') return CATCH_ERROR_TOKEN;
  if (key === 'type') return CATCH_TYPE_TOKEN;
  if (CATCH_GAP_KEYS.has(key)) {
    options?.catchFieldGaps?.add(key);
    return '';
  }
  return null;
}

function tidyCatch(text: string): string {
  if (!text.includes(CATCH_TYPE_TOKEN) && !text.includes(CATCH_ERROR_TOKEN)) return text;
  return text
    .split(`${CATCH_TYPE_TOKEN}: `)
    .join('')
    .split(`${CATCH_TYPE_TOKEN}: ${CATCH_ERROR_TOKEN}`)
    .join(CATCH_ERROR_TOKEN)
    .split(`${CATCH_TYPE_TOKEN}:${CATCH_ERROR_TOKEN}`)
    .join(CATCH_ERROR_TOKEN)
    .split(`${CATCH_TYPE_TOKEN} - ${CATCH_ERROR_TOKEN}`)
    .join(CATCH_ERROR_TOKEN)
    .split(`${CATCH_TYPE_TOKEN}-${CATCH_ERROR_TOKEN}`)
    .join(CATCH_ERROR_TOKEN)
    .split(CATCH_TYPE_TOKEN)
    .join('');
}

function renderJobContext(key: string | undefined, options: PillOptions | undefined): string | null {
  const hits = options?.jobContextHits;
  if (key === 'recipe_name') {
    if (hits) hits.name += 1;
    return options?.recipeName || '{{TODO_pill}}';
  }
  if (key === 'recipe_id') {
    if (hits) hits.id += 1;
    return options?.recipeId || '{{TODO_pill}}';
  }
  if (key === 'recipe_url' || key === 'job_url') {
    if (hits) hits.link += 1;
    return FLOW_LINK;
  }
  if (key === 'job_created_at') {
    if (hits) hits.created += 1;
    return "{{job_now['now']}}";
  }
  // Workato `job_id` é o id da execução. O piece flow-helper `getRunId` devolve `{ id }`.
  if (key === 'job_id') {
    if (hits) hits.run += 1;
    return "{{job_run['id']}}";
  }
  return null;
}

function tidyJobContext(text: string): string {
  text = tidyCatch(text);
  if (!text.includes(FLOW_LINK)) return text;
  return text
    .split(FLOW_LINK)
    .join('')
    .replace(/[ \t]*\([ \t]*\)/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/^[ \t]*[^:\n]{1,80}:[ \t]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

/**
 * Nome do step AP para o `as` Workato. Objeto quando o payload da piece mora
 * dentro de um envelope (Pipefy: `data`, e `data.card` no getCardById);
 * string simples nos demais casos.
 *
 * Nao usar `output` aqui: isso e o envelope do step no schema AP 21+
 * (release 0.85.4). O iPaaS prefixa `['output']` no import de um flow v20.
 * Gravando `output` no template, a migracao vira `['output'].output...`.
 */
export type StepBinding = string | {
  name: string;
  outputRoot?: string;
  stripHead?: string;
  /** Ação da piece. `getCardsByFieldValue` não tem `cards_count`; a contagem é `count(data.cards)`. */
  actionName?: string;
  /** Primeiro segmento Workato (`list`) vira a chave do array no output do Code. */
  headAlias?: { from: string; to: string };
  /**
   * Variavel escalar no Storage: cada campo e um `get` e o valor e o escalar.
   * A pill Workato ainda traz o campo no path; o primeiro segmento escolhe o get.
   */
  scalarFields?: ReadonlyMap<string, string>;
};

export type StepNameMap = Map<string, StepBinding>;

export function stepBindingName(binding: StepBinding | undefined): string | undefined {
  if (binding == null) return undefined;
  return typeof binding === 'string' ? binding : binding.name;
}

export function stepOutputRoot(binding: StepBinding | undefined): string | undefined {
  if (!binding || typeof binding === 'string') return undefined;
  return binding.outputRoot;
}

/** `list` do Lists by Workato vira `items` no Code. O resto do path fica. */
function aliasListHead(binding: StepBinding | undefined, segments: string[]): string[] {
  if (!binding || typeof binding === 'string' || !binding.headAlias) return segments;
  const { from, to } = binding.headAlias;
  const head = segments[0];
  if (!head) return segments;
  if (head === from) return [to, ...segments.slice(1)];
  if (head.startsWith(`${from}[`)) return [`${to}${head.slice(from.length)}`, ...segments.slice(1)];
  return segments;
}

/** O Storage guarda a lista crua. A pill Workato ainda diz `list_items`. */
export function withoutStripHead<T extends string | number>(binding: StepBinding | undefined, segments: T[]): T[] {
  const head = !binding || typeof binding === 'string' ? undefined : binding.stripHead;
  if (head && segments[0] === head) return segments.slice(1);
  return segments;
}

/**
 * O Storage guarda o escalar na chave do campo. A pill Workato ainda diz
 * `variavel.campo`; o campo sai do path e o step do `get` entra no lugar.
 */
function redirectScalarField<T extends string | number>(
  binding: StepBinding | undefined,
  base: string,
  segments: T[],
): { base: string; segments: T[] } {
  if (!binding || typeof binding === 'string' || !binding.scalarFields?.size) return { base, segments };
  const head = segments[0];
  const step = typeof head === 'string' ? binding.scalarFields.get(head) : undefined;
  if (!step) return { base, segments };
  return { base: step, segments: segments.slice(1) };
}

/** Segmentos do envelope da piece. Evita `data.card.card` se o path Workato ja comeca com `card`. */
export function outputRootSegments(
  binding: StepBinding | undefined,
  pathHead?: string,
): string[] {
  const root = stepOutputRoot(binding);
  if (!root) return [];
  const segs = root.split('.').filter(Boolean);
  if (pathHead === 'card' && segs.at(-1) === 'card') return segs.slice(0, -1);
  return segs;
}

function escapeApKey(key: string): string {
  return key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
    .replace(/\u0008/g, '\\b').replace(/\f/g, '\\f');
}

/** `data.card.id` -> `['data']['card']['id']`. Indice numerico fica `[0]`, sem aspas. */
export function formatApSegment(seg: string): string {
  const indexed = seg.match(/^(.+)\[(\d+)\]$/);
  if (indexed) return `['${escapeApKey(indexed[1]!)}'][${indexed[2]}]`;
  if (/^\d+$/.test(seg)) return `[${seg}]`;
  return `['${escapeApKey(seg)}']`;
}

/**
 * Acesso estilo picker/Copy reference. Ponto vira misto depois da migracao v21
 * (`trigger['output'].data.card.id`); colchete em cada chave vira o amarelo
 * (`trigger['output']['data']['card']['id']`).
 */
export function renderApTemplate(base: string, segments: string[] = []): string {
  return `{{${base}${segments.map(formatApSegment).join('')}}}`;
}

/** Inspect the reference base, excluding quoted field names from marker detection. */
export function containsMigrationMarker(value: string, kind?: 'formula' | 'reference'): boolean {
  let cursor = 0;
  while (cursor < value.length) {
    let start = value.indexOf('{{', cursor);
    const literalEnd = start < 0 ? value.length : start;
    if (kind !== 'reference' && /TODO_FORMULA\(/.test(value.slice(cursor, literalEnd))) return true;
    if (start < 0) return false;
    let quote: string | undefined;
    let end = start + 2;
    for (; end < value.length; end++) {
      const ch = value[end];
      if (quote) {
        if (ch === '\\') { end++; continue; }
        if (ch === quote) quote = undefined;
      } else if (ch === "'" || ch === '"') quote = ch;
      else if (value.startsWith('{{', end)) {
        // An unfinished outer template cannot consume a subsequent marker.
        start = end;
        end++;
      }
      else if (value.startsWith('}}', end)) break;
    }
    if (end >= value.length) return false;
    // TODO_* is the reserved base of unresolved templates. A field key in a
    // valid step reference may freely contain the same characters.
    const marker = value.slice(start + 2, end).match(/^\s*(TODO_[A-Za-z0-9_]+)(?=$|[.\[\s])/);
    if (marker && (!kind || kind === (marker[1] === 'TODO_formula' ? 'formula' : 'reference'))) return true;
    cursor = end + 2;
  }
  return false;
}

/** Structured JSON paths carry their own segment types, unlike the legacy dot renderer. */
function renderPillTemplate(base: string, segments: PillPathSegment[] = []): string {
  return `{{${base}${segments.map((segment) => typeof segment === 'number'
    ? `[${segment}]` : `['${escapeApKey(segment)}']`).join('')}}}`;
}

function aliasPillListHead(binding: StepBinding | undefined, segments: PillPathSegment[]): PillPathSegment[] {
  if (!binding || typeof binding === 'string' || !binding.headAlias) return segments;
  const { from, to } = binding.headAlias;
  return segments[0] === from ? [to, ...segments.slice(1)] : segments;
}

/** Propriedade de conta ou de projeto (`pdf_generator_api_key`, `d4sign.prd.url`) vira a variavel iPaaS `PDF_GENERATOR_API_KEY`. */
export function accountPropertyVariable(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

function renderPropertyVariable(kind: 'conta' | 'projeto', propertyName: string, options?: PillOptions): string {
  const name = accountPropertyVariable(propertyName);
  const origin = `propriedade de ${kind} \`${propertyName}\``;
  const known = options?.projectVariables;
  if (known) {
    const prev = known.get(name);
    if (!prev) known.set(name, origin);
    else if (!prev.includes(propertyName)) known.set(name, `${prev}; ${origin}`);
  }
  return `{{variables['${name}']}}`;
}

const DOTTED_STEP_PILL = /\{\{([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*)+)((?:\[[^\]]*\])*)\}\}/g;

/**
 * Pills internas do motor (`formula_1.f1`, `loop_2.item['id']`, `step_3.a.b`) saem em colchete.
 * Depois do import v21 o ponto vira `['output'].f1` (JS valido, mas amarelo so com colchete).
 * Nao mexe em `sourceCode` nem em `notes`: ali a pill e so documentacao.
 */
export function bracketizePills<T>(value: T, key?: string): T {
  if (key === 'sourceCode' || key === 'notes') return value;
  if (typeof value === 'string') {
    return value.replace(DOTTED_STEP_PILL, (_m, name: string, dots: string, rest: string) => {
      const segs = dots.split('.').filter(Boolean).map(formatApSegment).join('');
      return `{{${name}${segs}${rest}}}`;
    }) as T;
  }
  if (Array.isArray(value)) return value.map((item) => bracketizePills(item)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = bracketizePills(v, k);
    return out as T;
  }
  return value;
}

/** `lowercase` / `uppercase` no catalogo AP, depois que as pills ja viraram `{{...}}`. */
export function wrapApCase(value: string, method: 'upcase' | 'downcase', rubyResidual = false): string {
  const residual = rubyResidual && value.match(/^TODO_FORMULA\((.*)\)$/s);
  if (residual) {
    // Keep a generated whole-value Ruby residual visible to harvest. Wrapping
    // it as AP quoted text would hide it and uppercase the marker itself.
    return `TODO_FORMULA((${residual[1]!}).${method})`;
  }
  const fn = apCaseFn(method);
  const already = value.match(/^ap-formula-v1::\{(.*)\}::ap-formula-v1$/s);
  const inner = already
    ? already[1]!
    : /^\{\{[^{}]+\}\}$/.test(value)
      ? value
      : `"${escapeFormulaString(value)}"`;
  return wrapApFormula(`${fn}(${inner})`);
}

/**
 * Renderiza uma data pill estruturada como template AP.
 *
 * Os elementos de `path` sao normalmente strings, mas alguns sao OBJETOS que
 * denotam uma operacao sobre a lista. Um `join('.')` transformava esses objetos
 * em `[object Object]`, gerando template que nao resolve em runtime — e sem
 * aviso, porque o step continuava valido.
 *
 *  - `current_item`: item atual -> item do foreach que itera a colecao
 *    acumulada ate aqui (resolucao LEXICAL).
 *  - `size`: tamanho da lista -> `.length`.
 *  - `join` / `current_index`: sem equivalente fiel -> TODO.
 */
function renderDataPill(
  json: string,
  asToName: StepNameMap,
  resolveLoopItem?: LoopItemResolver,
  options?: PillOptions,
): string {
  let dp: any;
  try {
    dp = JSON.parse(json);
  } catch {
    return '{{TODO_pill}}';
  }
  if (!dp || typeof dp !== 'object' || Array.isArray(dp)) return '{{TODO_pill}}';
  const path: any[] = Array.isArray(dp.path) ? dp.path : [];
  if (dp.pill_type === 'job_context') {
    if (!Array.isArray(dp.path)) return '{{TODO_pill}}';
    const key = path.find((element) => typeof element === 'string') as string | undefined;
    const job = renderJobContext(key, options);
    if (job !== null) return job;
    // Sem `line`. Usar o mapa emitia `{{undefined['…']}}`.
    return '{{TODO_pill}}';
  }
  if (
    (dp.pill_type === 'account_property' || dp.pill_type === 'project_property') &&
    typeof dp.property_name === 'string'
  ) {
    const kind = dp.pill_type === 'account_property' ? 'conta' : 'projeto';
    return renderPropertyVariable(kind, dp.property_name, options);
  }
  const foreachMetaKey =
    dp.pill_type === 'foreach_meta' && typeof dp.key === 'string' && dp.key.length > 0;
  if (!Array.isArray(dp.path) && !foreachMetaKey) {
    return '{{TODO_pill}}';
  }
  if (path.some((element) => typeof element !== 'string' &&
    !(typeof element === 'number' && Number.isSafeInteger(element) && element >= 0) &&
    !(element && typeof element === 'object' && !Array.isArray(element)))) {
    return '{{TODO_pill}}';
  }
  const rawLine = dp.line ?? dp.provider;
  const line = typeof rawLine === 'string' || typeof rawLine === 'number' ? String(rawLine) : undefined;
  const mapped = asToName.get(line ?? '');
  const mappedName = stepBindingName(mapped);

  // O catch do Workato nao vira passo. A mensagem aponta para o step que falhou,
  // em ['error']['message'] (irmao de output). O `type` nao existe no iPaaS.
  if (dp.provider === 'catch' && path.every((element) => typeof element !== 'object')) {
    const key = path.filter((element) => typeof element === 'string').join('.');
    const caught = renderCatchField(key, options);
    if (caught !== null) return caught;
  }

  if (line && options?.invalidAs?.has(line)) return '{{TODO_ref}}';

  // A disabled producer has no output. Its active consumers cannot receive
  // an invented empty value; only an explicitly disabled consumer may omit it.
  if (options?.skippedAs?.has(String(line))) return options?.omitDangling ? '' : '{{TODO_ref}}';

  // `line` e o `as` do passo de origem. Sem entrada no mapa, a pill aponta para
  // um passo que nao existe na receita — acontece quando o passo e apagado e a
  // referencia fica para tras. Repassar o hash cru gerava template que o AP
  // resolve como vazio em silencio; marcar invalida o step para revisao.
  // Consumidor desligado: o hash solto e resto de um passo pulado/apagado.
  if (!mappedName) {
    if (options?.omitDangling) return '';
    return '{{TODO_ref}}';
  }

  // Metadados do foreach (`index`, `is_first`, `is_last`) moram no loop, nao no item.
  if (foreachMetaKey) {
    const loop = mappedName.replace(/\.item$/, '');
    if (dp.key === 'index' || dp.key === 'is_first' || dp.key === 'is_last') {
      return renderApTemplate(loop, [dp.key]);
    }
    return '{{TODO_pill}}';
  }

  let base = mappedName;
  if (
    mappedName &&
    path.length === 1 &&
    path[0] === 'cards_count'
  ) {
    const counted = cardsCountFormula(mapped, mappedName);
    if (counted) return counted;
  }
  const pathHead = path.find((element) => typeof element === 'string') as string | undefined;
  let segments: PillPathSegment[] = outputRootSegments(mapped, pathHead);
  let activeBinding = mapped;
  const render = () => {
    const stored = redirectScalarField(activeBinding, base,
      withoutStripHead(activeBinding, aliasPillListHead(activeBinding, segments)));
    return renderPillTemplate(stored.base, stored.segments);
  };

  for (const element of path) {
    if (!element || typeof element !== 'object') {
      segments.push(element);
      continue;
    }
    if (element.path_element_type === 'size') {
      segments.push('length');
      continue;
    }
    if (element.path_element_type === 'current_item') {
      const item = resolveLoopItem?.(render());
      if (item) {
        // Item do foreach e o valor cru, sem o envelope da piece.
        base = item;
        segments = [];
        activeBinding = undefined;
        continue;
      }
      // Sem foreach no escopo. O Workato usa o primeiro item da lista
      // (docs "Lists"); listas sao indexadas em 0.
      segments.push(0);
      continue;
    }
    return '{{TODO_pill}}';
  }
  return render();
}

function appendPillPath(pill: string, extra: PillPathSegment[]): string {
  if (!pill) return '';
  if (!extra.length || containsMigrationMarker(pill)) return pill;
  const access = renderPillTemplate('', extra).slice(2, -2);
  if (!/^\{\{[^}]+\}\}$/.test(pill)) return '{{TODO_pill}}';
  return `{{${pill.slice(2, -2)}${access}}}`;
}

function isRepeatIndexPill(json: string): boolean {
  try {
    const dp = JSON.parse(json) as { provider?: string; path?: unknown };
    return (
      dp.provider === 'repeat' &&
      Array.isArray(dp.path) &&
      dp.path.length === 1 &&
      dp.path[0] === 'index'
    );
  } catch {
    return false;
  }
}

function isForeachIndexPill(json: string): boolean {
  try {
    const dp = JSON.parse(json) as { pill_type?: string; key?: string };
    return dp.pill_type === 'foreach_meta' && dp.key === 'index';
  } catch {
    return false;
  }
}

function renderDynamicIndexedPillPath(
  listPill: string,
  indexPill: string,
  extra: PillPathSegment[],
): string {
  if (!/^\{\{[^}]+\}\}$/.test(listPill) || !/^\{\{[^}]+\}\}$/.test(indexPill)) return '{{TODO_pill}}';
  let suffix = '';
  for (const segment of extra) {
    if (typeof segment === 'number') suffix += `[${segment}]`;
    else if (/[\n\r\t\b\f]/.test(segment)) {
      // Controls need escaped double quotes for both JS and Ruby. Prevent
      // Ruby interpolation of literal hash characters in the field name.
      suffix += `[${JSON.stringify(segment).replace(/#/g, '\\#')}]`;
    } else {
      suffix += `['${escapeApKey(segment)}']`;
    }
  }
  // Dynamic indexing is Ruby computation, not a concatenation of AP templates.
  return `TODO_FORMULA(${listPill}[${indexPill}]${suffix})`;
}

/**
 * `lista[_dp(repeat.index)]` e `lista.pluck('campo')[_dp(repeat.index)]` —
 * o Repeat while que percorre a lista pelo indice. No LOOP_ON_ITEMS isso e o
 * item atual (ou o campo do item), nao um acesso por posicao.
 */
function replaceListIndexAccess(
  input: string,
  asToName: StepNameMap,
  resolveLoopItem?: LoopItemResolver,
  options?: PillOptions,
): { out: string; replaced: boolean } {
  if (!resolveLoopItem) return { out: input, replaced: false };
  let replaced = false;
  const resolveItem = (listJson: string): string | undefined => {
    const collection = renderDataPill(listJson, asToName, resolveLoopItem, options);
    return resolveLoopItem(collection);
  };
  let out = input.replace(
    /(?:#\{)?_dp\('(.+?)'\)\}?\.pluck\('([^']+)'\)\[_dp\('(.+?)'\)\]/g,
    (match, listJson: string, field: string, indexJson: string) => {
      if (!isRepeatIndexPill(indexJson) || !/^[\w-]+$/.test(field)) return match;
      const item = resolveItem(listJson);
      if (!item) return match;
      replaced = true;
      return `{{${item}${formatApSegment(field)}}}`;
    },
  );
  out = out.replace(
    /(?:#\{)?_dp\('(.+?)'\)\[_dp\('(.+?)'\)\]\}?/g,
    (match, listJson: string, indexJson: string) => {
      if (!isRepeatIndexPill(indexJson)) return match;
      const item = resolveItem(listJson);
      if (!item) return match;
      replaced = true;
      return `{{${item}}}`;
    },
  );
  return { out, replaced };
}

/** `_dp(...)['literal.key'][0]` → exact keys and indexes inside the template. */
function convertPillPathFormula(
  input: string,
  asToName: StepNameMap,
  resolveLoopItem?: LoopItemResolver,
  options?: PillOptions,
): string | null {
  const parsed = pureStructuredPill(input);
  if (parsed) {
    const rendered = renderDataPill(parsed.json, asToName, resolveLoopItem, options);
    return appendPillPath(rendered, parsed.segments);
  }

  let source = input.trim().replace(/^=\s*/, '');
  const interpolated = source.startsWith('#{');
  if (interpolated) source = source.slice(2);
  const call = structuredPillAt(source, 0);
  if (!call) return null;
  let suffix = source.slice(call.end);
  if (interpolated) {
    if (suffix.startsWith('}')) suffix = suffix.slice(1);
    else if (suffix.endsWith('}')) suffix = suffix.slice(0, -1);
    else return null;
  }

  const staticAccess = readPillAccess(suffix);
  if (staticAccess === 'invalid_literal') return '{{TODO_pill}}';
  if (staticAccess && staticAccess.end === suffix.length) {
    const rendered = renderDataPill(call.json, asToName, resolveLoopItem, options);
    return appendPillPath(rendered, staticAccess.segments);
  }

  if (suffix.startsWith('[_dp(')) {
    const indexCall = structuredPillAt(suffix, 1);
    if (indexCall && suffix[indexCall.end] === ']') {
      const indexJson = indexCall.json;
      if (isForeachIndexPill(indexJson) && !isRepeatIndexPill(indexJson)) {
        const rest = suffix.slice(indexCall.end + 1);
        const tail = parsePillAccess(rest);
        if (tail) {
          const listRendered = renderDataPill(call.json, asToName, resolveLoopItem, options);
          const indexRendered = renderDataPill(indexJson, asToName, resolveLoopItem, options);
          if (listRendered && indexRendered && !containsMigrationMarker(listRendered + indexRendered)) {
            return renderDynamicIndexedPillPath(listRendered, indexRendered, tail);
          }
        }
      }
    }
  }

  return null;
}

/**
 * `.where(field:"val")[0]['key']` e o mesmo encadeamento com `.first["key"]`.
 * Vira filter_list + pluck + first_item.
 */
function matchWhereList(src: string): { list: string; field: string; value: string; key: string } | null {
  const m = src.match(
    /^(.*)\.where\((\w+)\s*:\s*"((?:[^"\\]|\\.)*)"\)(?:\[0\]\['(\w+)'\]|\.first\["(\w+)"\])$/,
  );
  const key = m?.[4] || m?.[5];
  if (!m?.[1] || !m[2] || m[3] == null || !key) return null;
  return { list: m[1], field: m[2], value: m[3], key };
}

function formatWhereList(listRef: string, field: string, rawValue: string, key: string): string {
  const value = rawValue.replace(/\\"/g, '"').replace(/"/g, '\\"');
  return `first_item(pluck(filter_list(${listRef};"${field}";"${value}");"${key}"))`;
}

/** `_dp(...).where(field:"val")[0]['key']` ou `.first["key"]`. */
function convertWhereListFormula(
  input: string,
  asToName: StepNameMap,
  resolveLoopItem?: LoopItemResolver,
  options?: PillOptions,
): string | null {
  const hit = matchWhereList(input.trim().replace(/^=/, ''));
  if (!hit) return null;
  const dp = hit.list.match(/^(?:#\{)?_dp\('(.+)'\)\}?$/);
  if (!dp) return null;
  const listRef = renderDataPill(dp[1]!, asToName, resolveLoopItem, options);
  if (!listRef) return '';
  return wrapApFormula(formatWhereList(listRef, hit.field, hit.value, hit.key));
}

/** `_('data....', 'list_meta', ...)` — so o primeiro argumento importa; `____Size` e o tamanho da lista. */
const FLAT_DATA_PILL_RE =
  /_\(\s*(['"])data\.([^'"]+)\1(?:\s*,\s*(?:'[^']*'|"[^"]*"))*\s*\)/g;

function renderFlatDataRef(ref: string, asToName: StepNameMap, options?: PillOptions): string {
  const parts = String(ref).split('.');
  if (parts[0] === 'workato' && parts[1] === 'job_context' && parts[2]) {
    const job = renderJobContext(parts[2], options);
    if (job !== null) return job;
  }
  if (parts[parts.length - 1] === '____Size') {
    let listParts = parts.slice(0, -1);
    if (listParts[listParts.length - 1] === 'first') listParts = listParts.slice(0, -1);
    const listPill = renderDataRef(listParts.join('.'), asToName, options);
    return wrapApFormula(`length(${listPill})`);
  }
  return renderDataRef(ref, asToName, options);
}

/** Campo que e so uma pill achatada Workato (com metadados extras), nao Ruby. */
function convertWholeFlatDataPill(
  input: string,
  asToName: StepNameMap,
  options?: PillOptions,
): string | null {
  const body = input.trim().replace(/^=\s*/, '');
  const withToS = body.match(/^_\(\s*(['"])data\.([^'"]+)\1(?:\s*,\s*(?:'[^']*'|"[^"]*"))*\s*\)\s*\.to_s\s*$/);
  if (withToS) return renderFlatDataRef(withToS[2], asToName, options);
  const m = body.match(
    /^_\(\s*(['"])data\.([^'"]+)\1(?:\s*,\s*(?:'[^']*'|"[^"]*"))*\s*\)\s*$/,
  );
  if (!m) return null;
  return renderFlatDataRef(m[2], asToName, options);
}

/**
 * `data.<provider>.<as>.<path>` (forma do `_('...')`) -> template AP.
 *
 * `foreach` expoe `index` como metadado do proprio loop, nao do item: o `as`
 * resolve para `loop_N.item`, mas o indice mora em `loop_N.index`.
 */
function renderDataRef(ref: string, asToName: StepNameMap, options?: PillOptions): string {
  const parts = String(ref).split('.');
  if (parts.length < 2 || parts.some((part) => part === '')) return '{{TODO_pill}}';
  if (parts[0] === 'catch') {
    const caught = renderCatchField(parts.slice(2).join('.'), options);
    if (caught !== null) return caught;
  }
  const as = parts[1];
  const path = parts.slice(2).join('.');
  if (as && options?.invalidAs?.has(as)) return '{{TODO_ref}}';
  if (as && options?.skippedAs?.has(as)) return options?.omitDangling ? '' : '{{TODO_ref}}';
  const binding = as ? asToName.get(as) : undefined;
  const mapped = stepBindingName(binding);
  if (!mapped) return options?.omitDangling ? '' : '{{TODO_ref}}';
  if (parts[0] === 'foreach' && /^(index|is_first|is_last)\b/.test(path)) {
    const loop = mapped.replace(/\.item$/, '');
    const key = path.split('.')[0]!;
    return renderApTemplate(loop, [key]);
  }
  if (path === 'cards_count') {
    const counted = cardsCountFormula(binding, mapped);
    if (counted) return counted;
  }
  const pathHead = path.split('.')[0];
  const segs = withoutStripHead(binding, aliasListHead(binding, [
    ...outputRootSegments(binding, pathHead),
    ...path.split('.').filter(Boolean),
  ]));
  const stored = redirectScalarField(binding, mapped, segs);
  return renderApTemplate(stored.base, stored.segments);
}

/**
 * Converte pills SIMPLES para template AP. Nao resolve formulas com metodo Ruby
 * (essas viram step CODE). asToName: mapa do `as` do Workato -> nome do step AP.
 */
function replaceBareInterpolation(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    if (!src.startsWith('#{', i)) {
      out += src[i];
      continue;
    }
    const end = rubyInterpolationEnd(src, i + 2);
    if (end < 0) {
      out += src[i];
      continue;
    }
    const inner = src.slice(i + 2, end);
    const keep = inner.includes('{{') || /\.[A-Za-z_]/.test(inner);
    out += keep ? src.slice(i, end + 1) : '{{TODO_formula}}';
    i = end;
  }
  return out;
}

function rubyInterpolationEnd(src: string, j: number): number {
  let depth = 1;
  while (j < src.length) {
    const ch = src[j]!;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      j++;
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\') j += 2;
        else j++;
      }
      j++;
      continue;
    }
    if (src.startsWith('{{', j)) {
      const end = src.indexOf('}}', j + 2);
      if (end < 0) return -1;
      j = end + 2;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

export function convertPills(
  input: string,
  asToName: StepNameMap,
  resolveLoopItem?: LoopItemResolver,
  options?: PillOptions,
): string {
  if (typeof input !== 'string') return input;
  if (EMPTY_FORMULA.test(input)) return '';
  const literal = input.match(LITERAL_FORMULA);
  if (literal) {
    const decoded = parseRubyStringLiteral(input.slice(1));
    if (decoded !== null) {
      if (/_dp\(|_\(\s*['"]data\./.test(decoded)) {
        return convertPills(decoded, asToName, resolveLoopItem, options);
      }
      return decoded;
    }
  }
  const whereList = convertWhereListFormula(input, asToName, resolveLoopItem, options);
  if (whereList) return tidyJobContext(whereList);
  const pillPath = convertPillPathFormula(input, asToName, resolveLoopItem, options);
  if (pillPath !== null) return tidyJobContext(pillPath);
  const wholeFlat = convertWholeFlatDataPill(input, asToName, options);
  if (wholeFlat !== null) return tidyJobContext(wholeFlat);

  // A whole-field #{...} pill expression has the same contract as its body.
  // Static paths were handled above; dynamic access must reach the CODE compiler
  // without an unmatched interpolation wrapper (or a falsely valid raw string).
  const wrappedSource = input.trim().replace(/^=\s*/, '');
  if (wrappedSource.startsWith('#{') && rubyInterpolationEnd(wrappedSource, 2) === wrappedSource.length - 1) {
    const body = wrappedSource.slice(2, -1);
    if (/_dp\('|_\('data\.|\{\{/.test(body)) {
      return convertPills(`=${body}`, asToName, resolveLoopItem, options);
    }
  }

  let out = input;
  // Formula Ruby (=now + 24.hours): sem equivalente em template AP. Marca de
  // forma visivel no editor em vez de emitir texto que parece literal valido.
  // `.upcase` / `[].include?` conhecidos deixam de contar — viram formula AP.
  const graphqlFormula = isGraphqlFormula(input);
  const rubyExpression = isRubyExpression(input);

  const listIndex = replaceListIndexAccess(out, asToName, resolveLoopItem, options);
  out = listIndex.out;

  // `.gsub('"', "")` cola na pill, dentro do `#{ }`. Troca as aspas antes do
  // replace genérico, que só casa quando `}` vem logo depois da pill.
  out = out.replace(
    /#\{_dp\('([^']*)'\)\.gsub\(\s*'"'\s*,\s*""\s*\)\}/g,
    (_match, json: string) => {
      const pill = renderDataPill(json, asToName, resolveLoopItem, options);
      if (!pill || pill === CATCH_TYPE_TOKEN) return pill;
      return wrapApFormula(`replace(${pill}; "\\""; "")`);
    },
  );

  // 1) structured pill. Inspect the call terminator outside JSON strings;
  // a quote in a field key must neither truncate JSON nor retain #{...}.
  let replaced = '';
  let cursor = 0;
  const calls = /_dp\('/g;
  let callStart: RegExpExecArray | null;
  while ((callStart = calls.exec(out))) {
    const call = structuredPillAt(out, callStart.index);
    if (!call) return '{{TODO_pill}}';
    const wrapped = out.slice(callStart.index - 2, callStart.index) === '#{' && out[call.end] === '}';
    const start = wrapped ? callStart.index - 2 : callStart.index;
    const end = call.end + (wrapped ? 1 : 0);
    replaced += out.slice(cursor, start) + renderDataPill(call.json, asToName, resolveLoopItem, options);
    cursor = end;
    calls.lastIndex = end;
  }
  out = replaced + out.slice(cursor);

  // 2) pill achatada Workato: #{_('data...')} ou `_(...)` com metadados extras.
  out = out.replace(
    new RegExp(`#\\{${FLAT_DATA_PILL_RE.source}\\}`, 'g'),
    (_m, _q: string, ref: string) => renderFlatDataRef(ref, asToName, options),
  );
  out = out.replace(FLAT_DATA_PILL_RE, (_m, _q: string, ref: string) =>
    renderFlatDataRef(ref, asToName, options),
  );

  // 3) #{...} que sobrou sem pill. Interpolação com {{pill}} ou método fica
  // para o compilador Ruby; `}` de dentro do pill não fecha a interpolação.
  if (!rubyExpression && !graphqlFormula) out = replaceBareInterpolation(out);

  // 4) prefixo '=' de formula, antes de absorver [0]['campo'] na pill.
  // Os atalhos (split/present/where) ainda precisam ver o indice fora da pill.
  if (out.startsWith('=')) out = out.slice(1);

  const known = convertKnownRubyAfterPills(out);
  if (known) return tidyJobContext(known);

  out = out.replace(/(\{\{[^{}]+\}\})((?:\[(?:\d+|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\])+)/g, (match, rendered, brackets) => {
    const segments = parsePillAccess(brackets);
    return segments ? appendPillPath(rendered, segments) : '{{TODO_pill}}';
  });

  const folded = convertKnownRubyAfterPills(out);
  if (folded) return tidyJobContext(folded);

  if (graphqlFormula) {
    // Harvest owns whole Ruby expressions, never marker-shaped substrings of
    // an arbitrary document. Retain the source String when this conversion
    // creates a residual, so CODE can render its interpolation as one value.
    let residual = false;
    const body = unquoteRubyString(out, (expression) => {
      const converted = convertGraphqlInterpolation(expression);
      if (converted.startsWith('TODO_FORMULA(')) residual = true;
      return converted;
    });
    if (body === null || residual) return tidyJobContext(`TODO_FORMULA(${out.trim()})`);
    return tidyJobContext(body);
  }

  const cleaned = out.trim();
  if (listIndex.replaced && /^\{\{[^{}]+\}\}$/.test(cleaned)) return tidyJobContext(cleaned);

  // O `.gsub('"', "")` já virou `replace`. O texto entre aspas não é mais Ruby.
  if (rubyExpression && detectRubyMethods(cleaned).length === 0) {
    const slots: string[] = [];
    const masked = cleaned.replace(/ap-formula-v1::\{[\s\S]*?\}::ap-formula-v1/g, (formula) => {
      slots.push(formula);
      return `\u0000f${slots.length - 1}\u0000`;
    });
    const unquoted = parseRubyStringLiteral(masked);
    if (unquoted != null) {
      const restored = unquoted.replace(/\u0000f(\d+)\u0000/g, (_match, index) => slots[Number(index)]!);
      return tidyJobContext(restored);
    }
  }

  // Formula que so restou metodo Ruby depois de dropar a pill de um passo skip.
  if (options?.omitDangling && rubyExpression && !/\{\{/.test(cleaned)) return '';

  if (rubyExpression && detectRubyMethods(cleaned).length === 0 && isPillIndexChain(cleaned)) {
    return tidyJobContext(cleaned);
  }

  return tidyJobContext(rubyExpression ? `TODO_FORMULA(${cleaned})` : out);
}

function bracketEnd(src: string, open: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i]!;
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Only static accesses can be folded into an AP template; dynamic indices need CODE. */
function isPillIndexChain(src: string): boolean {
  let i = 0;
  const s = src.trim();
  if (!s.startsWith('{{')) return false;
  while (i < s.length) {
    if (s.startsWith('{{', i)) {
      const end = s.indexOf('}}', i + 2);
      if (end < 0) return false;
      i = end + 2;
      continue;
    }
    if (s[i] !== '[') return false;
    const close = bracketEnd(s, i);
    if (close < 0) return false;
    if (!parsePillAccess(s.slice(i, close + 1))) return false;
    i = close + 1;
  }
  return true;
}

function unquoteRubyString(src: string, interpolate?: (expression: string) => string): string | null {
  const s = src.trim();
  const quote = s[0];
  if (quote !== '"' && quote !== "'") return /^(mutation|query)\b/i.test(s) ? s : null;
  let i = 1;
  let out = '';
  while (i < s.length) {
    if (s[i] === '\\') {
      const decoded = decodeRubyStringEscape(s, i, quote);
      if (decoded === null) return null;
      out += decoded.value;
      i = decoded.end;
      continue;
    }
    if (s[i] === '\r' && s[i + 1] === '\n') {
      out += '\n';
      i += 2;
      continue;
    }
    if (quote === '"' && s.startsWith('#{', i)) {
      const end = rubyInterpolationEnd(s, i + 2);
      if (end < 0) return null;
      out += interpolate ? interpolate(s.slice(i + 2, end).trim()) : s.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (s[i] === quote) {
      if (s.slice(i + 1).trim() !== '') return null;
      return out;
    }
    out += s[i];
    i++;
  }
  return null;
}

function convertGraphqlInterpolation(expr: string): string {
  const known = convertKnownRubyAfterPills(expr);
  if (known) return known;
  if (/^\{\{[^{}]+\}\}(?:\[\{\{[^{}]+\}\}\])*$/.test(expr)) return expr;
  return `TODO_FORMULA(${expr})`;
}
