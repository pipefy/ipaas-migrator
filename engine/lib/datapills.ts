// Conversao de data pills / formulas Workato -> templates Activepieces.
import type { FormulaHit } from './types.ts';

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

/**
 * Formula que e so um indice literal: `_dp(...)[0]`, `#{_dp(...)}[1]['campo']`.
 * O `[n]` entra na datapill. Nao e Ruby e nao vira step Code.
 * `}` opcional entre o pill e o indice cobre `#{_dp('...')}[0]`.
 */
const INDEX_PILL =
  /^=?\s*(?:#\{)?_dp\('([^']*)'\)\}?((?:\[\d+\])+)((?:\[['"][^'"]*['"]\])*)\}?\s*$/;

/**
 * Formula Workato (`=...`) que nao e apenas uma data pill. Ex.: `=now + 24.hours`.
 * Nao ha equivalente direto em template AP, entao vira revisao humana.
 */
export function isRubyExpression(s: string): boolean {
  if (typeof s !== 'string' || !s.startsWith('=')) return false;
  if (EMPTY_FORMULA.test(s) || LITERAL_FORMULA.test(s)) return false;
  if (isGraphqlFormula(s)) return false;
  const body = s.slice(1).trim();
  if (SIMPLE_PILL.test(body)) return false;
  if (INDEX_PILL.test(s.trim())) return false;
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
  let cur = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let started = false;
  for (const ch of src) {
    if (quote) {
      if (escaped) {
        cur += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
        values.push(cur);
        cur = '';
        started = true;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ',') {
      if (!started) return null;
      started = false;
      continue;
    }
    if (/\s/.test(ch)) continue;
    return null;
  }
  if (quote || escaped) return null;
  if (!started && values.length === 0) return null;
  if (!started) return null;
  return values;
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
  const needleRaw = needle.startsWith('=') || needle.startsWith('#{') ? needle : `=${needle}`;
  if (isRubyExpression(needleRaw) && !peelTrailingCaseMethod(needleRaw)) return null;
  return { values, needleRaw, caseFold };
}

function wrapApFormula(expr: string): string {
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

/** Depois das pills virarem `{{...}}`, fecha `.upcase` / `[].include?` conhecidos. */
function convertKnownRubyAfterPills(out: string): string | null {
  let s = out.trim();
  if (s.startsWith('=')) s = s.slice(1).trim();
  // Limiar numérico que sobrou de uma comparação. Não é fórmula.
  if (/^-?\d+$/.test(s)) return s;

  const include = s.match(/^\[(.*)\]\.include\?\((.+)\)$/s);
  if (include) {
    const values = parseRubyStringList(include[1]!);
    if (!values) return null;
    let needle = include[2]!.trim();
    const peeled = peelTrailingCaseMethod(needle);
    if (peeled) {
      needle = `${apCaseFn(peeled.method)}(${peeled.inner})`;
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

  // `{{pill}}-90` e `{{pill}}.to_date-90`: data menos N dias, sem `.days`.
  const dateMinus = s.match(/^(\{\{[^{}]+\}\})(?:\.to_date)?\s*-\s*(\d+)$/);
  if (dateMinus) {
    const date = dateMinus[0].includes('.to_date') ? `to_date(${dateMinus[1]})` : dateMinus[1]!;
    return `add_days(${date}; -${dateMinus[2]})`;
  }

  if (s === 'now.to_date') return 'today()';
  if (s === 'now') return 'now()';

  const daysAgo = s.match(/^(\d+)\.days\.ago$/);
  if (daysAgo) return `subtract_days(today(); ${daysAgo[1]})`;

  const nowFmt = s.match(/^now\.strftime\((['"])([^'"\\]+)\1\)$/);
  if (nowFmt) {
    const tokens = strftimeToApTokens(nowFmt[2]!);
    if (tokens) return `format_date(now(); ${tokens})`;
  }

  const nowShift = s.match(/^\(now\s*-\s*(\d+)\.days\)\.strftime\((['"])([^'"\\]+)\2\)$/);
  if (nowShift) {
    const tokens = strftimeToApTokens(nowShift[3]!);
    if (tokens) return `format_date(subtract_days(today(); ${nowShift[1]}); ${tokens})`;
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

  // `{{pill}}.include?("a") || {{pill}}.include?("b")`
  const includes = parseIncludeChain(s);
  if (includes) return includes;

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

  // `{{a}}.present? ? {{a}}[0].split("/").last(1)[0].to_s : {{b}}.present? ? … : ""`
  const present = parsePresentTernary(s);
  if (present) return present;
  return null;
}

/**
 * `present?` do Workato e `is_not_empty` do catalogo. O then desta receita e
 * o ultimo segmento do primeiro item (`[0].split(sep).last(1)[0].to_s`).
 */
function parsePresentTernary(s: string): string | null {
  const trimmed = s.trim();
  if (/^(['"])\1$/.test(trimmed)) return '""';

  const presentOnly = trimmed.match(new RegExp(`^(${PILL})\\.present\\?$`));
  if (presentOnly) return `is_not_empty(${presentOnly[1]})`;

  const m = trimmed.match(
    new RegExp(
      `^(${PILL})\\.present\\?\\s*\\?\\s*\\1\\[0\\]\\.split\\((['"])([^'"\\\\]+)\\2\\)\\.last\\(1\\)\\[0\\](?:\\.to_s)?\\s*:\\s*([\\s\\S]+)$`,
    ),
  );
  if (!m) return null;
  const pill = m[1]!;
  const sep = m[3]!;
  if (!isSafeFormulaArg(sep)) return null;
  const els = parsePresentTernary(m[4]!.trim());
  if (els == null) return null;
  return `if(is_not_empty(${pill}); last_item(split(first_item(${pill}); "${sep}")); ${els})`;
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
    ".pluck('value').compact.first": first,
    ".pluck('value').compact.first.to_s": first,
    ".pluck('value').first": first,
    ".pluck('value').compact.join": `join_list(${plucked}; "")`,
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

function yearsToMonthsAmount(amount: string): string {
  if (/^-?\d+$/.test(amount)) return String(Number(amount) * 12);
  return amount;
}

/**
 * `.days` → `add_days`. `.months` / `.year` usam o clamp do Ruby: o catalogo
 * nao tem add_months; as partes vêm de `format_date`/`to_date` e o helper
 * `addRubyCalendarMonths` limita o dia ao ultimo do mes destino.
 */
export function rubyCalendarShiftExpr(date: string, signedAmount: string, unit: DateUnit): string {
  if (unit === 'days') return `add_days(${date}; ${signedAmount})`;
  const months = unit === 'years' ? yearsToMonthsAmount(signedAmount) : signedAmount;
  return rubyAddMonthsCatalogExpr(date, months);
}

function rubyAddMonthsCatalogExpr(date: string, months: string): string {
  const m = `add(to_number(format_date(${date}; MM)); ${months})`;
  const d = `format_date(${date}; DD)`;
  const iso = `replace(replace(replace("Y-M-D"; "Y"; format_date(${date}; YYYY)); "M"; ${m}); "D"; ${d})`;
  return `to_date(${iso})`;
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

/** `.gsub(a, b).gsub(c, d)` sobre uma pill -> replace/remove aninhados. */
function parseGsubChain(s: string): string | null {
  const head = s.match(/^(\{\{[^{}]+\}\})((?:\.gsub\("[^"\\]*",\s*"[^"\\]*"\))+)$/);
  if (!head) return null;
  let expr = head[1]!;
  for (const call of head[2]!.matchAll(/\.gsub\("([^"\\]*)",\s*"([^"\\]*)"\)/g)) {
    const find = call[1]!;
    const to = call[2]!;
    if (!isSafeFormulaArg(find)) return null;
    if (to.length && !isSafeFormulaArg(to)) return null;
    expr = to.length ? `replace(${expr}; "${find}"; "${to}")` : `remove(${expr}; "${find}")`;
  }
  return expr;
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

/** `.include?("a")` (opcionalmente com `||`) -> contains / or(contains; ...). */
function parseIncludeChain(s: string): string | null {
  const parts = s.split('||').map((part) => part.trim());
  const terms: string[] = [];
  for (const part of parts) {
    const m = part.match(/^(\{\{[^{}]+\}\})\.include\?\("([^"\\]+)"\)$/);
    if (!m || !isSafeFormulaArg(m[2]!)) return null;
    terms.push(`contains(${m[1]}; "${m[2]}")`);
  }
  if (!terms.length) return null;
  if (terms.length === 1) return terms[0]!;
  return terms.slice(1).reduce((acc, term) => `or(${acc}; ${term})`, terms[0]!);
}

/** metodos Ruby detectados na string (indicam necessidade de step CODE). */
export function detectRubyMethods(s: string): string[] {
  const found = new Set<string>();
  for (const m of RUBY_METHODS) {
    const re = new RegExp('\\.' + m.replace('?', '\\?') + '\\b|\\.' + m.replace('?', '') + '\\(');
    if (re.test(s)) found.add(m);
  }
  if (/\?[^:]*:/.test(s)) found.add('ternary'); // a ? b : c
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
export type JobContextHits = { name: number; id: number; link: number; created: number };

export type PillOptions = {
  recipeName?: string;
  recipeId?: string;
  jobContextHits?: JobContextHits;
  /** `as` de passos `skip: true`. A pill nao aponta para step que nao executa. */
  skippedAs?: Set<string>;
  /**
   * Consumidor tambem desligado: hash solto (passo apagado) nao vira TODO_ref —
   * o step pulado nao precisa da referencia para revisar.
   */
  omitDangling?: boolean;
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

function tidyCatch(text: string): string {
  if (!text.includes(CATCH_TYPE_TOKEN) && !text.includes(CATCH_ERROR_TOKEN)) return text;
  return text
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
    return options?.recipeName ?? '';
  }
  if (key === 'recipe_id') {
    if (hits) hits.id += 1;
    return options?.recipeId ?? '';
  }
  if (key === 'recipe_url' || key === 'job_url') {
    if (hits) hits.link += 1;
    return FLOW_LINK;
  }
  if (key === 'job_created_at') {
    if (hits) hits.created += 1;
    return "{{job_now['now']}}";
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

/** O Storage guarda a lista crua. A pill Workato ainda diz `list_items`. */
export function withoutStripHead(binding: StepBinding | undefined, segments: string[]): string[] {
  const head = !binding || typeof binding === 'string' ? undefined : binding.stripHead;
  if (head && segments[0] === head) return segments.slice(1);
  return segments;
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
  return key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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

/** `lowercase` / `uppercase` no catalogo AP, depois que as pills ja viraram `{{...}}`. */
export function wrapApCase(value: string, method: 'upcase' | 'downcase'): string {
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
  const path: any[] = Array.isArray(dp.path) ? dp.path : [];
  if (dp.pill_type === 'job_context') {
    const key = path.find((element) => typeof element === 'string') as string | undefined;
    const job = renderJobContext(key, options);
    if (job !== null) return job;
    // Sem `line`. Usar o mapa emitia `{{undefined['…']}}`.
    return '';
  }
  const line = dp.line ?? dp.provider;
  const mapped = asToName.get(line);
  const mappedName = stepBindingName(mapped);

  // O catch do Workato nao vira passo. A mensagem aponta para o step que falhou,
  // em ['error']['message'] (irmao de output). O `type` nao existe no iPaaS.
  if (dp.provider === 'catch' && path.every((element) => typeof element !== 'object')) {
    const key = path.filter((element) => typeof element === 'string').join('.');
    if (key === 'message' || key === '') return CATCH_ERROR_TOKEN;
    if (key === 'type') return CATCH_TYPE_TOKEN;
  }

  // Passo `skip: true` nao executa e pode nem entrar no flow. Emitir
  // `{{step_N}}` ou `TODO_ref_<hash>` aponta para um step que nao existe.
  if (options?.skippedAs?.has(String(line))) return '';

  // `line` e o `as` do passo de origem. Sem entrada no mapa, a pill aponta para
  // um passo que nao existe na receita — acontece quando o passo e apagado e a
  // referencia fica para tras. Repassar o hash cru gerava template que o AP
  // resolve como vazio em silencio; marcar invalida o step para revisao.
  // Consumidor desligado: o hash solto e resto de um passo pulado/apagado.
  if (!mappedName && /^[0-9a-f]{6,}$/i.test(String(line))) {
    if (options?.omitDangling) return '';
    return `{{TODO_ref_${line}}}`;
  }

  let base = mappedName ?? line;
  if (
    mappedName &&
    path.length === 1 &&
    path[0] === 'cards_count'
  ) {
    const counted = cardsCountFormula(mapped, mappedName);
    if (counted) return counted;
  }
  const pathHead = path.find((element) => typeof element === 'string') as string | undefined;
  let segments: string[] = outputRootSegments(mapped, pathHead);
  const render = () => renderApTemplate(base, segments);

  for (const element of path) {
    if (!element || typeof element !== 'object') {
      segments.push(String(element));
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
        continue;
      }
      // Sem foreach no escopo. O Workato usa o primeiro item da lista
      // (docs "Lists"); listas sao indexadas em 0.
      if (segments.length) segments[segments.length - 1] += '[0]';
      else base = `${base}[0]`;
      continue;
    }
    return '{{TODO_pill}}';
  }
  return renderApTemplate(base, withoutStripHead(mapped, segments));
}

function extraHashPath(brackets: string): string {
  return [...brackets.matchAll(/\[['"](\w+)['"]\]/g)].map((m) => m[1]).join('.');
}

function appendPillPath(pill: string, extra: string): string {
  if (!pill) return '';
  if (!extra) return pill;
  const access = extra.split('.').filter(Boolean).map(formatApSegment).join('');
  if (!/^\{\{[^}]+\}\}$/.test(pill)) return `${pill}${access}`;
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

/** `_dp(...)[0]` / `#{_dp(...)}[0]['campo']` → indice dentro da datapill. */
function convertIndexPathFormula(
  input: string,
  asToName: StepNameMap,
  resolveLoopItem?: LoopItemResolver,
  options?: PillOptions,
): string | null {
  const m = input.trim().match(INDEX_PILL);
  if (!m) return null;
  const rendered = renderDataPill(m[1]!, asToName, resolveLoopItem, options);
  if (!rendered) return '';
  if (!/^\{\{[^{}]+\}\}$/.test(rendered) || rendered.includes('TODO_')) return null;
  const keys = [...(m[3] ?? '').matchAll(/\[['"]([^'"]*)['"]\]/g)].map((hit) =>
    formatApSegment(hit[1]!),
  );
  return `{{${rendered.slice(2, -2)}${m[2]}${keys.join('')}}}`;
}

/** `_dp(...)['a']['b']` → `{{step.a.b}}`. */
function convertHashPathFormula(
  input: string,
  asToName: StepNameMap,
  resolveLoopItem?: LoopItemResolver,
  options?: PillOptions,
): string | null {
  const m = input.trim().match(
    /^=?(?:#\{)?_dp\('(.+?)'\)\}?((?:\[['"]\w+['"]\])+)$/,
  );
  if (!m) return null;
  return appendPillPath(renderDataPill(m[1], asToName, resolveLoopItem, options), extraHashPath(m[2]));
}

/** `_dp(...).where(field:"val")[0]['key']` → filter_list + first_item + pluck. */
function convertWhereListFormula(
  input: string,
  asToName: StepNameMap,
  resolveLoopItem?: LoopItemResolver,
  options?: PillOptions,
): string | null {
  const m = input.trim().match(
    /^=?(?:#\{)?_dp\('(.+?)'\)\}?\.where\((\w+)\s*:\s*"((?:[^"\\]|\\.)*)"\)\[0\]\['(\w+)'\]$/,
  );
  if (!m) return null;
  const listRef = renderDataPill(m[1], asToName, resolveLoopItem, options);
  if (!listRef) return '';
  const field = m[2];
  const value = m[3].replace(/\\"/g, '"').replace(/"/g, '\\"');
  const key = m[4];
  return `ap-formula-v1::{first_item(pluck(filter_list(${listRef};"${field}";"${value}");"${key}"))}::ap-formula-v1`;
}

/**
 * `data.<provider>.<as>.<path>` (forma do `_('...')`) -> template AP.
 *
 * `foreach` expoe `index` como metadado do proprio loop, nao do item: o `as`
 * resolve para `loop_N.item`, mas o indice mora em `loop_N.index`.
 */
function renderDataRef(ref: string, asToName: StepNameMap, options?: PillOptions): string {
  const parts = String(ref).split('.');
  const as = parts[1];
  const path = parts.slice(2).join('.');
  if (as && options?.skippedAs?.has(as)) return '';
  if (as && !asToName.has(as) && /^[0-9a-f]{6,}$/i.test(as) && options?.omitDangling) return '';
  const binding = as ? asToName.get(as) : undefined;
  const mapped = stepBindingName(binding) || parts.slice(0, 2).join('_');
  if (parts[0] === 'foreach' && /^index\b/.test(path)) {
    const loop = mapped.replace(/\.item$/, '');
    return `{{${loop}.${path}}}`;
  }
  if (path === 'cards_count') {
    const counted = cardsCountFormula(binding, mapped);
    if (counted) return counted;
  }
  const pathHead = path.split('.')[0];
  const segs = withoutStripHead(binding, [
    ...outputRootSegments(binding, pathHead),
    ...path.split('.').filter(Boolean),
  ]);
  return renderApTemplate(mapped, segs);
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
  if (literal) return literal[2]!;
  const whereList = convertWhereListFormula(input, asToName, resolveLoopItem, options);
  if (whereList) return tidyJobContext(whereList);
  const hashPath = convertHashPathFormula(input, asToName, resolveLoopItem, options);
  if (hashPath) return tidyJobContext(hashPath);
  const indexPath = convertIndexPathFormula(input, asToName, resolveLoopItem, options);
  if (indexPath) return tidyJobContext(indexPath);

  let out = input;
  // Formula Ruby (=now + 24.hours): sem equivalente em template AP. Marca de
  // forma visivel no editor em vez de emitir texto que parece literal valido.
  // `.upcase` / `[].include?` conhecidos deixam de contar — viram formula AP.
  const graphqlFormula = isGraphqlFormula(input);
  const rubyExpression = isRubyExpression(input);

  const listIndex = replaceListIndexAccess(out, asToName, resolveLoopItem, options);
  out = listIndex.out;

  // 1) pill estruturada: #{_dp('{...json...}')} ou _dp('{...}') sem interpolacao
  out = out.replace(/#\{_dp\('(.+?)'\)\}|_dp\('(.+?)'\)/g, (_m, a, b) => {
    return renderDataPill(a ?? b, asToName, resolveLoopItem, options);
  });

  // 2) pill interpolada: #{_('data.<provider>.<as>.<path>')}
  out = out.replace(/#\{_\('data\.([^']+)'\)\}/g, (_m, ref) => renderDataRef(ref, asToName, options));

  // 2b) mesma pill SEM interpolacao, dentro de formula: `_('data...')` e
  // `_('data...', 'foreach_meta')`. Sem isso a referencia Workato vazava crua
  // para o template (e para o JS do step CODE), onde nao resolve nada.
  out = out.replace(/_\('data\.([^']+)'(?:\s*,\s*'[^']*')?\)/g, (_m, ref) =>
    renderDataRef(ref, asToName, options),
  );

  // 3) #{...} que sobrou sem pill. Interpolação com {{pill}} ou método fica
  // para o compilador Ruby; `}` de dentro do pill não fecha a interpolação.
  out = replaceBareInterpolation(out);

  // 4) {{step}}['a']['b'] residual (formula mista) -> {{step.a.b}}
  out = out.replace(/\{\{([^{}]+)\}\}((?:\[['"]\w+['"]\])+)/g, (_m, inner, brackets) => {
    return `{{${inner}.${extraHashPath(brackets)}}}`;
  });

  // 5) prefixo '=' de formula
  if (out.startsWith('=')) out = out.slice(1);

  if (graphqlFormula) {
    const body = unquoteRubyString(out) ?? out;
    return tidyJobContext(convertGraphqlInterpolations(body));
  }

  const known = convertKnownRubyAfterPills(out);
  if (known) return tidyJobContext(known);

  const cleaned = out.trim();
  if (listIndex.replaced && /^\{\{[^{}]+\}\}$/.test(cleaned)) return tidyJobContext(cleaned);

  // Formula que so restou metodo Ruby depois de dropar a pill de um passo skip.
  if (options?.omitDangling && rubyExpression && !/\{\{/.test(cleaned)) return '';

  return tidyJobContext(rubyExpression ? `TODO_FORMULA(${cleaned})` : out);
}

function unquoteRubyString(src: string): string | null {
  const s = src.trim();
  const quote = s[0];
  if (quote !== '"' && quote !== "'") return /^(mutation|query)\b/i.test(s) ? s : null;
  let i = 1;
  let out = '';
  while (i < s.length) {
    if (s[i] === '\\') {
      const next = s[i + 1] ?? '';
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i += 2;
      continue;
    }
    if (quote === '"' && s.startsWith('#{', i)) {
      const end = rubyInterpolationEnd(s, i + 2);
      if (end < 0) return null;
      out += s.slice(i, end + 1);
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

function convertGraphqlInterpolations(doc: string): string {
  let out = '';
  let i = 0;
  while (i < doc.length) {
    if (!doc.startsWith('#{', i)) {
      out += doc[i];
      i++;
      continue;
    }
    const end = rubyInterpolationEnd(doc, i + 2);
    if (end < 0) {
      out += doc[i];
      i++;
      continue;
    }
    const expr = doc.slice(i + 2, end).trim();
    const known = convertKnownRubyAfterPills(expr);
    if (known) out += known;
    else if (/^\{\{[^{}]+\}\}(?:\[\{\{[^{}]+\}\}\])*$/.test(expr)) out += expr;
    else out += `TODO_FORMULA(${expr})`;
    i = end + 1;
  }
  return out;
}
