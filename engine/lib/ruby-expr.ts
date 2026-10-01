// Compila o recorte de Ruby que sobra das formulas Workato para JavaScript,
// para virar step CODE no Activepieces.
//
// NAO e um interpretador de Ruby: a gramatica cobre cadeia de metodos, ternario,
// `||`, `+`/`<<`, `*` numerico e literais. Token fora do recorte aborta (`null`)
// e o campo volta a ser marcado para revisao humana — melhor que gerar valor errado.

/** Aviso da nota quando `*` vira multiplicacao. Ruby tambem repete string e lista. */
export const MULTIPLY_NOTE =
  "'*' tratado como multiplicacao numerica: Number(esquerda) * Number(direita). No Ruby, string * n repete o texto e nil * n quebra o job. Texto nao numerico vira NaN; vazio ou nil vira 0.";

/** Aviso da nota quando to_currency vira format_currency + replace do ponto decimal. */
export const CURRENCY_NOTE =
  "to_currency virou replace(format_currency(valor; unidade); \".\"; separador). O milhar continua virgula. delimiter diferente de virgula nao entra nesse mapa.";

export const PHONE_NOTE =
  'Telefone com 12 dígitos ganha um 9 depois dos 4 primeiros, num step CODE. Os outros comprimentos saem iguais.';

/** Helpers do runtime Ruby-like, injetados no step CODE conforme o uso. */
const HELPERS: Record<string, string> = {
  inspect: `const inspect = (v) => {
  if (v === null || v === undefined) return 'nil';
  if (Array.isArray(v)) return '[' + v.map(inspect).join(', ') + ']';
  if (typeof v === 'object') {
    return '{' + Object.entries(v).map(([k, x]) => '"' + k + '"=>' + inspect(x)).join(', ') + '}';
  }
  if (typeof v === 'string') return '"' + v + '"';
  return String(v);
};`,
  // Array#to_s do Ruby e o inspect (`["a", "b"]`). As receitas contam com isso:
  // logo depois vem gsub tirando colchetes e aspas.
  toS: `const toS = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return inspect(v);
  return String(v);
};`,
  toI: `const toI = (v) => parseInt(String(v ?? '').trim(), 10) || 0;`,
  toF: `const toF = (v) => parseFloat(String(v ?? '').trim()) || 0;`,
  list: `const list = (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);`,
  pluck: `const pluck = (v, keys) =>
  list(v).map((item) => (keys.length === 1 ? item?.[keys[0]] : keys.map((k) => item?.[k])));`,
  where: `const where = (v, field, op, expected) =>
  list(v).filter((item) => {
    const actual = item?.[field];
    if (expected instanceof RegExp) return expected.test(String(actual ?? ''));
    if (op === '>=') return Number(actual) >= Number(expected);
    if (op === '>') return Number(actual) > Number(expected);
    if (op === '<=') return Number(actual) <= Number(expected);
    if (op === '<') return Number(actual) < Number(expected);
    if (Array.isArray(expected)) return expected.map(String).includes(String(actual));
    return String(actual ?? '') === String(expected ?? '');
  });`,
  gsub: `const gsub = (v, find, to) => {
  const text = v === null || v === undefined ? '' : String(v);
  if (find instanceof RegExp) return text.replace(new RegExp(find.source, 'g' + find.flags.replace('g', '')), to);
  return text.split(String(find)).join(String(to));
};`,
  // Workato/Ruby `blank?`: nil, string vazia ou so espacos, lista/hash vazios.
  blank: `const blank = (v) => {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
};`,
  presence: `const presence = (v) => (blank(v) ? undefined : v);`,
  // smart_join do Workato descarta itens vazios antes de juntar.
  smartJoin: `const smartJoin = (v, sep) => list(v).filter((x) => !blank(x)).map(String).join(sep);`,
  includes: `const includes = (v, needle) =>
  Array.isArray(v) ? v.map(String).includes(String(needle)) : String(v ?? '').includes(String(needle));`,
  matches: `const matches = (v, re) => re.test(toS(v));`,
  at: `const at = (v, i) => (Array.isArray(v) ? v[i] : v?.[i]);`,
  dig: `const dig = (v, k) => v?.[k];`,
  // `.quote` do Workato dobra a aspa simples (escape de SQL).
  quote: `const quote = (v) => String(v ?? '').split("'").join("''");`,
  b64: `const b64 = (v) => {
  const bytes = unescape(encodeURIComponent(String(v ?? '')));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes.charCodeAt(i);
    const b = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : 0;
    const c = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : 0;
    const n = (a << 16) | (b << 8) | c;
    out += alphabet[(n >>> 18) & 63] + alphabet[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : '=';
    out += i + 2 < bytes.length ? alphabet[n & 63] : '=';
  }
  return out;
};`,
  strftime: `const strftime = (v, fmt) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return fmt
    .replace(/%Y/g, p(d.getFullYear(), 4))
    .replace(/%m/g, p(d.getMonth() + 1))
    .replace(/%d/g, p(d.getDate()))
    .replace(/%H/g, p(d.getHours()))
    .replace(/%M/g, p(d.getMinutes()))
    .replace(/%S/g, p(d.getSeconds()));
};`,
  toDate: `const toDate = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
};`,
  scan: `const scan = (v, re) => {
  const text = toS(v);
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const r = new RegExp(re.source, flags);
  return [...text.matchAll(r)].map((m) => (m.length > 1 ? m.slice(1) : m[0]));
};`,
  strip: `const strip = (v) => String(v ?? '').trim();`,
  split: `const split = (v, sep) => String(v ?? '').split(sep);`,
  join: `const join = (v, sep) => list(v).map((x) => (x === null || x === undefined ? '' : String(x))).join(sep);`,
  upcase: `const upcase = (v) => String(v ?? '').toUpperCase();`,
  downcase: `const downcase = (v) => String(v ?? '').toLowerCase();`,
  flatten: `const flatten = (v) => list(v).flat(Infinity);`,
  len: `const len = (v) => (Array.isArray(v) || typeof v === 'string' ? v.length : blank(v) ? 0 : Object.keys(v).length);`,
  add: `const add = (left, right) => (typeof left === 'number' ? left + Number(right) : String(left ?? '') + String(right ?? ''));`,
  addCal: `const addCal = (v, n, unit) => {
  const raw = String(v ?? '');
  const iso = raw.match(/^(\\d{4})-(\\d{2})-(\\d{2})(?:[T\\s](\\d{2}):(\\d{2}):(\\d{2}))?/);
  let y;
  let m;
  let day;
  let hh = 0;
  let mm = 0;
  let ss = 0;
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    day = Number(iso[3]);
    hh = Number(iso[4] ?? 0);
    mm = Number(iso[5] ?? 0);
    ss = Number(iso[6] ?? 0);
  } else {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return '';
    y = d.getFullYear();
    m = d.getMonth() + 1;
    day = d.getDate();
    hh = d.getHours();
    mm = d.getMinutes();
    ss = d.getSeconds();
  }
  const p = (x) => String(x).padStart(2, '0');
  const amount = Number(n);
  if (unit === 'days') {
    const d = new Date(y, m - 1, day + amount, hh, mm, ss);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  const months = unit === 'years' ? amount * 12 : amount;
  const zero = y * 12 + (m - 1) + months;
  y = Math.floor(zero / 12);
  m = zero - y * 12 + 1;
  const last = new Date(y, m, 0).getDate();
  day = Math.min(day, last);
  return y + '-' + p(m) + '-' + p(day) + 'T' + p(hh) + ':' + p(mm) + ':' + p(ss);
};`,
  mul: `const mul = (left, right) => Number(left) * Number(right);`,
  toCurrency: `const toCurrency = (value, unit, precision, separator) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const prec = Number.isFinite(Number(precision)) ? Math.max(0, Number(precision)) : 2;
  const neg = num < 0;
  const fixed = Math.abs(num).toFixed(prec);
  const dot = fixed.indexOf('.');
  const intRaw = dot < 0 ? fixed : fixed.slice(0, dot);
  const frac = dot < 0 ? '' : fixed.slice(dot + 1);
  const int = intRaw.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  const body = prec > 0 ? int + '.' + frac : int;
  const decimal = separator == null || separator === '' ? '.' : String(separator);
  const shown = decimal === '.' ? body : body.split('.').join(decimal);
  return (neg ? '-' : '') + String(unit == null ? '$' : unit) + shown;
};`,
  append: `const append = (left, right) => String(left ?? '') + String(right ?? '');`,
};

/** Dependencias entre helpers: puxar um traz o que ele usa. */
const HELPER_DEPS: Record<string, string[]> = {
  toS: ['inspect'],
  pluck: ['list'],
  where: ['list'],
  presence: ['blank'],
  smartJoin: ['list', 'blank'],
  matches: ['toS', 'inspect'],
  scan: ['toS', 'inspect'],
  join: ['list'],
  flatten: ['list'],
  len: ['blank'],
};

export interface CompiledExpr {
  /** expressao JS final, usando os nomes de `bindings` e helpers. */
  expr: string;
  /** nome do input do step CODE -> template AP (`{{step_1.x}}`). */
  bindings: Map<string, string>;
  /** helpers usados, ja com dependencias. */
  helpers: Set<string>;
  /** metodos traduzidos por aproximacao (viram nota de revisao). */
  approximations: string[];
}

/**
 * Namespace de inputs compartilhado entre varias expressoes do MESMO step CODE:
 * a mesma pill vira um input so, e os nomes nao colidem.
 */
export interface BindingRegistry {
  bindings: Map<string, string>;
  pillNames: Map<string, string>;
  seq: { n: number };
}

export function newBindingRegistry(): BindingRegistry {
  return { bindings: new Map(), pillNames: new Map(), seq: { n: 1 } };
}

type Token =
  | { kind: 'pill'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'regex'; source: string; flags: string }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: string };

const OPERATORS = ['&.', '||', '&&', '<<', '?', ':', '.', ',', '(', ')', '[', ']', '+', '-', '*'];

/** Aspas duplas do Ruby interpolam `#{...}`. Aspas simples não. */
function scanString(src: string, i: number): { tokens: Token[]; end: number } | null {
  const quote = src[i]!;
  let j = i + 1;
  let literal = '';
  const tokens: Token[] = [];
  const pushLiteral = () => {
    if (!literal) return;
    if (tokens.length) tokens.push({ kind: 'op', value: '+' });
    tokens.push({ kind: 'string', value: literal });
    literal = '';
  };
  while (j < src.length) {
    if (src[j] === '\\') {
      const next = src[j + 1] ?? '';
      literal += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      j += 2;
      continue;
    }
    if (quote === '"' && src.startsWith('#{', j)) {
      const end = interpolationEnd(src, j + 2);
      if (end < 0) return null;
      pushLiteral();
      const innerSrc = src.slice(j + 2, end).trim();
      if (innerSrc) {
        const inner = tokenize(innerSrc);
        if (!inner) return null;
        if (tokens.length) tokens.push({ kind: 'op', value: '+' });
        tokens.push(...inner);
      }
      literal = '';
      j = end + 1;
      continue;
    }
    if (src[j] === quote) {
      if (!tokens.length) tokens.push({ kind: 'string', value: literal });
      else pushLiteral();
      return { tokens, end: j + 1 };
    }
    literal += src[j];
    j++;
  }
  return null;
}

function interpolationEnd(src: string, j: number): number {
  let depth = 1;
  while (j < src.length) {
    const ch = src[j]!;
    if (ch === '"' || ch === "'") {
      const scanned = scanString(src, j);
      if (!scanned) return -1;
      j = scanned.end;
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

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const prevMeaningful = () => tokens[tokens.length - 1];

  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // pill ja convertida: {{...}}
    if (src.startsWith('{{', i)) {
      const end = src.indexOf('}}', i + 2);
      if (end < 0) return null;
      tokens.push({ kind: 'pill', value: src.slice(i, end + 2) });
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const scanned = scanString(src, i);
      if (!scanned) return null;
      tokens.push(...scanned.tokens);
      i = scanned.end;
      continue;
    }
    // regex literal: só onde um valor é esperado (senão `/` é divisão)
    if (ch === '/') {
      const prev = prevMeaningful();
      const valuePosition =
        !prev ||
        (prev.kind === 'op' && prev.value !== ')' && prev.value !== ']') ||
        (prev.kind === 'ident' && prev.value === 'match?');
      if (valuePosition) {
        let j = i + 1;
        let source = '';
        while (j < src.length && src[j] !== '/') {
          if (src[j] === '\\') {
            source += src[j]! + (src[j + 1] ?? '');
            j += 2;
            continue;
          }
          source += src[j];
          j++;
        }
        if (j >= src.length) return null;
        j++;
        let flags = '';
        while (j < src.length && /[imx]/.test(src[j]!)) {
          if (src[j] !== 'x') flags += src[j];
          j++;
        }
        tokens.push({ kind: 'regex', source, flags });
        i = j;
        continue;
      }
    }
    if (/[0-9]/.test(ch)) {
      const m = src.slice(i).match(/^\d+(?:\.\d+)?/)!;
      tokens.push({ kind: 'number', value: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*[?!]?/)!;
      tokens.push({ kind: 'ident', value: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPERATORS.find((candidate) => src.startsWith(candidate, i));
    if (!op) return null;
    // `**` nao e multiplicacao. Dois `*` seguidos abortam.
    if (op === '*' && src[i + 1] === '*') return null;
    tokens.push({ kind: 'op', value: op });
    i += op.length;
  }
  return tokens;
}

interface State {
  tokens: Token[];
  pos: number;
  bindings: Map<string, string>;
  pillNames: Map<string, string>;
  helpers: Set<string>;
  approximations: string[];
  seq: { n: number };
}

function useHelper(state: State, name: string): void {
  if (state.helpers.has(name)) return;
  state.helpers.add(name);
  for (const dep of HELPER_DEPS[name] ?? []) useHelper(state, dep);
}

function bindPill(state: State, pill: string): string {
  const existing = state.pillNames.get(pill);
  if (existing) return existing;
  const name = `v${state.seq.n++}`;
  state.pillNames.set(pill, name);
  state.bindings.set(name, pill);
  return name;
}

const peek = (s: State): Token | undefined => s.tokens[s.pos];

function eatOp(s: State, value: string): boolean {
  const token = peek(s);
  if (token?.kind === 'op' && token.value === value) {
    s.pos++;
    return true;
  }
  return false;
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

/** Recusa `%03` e qualquer diretiva fora de `%d %m %Y %y %H %M %S`. */
function strftimeFormatKnown(fmtJs: string): boolean {
  let format: string;
  try {
    format = JSON.parse(fmtJs);
  } catch {
    return false;
  }
  if (typeof format !== 'string') return false;
  for (let i = 0; i < format.length; i++) {
    if (format[i] !== '%') continue;
    const token = format.slice(i, i + 2);
    if (!['%d', '%m', '%Y', '%y', '%H', '%M', '%S'].includes(token)) return false;
    i++;
  }
  return true;
}

function calendarUnit(name: string): 'days' | 'months' | 'years' | null {
  if (name === 'day' || name === 'days') return 'days';
  if (name === 'month' || name === 'months') return 'months';
  if (name === 'year' || name === 'years') return 'years';
  return null;
}

function parseCalDuration(js: string): { unit: string; n: string } | null {
  const m = js.match(/^__cal\('(\w+)',\s*(.+)\)$/s);
  return m ? { unit: m[1]!, n: m[2]! } : null;
}

/** Metodos sem argumento. */
const NULLARY: Record<string, (target: string, s: State) => string> = {
  to_s: (t, s) => (useHelper(s, 'toS'), `toS(${t})`),
  to_i: (t, s) => (useHelper(s, 'toI'), `toI(${t})`),
  to_f: (t, s) => (useHelper(s, 'toF'), `toF(${t})`),
  strip: (t, s) => (useHelper(s, 'strip'), `strip(${t})`),
  upcase: (t, s) => (useHelper(s, 'upcase'), `upcase(${t})`),
  downcase: (t, s) => (useHelper(s, 'downcase'), `downcase(${t})`),
  flatten: (t, s) => (useHelper(s, 'flatten'), `flatten(${t})`),
  presence: (t, s) => (useHelper(s, 'presence'), `presence(${t})`),
  'present?': (t, s) => (useHelper(s, 'blank'), `!blank(${t})`),
  'blank?': (t, s) => (useHelper(s, 'blank'), `blank(${t})`),
  'empty?': (t, s) => (useHelper(s, 'blank'), `blank(${t})`),
  'nil?': (t) => `(${t} === null || ${t} === undefined)`,
  length: (t, s) => (useHelper(s, 'len'), `len(${t})`),
  size: (t, s) => (useHelper(s, 'len'), `len(${t})`),
  count: (t, s) => (useHelper(s, 'len'), `len(${t})`),
  first: (t, s) => (useHelper(s, 'at'), `at(${t}, 0)`),
  second: (t, s) => (useHelper(s, 'at'), `at(${t}, 1)`),
  last: (t, s) => (useHelper(s, 'list'), `list(${t}).slice(-1)[0]`),
  quote: (t, s) => {
    useHelper(s, 'quote');
    s.approximations.push('quote (escape de aspa simples do Workato)');
    return `quote(${t})`;
  },
  uniq: (t, s) => (useHelper(s, 'list'), `[...new Set(list(${t}))]`),
  compact: (t, s) => (useHelper(s, 'list'), `list(${t}).filter((x) => x !== null && x !== undefined)`),
  join: (t, s) => (useHelper(s, 'join'), `join(${t}, "")`),
  to_json: (t) => `JSON.stringify(${t})`,
  encode_base64: (t, s) => (useHelper(s, 'b64'), `b64(${t})`),
  to_date: (t, s) => (useHelper(s, 'toDate'), `toDate(${t})`),
};

/** Metodos com argumentos. */
function applyCall(target: string, method: string, args: Arg[], s: State): string | null {
  const plain = args.filter((a) => a.kind === 'value').map((a) => a.js);
  const pairs = args.filter((a): a is HashArg => a.kind === 'hash');

  switch (method) {
    case 'where': {
      if (pairs.length !== 1) return null;
      const pair = pairs[0]!;
      useHelper(s, 'where');
      return `where(${target}, ${jsString(pair.field)}, ${jsString(pair.op)}, ${pair.js})`;
    }
    case 'pluck': {
      if (!plain.length) return null;
      useHelper(s, 'pluck');
      return `pluck(${target}, [${plain.join(', ')}])`;
    }
    case 'gsub':
    case 'sub': {
      if (plain.length !== 2) return null;
      useHelper(s, 'gsub');
      if (method === 'sub') s.approximations.push('sub traduzido como gsub (troca global)');
      return `gsub(${target}, ${plain[0]}, ${plain[1]})`;
    }
    case 'split': {
      if (plain.length !== 1) return null;
      useHelper(s, 'split');
      return `split(${target}, ${plain[0]})`;
    }
    case 'join': {
      useHelper(s, 'join');
      return `join(${target}, ${plain[0] ?? '""'})`;
    }
    case 'smart_join': {
      useHelper(s, 'smartJoin');
      return `smartJoin(${target}, ${plain[0] ?? '""'})`;
    }
    case 'include?': {
      if (plain.length !== 1) return null;
      useHelper(s, 'includes');
      return `includes(${target}, ${plain[0]})`;
    }
    case 'match?': {
      if (plain.length !== 1) return null;
      useHelper(s, 'matches');
      return `matches(${target}, ${plain[0]})`;
    }
    case 'strftime': {
      if (plain.length !== 1) return null;
      if (!strftimeFormatKnown(plain[0]!)) return null;
      useHelper(s, 'strftime');
      return `strftime(${target}, ${plain[0]})`;
    }
    case 'first': {
      if (plain.length || pairs.length) return null;
      useHelper(s, 'at');
      return `at(${target}, 0)`;
    }
    case 'to_json': {
      if (plain.length || pairs.length) return null;
      return `JSON.stringify(${target})`;
    }
    case 'encode_base64': {
      if (plain.length || pairs.length) return null;
      useHelper(s, 'b64');
      return `b64(${target})`;
    }
    case 'to_date': {
      if (plain.length || pairs.length) return null;
      useHelper(s, 'toDate');
      return `toDate(${target})`;
    }
    case 'to_currency': {
      if (plain.length) return null;
      const allowed = new Set(['unit', 'precision', 'separator', 'delimiter']);
      if (pairs.some((p) => !allowed.has(p.field) || p.op)) return null;
      const by = Object.fromEntries(pairs.map((p) => [p.field, p.js]));
      if (by.delimiter && by.delimiter !== '","') return null;
      useHelper(s, 'toCurrency');
      s.approximations.push(CURRENCY_NOTE);
      return `toCurrency(${target}, ${by.unit ?? '"$"'}, ${by.precision ?? '2'}, ${by.separator ?? '"."'})`;
    }
    case 'scan': {
      if (plain.length !== 1) return null;
      useHelper(s, 'scan');
      return `scan(${target}, ${plain[0]})`;
    }
    case '[]': {
      if (plain.length !== 1) return null;
      useHelper(s, 'dig');
      return `dig(${target}, ${plain[0]})`;
    }
    case 'in_time_zone': {
      if (plain.length !== 1) return null;
      s.approximations.push('in_time_zone ignorado: o fuso fica no campo time_zone do passo');
      return target;
    }
    default:
      return null;
  }
}

interface ValueArg {
  kind: 'value';
  js: string;
}
interface HashArg {
  kind: 'hash';
  field: string;
  op: string;
  js: string;
}
type Arg = ValueArg | HashArg;

/** `'title': /^Squad/` e `"current_phase_age >=": 172800`. */
function splitFieldOp(raw: string): { field: string; op: string } {
  const m = raw.trim().match(/^(\S+)\s*(>=|<=|>|<)?$/);
  if (!m) return { field: raw.trim(), op: '' };
  return { field: m[1]!, op: m[2] ?? '' };
}

function parseArgs(s: State): Arg[] | null {
  const args: Arg[] = [];
  if (eatOp(s, ')')) return args;
  for (;;) {
    const token = peek(s);
    const next = s.tokens[s.pos + 1];
    if (
      (token?.kind === 'string' || token?.kind === 'ident') &&
      next?.kind === 'op' &&
      next.value === ':'
    ) {
      s.pos += 2;
      const value = parseExpr(s);
      if (value === null) return null;
      const { field, op } = splitFieldOp(token.value);
      args.push({ kind: 'hash', field, op, js: value });
    } else {
      const value = parseExpr(s);
      if (value === null) return null;
      args.push({ kind: 'value', js: value });
    }
    if (eatOp(s, ',')) continue;
    if (eatOp(s, ')')) return args;
    return null;
  }
}

function parsePrimary(s: State): string | null {
  const token = peek(s);
  if (!token) return null;

  if (token.kind === 'pill') {
    s.pos++;
    return bindPill(s, token.value);
  }
  if (token.kind === 'string') {
    s.pos++;
    return jsString(token.value);
  }
  if (token.kind === 'number') {
    s.pos++;
    return token.value;
  }
  if (token.kind === 'regex') {
    s.pos++;
    return `new RegExp(${jsString(token.source)}, ${jsString(token.flags)})`;
  }
  if (token.kind === 'op' && token.value === '(') {
    s.pos++;
    const inner = parseExpr(s);
    if (inner === null || !eatOp(s, ')')) return null;
    return `(${inner})`;
  }
  if (token.kind === 'op' && token.value === '[') {
    s.pos++;
    const items: string[] = [];
    if (!eatOp(s, ']')) {
      for (;;) {
        const item = parseExpr(s);
        if (item === null) return null;
        items.push(item);
        if (eatOp(s, ',')) continue;
        if (eatOp(s, ']')) break;
        return null;
      }
    }
    return `[${items.join(', ')}]`;
  }
  if (token.kind === 'ident') {
    s.pos++;
    switch (token.value) {
      // `skip` do Workato = nao preencher o campo. `undefined` some do objeto
      // devolvido pelo CODE, que e o mais proximo no AP.
      case 'skip':
        s.approximations.push('skip do Workato virou vazio (o AP nao tem "nao preencher")');
        return 'undefined';
      case 'nil':
      case 'null':
        return 'null';
      case 'true':
      case 'false':
        return token.value;
      case 'today':
        return 'new Date().toISOString().slice(0, 10)';
      case 'now':
        return 'new Date().toISOString()';
      default:
        return null;
    }
  }
  return null;
}

function parsePostfix(s: State): string | null {
  let target = parsePrimary(s);
  if (target === null) return null;

  for (;;) {
    const token = peek(s);
    if (!token) return target;

    if (token.kind === 'op' && (token.value === '.' || token.value === '&.')) {
      const safe = token.value === '&.';
      const guard = (expr: string) =>
        safe ? `(${target} === null || ${target} === undefined ? undefined : ${expr})` : expr;

      const bracket = s.tokens[s.pos + 1];
      if (bracket?.kind === 'op' && bracket.value === '[') {
        s.pos += 2;
        if (!eatOp(s, ']') || !eatOp(s, '(')) return null;
        const args = parseArgs(s);
        if (!args) return null;
        const applied = applyCall(target, '[]', args, s);
        if (applied === null) return null;
        target = guard(applied);
        continue;
      }

      const name = s.tokens[s.pos + 1];
      if (name?.kind !== 'ident') return null;
      s.pos += 2;

      if (eatOp(s, '(')) {
        const args = parseArgs(s);
        if (!args) return null;
        const applied = applyCall(target, name.value, args, s);
        if (applied === null) return null;
        target = guard(applied);
        continue;
      }
      const cal = calendarUnit(name.value);
      if (cal) {
        target = `__cal('${cal}', ${target})`;
        continue;
      }
      const nullary = NULLARY[name.value];
      if (!nullary) return null;
      target = guard(nullary(target, s));
      continue;
    }

    if (token.kind === 'op' && token.value === '[') {
      s.pos++;
      const index = parseExpr(s);
      if (index === null || !eatOp(s, ']')) return null;
      if (/^\d+$/.test(index)) {
        useHelper(s, 'at');
        target = `at(${target}, ${index})`;
      } else {
        useHelper(s, 'dig');
        target = `dig(${target}, ${index})`;
      }
      continue;
    }
    return target;
  }
}

function parseMultiplicative(s: State): string | null {
  let left = parsePostfix(s);
  if (left === null) return null;
  for (;;) {
    if (!eatOp(s, '*')) return left;
    const right = parsePostfix(s);
    if (right === null) return null;
    useHelper(s, 'mul');
    s.approximations.push(MULTIPLY_NOTE);
    left = `mul(${left}, ${right})`;
  }
}

function parseAdditive(s: State): string | null {
  let left = parseMultiplicative(s);
  if (left === null) return null;
  for (;;) {
    const token = peek(s);
    // Literais adjacentes concatenam no Ruby: `"\n"\n"File"`.
    // Só quando o token anterior também é string — senão o corpo de um `if` cola na condição.
    if (token?.kind === 'string' && s.tokens[s.pos - 1]?.kind === 'string') {
      s.pos++;
      useHelper(s, 'add');
      left = `add(${left}, ${jsString(token.value)})`;
      continue;
    }
    if (token?.kind === 'op' && (token.value === '+' || token.value === '-' || token.value === '<<')) {
      s.pos++;
      const right = parseMultiplicative(s);
      if (right === null) return null;
      const dur = parseCalDuration(right);
      if (dur && token.value !== '<<') {
        useHelper(s, 'addCal');
        const n = token.value === '-' ? `-(${dur.n})` : dur.n;
        left = `addCal(${left}, ${n}, '${dur.unit}')`;
        continue;
      }
      if (token.value === '-') return null;
      // Um helper so: aninhar `String(left)+String(right)` duplica `left` a cada `+`
      // e estoura a memoria numa mensagem longa.
      if (token.value === '<<') useHelper(s, 'append');
      else useHelper(s, 'add');
      left = token.value === '<<' ? `append(${left}, ${right})` : `add(${left}, ${right})`;
      continue;
    }
    return left;
  }
}

function parseOr(s: State): string | null {
  let left = parseAdditive(s);
  if (left === null) return null;
  for (;;) {
    const token = peek(s);
    if (token?.kind === 'op' && (token.value === '||' || token.value === '&&')) {
      s.pos++;
      const right = parseAdditive(s);
      if (right === null) return null;
      // Ruby considera `nil`/`false` falsos; string vazia e VERDADEIRA. `??`
      // erraria com `false`, `||` erraria com `""`.
      left =
        token.value === '||'
          ? `((${left}) === null || (${left}) === undefined || (${left}) === false ? (${right}) : (${left}))`
          : `((${left}) === null || (${left}) === undefined || (${left}) === false ? (${left}) : (${right}))`;
      continue;
    }
    return left;
  }
}

function eatIdent(s: State, value: string): boolean {
  const token = peek(s);
  if (token?.kind === 'ident' && token.value === value) {
    s.pos++;
    return true;
  }
  return false;
}

/** `if cond ... elsif cond ... else ... end` */
function parseIf(s: State): string | null {
  if (!eatIdent(s, 'if')) return null;
  const clauses: { cond: string; expr: string }[] = [];
  const cond = parseOr(s);
  const thenExpr = parseOr(s);
  if (cond === null || thenExpr === null) return null;
  clauses.push({ cond, expr: thenExpr });
  while (eatIdent(s, 'elsif')) {
    const elsifCond = parseOr(s);
    const elsifExpr = parseOr(s);
    if (elsifCond === null || elsifExpr === null) return null;
    clauses.push({ cond: elsifCond, expr: elsifExpr });
  }
  let elseExpr = 'undefined';
  if (eatIdent(s, 'else')) {
    const parsed = parseOr(s);
    if (parsed === null) return null;
    elseExpr = parsed;
  }
  if (!eatIdent(s, 'end')) return null;
  let out = elseExpr;
  for (let i = clauses.length - 1; i >= 0; i--) {
    const clause = clauses[i]!;
    out = `((${clause.cond}) ? (${clause.expr}) : (${out}))`;
  }
  return out;
}

function parseExpr(s: State): string | null {
  if (peek(s)?.kind === 'ident' && peek(s)?.value === 'if') return parseIf(s);
  const condition = parseOr(s);
  if (condition === null) return null;
  if (!eatOp(s, '?')) return condition;
  const truthy = parseExpr(s);
  if (truthy === null || !eatOp(s, ':')) return null;
  const falsy = parseExpr(s);
  if (falsy === null) return null;
  return `((${condition}) === null || (${condition}) === undefined || (${condition}) === false ? (${falsy}) : (${truthy}))`;
}

/**
 * Compila uma expressao Workato (pills JA convertidas para `{{...}}`) em JS.
 * Devolve `null` quando algum token esta fora do recorte suportado.
 */
export function compileRubyExpression(
  source: string,
  registry: BindingRegistry = newBindingRegistry(),
): CompiledExpr | null {
  const src = source.trim().replace(/^=/, '').trim();
  if (!src) return null;
  const phone = src.match(
    /^(\{\{[^{}]+\}\})\.length == 12 \?\s*\1\[0,4\] \+ "9" \+ \1\[4\.\.-1\] :\s*\1$/,
  );
  if (phone) {
    const state: State = {
      tokens: [],
      pos: 0,
      bindings: registry.bindings,
      pillNames: registry.pillNames,
      helpers: new Set(),
      approximations: [PHONE_NOTE],
      seq: registry.seq,
    };
    const name = bindPill(state, phone[1]!);
    return {
      expr: `(String(${name} ?? '').length === 12 ? String(${name}).slice(0, 4) + '9' + String(${name}).slice(4) : String(${name} ?? ''))`,
      bindings: registry.bindings,
      helpers: state.helpers,
      approximations: [PHONE_NOTE],
    };
  }
  const tokens = tokenize(src);
  if (!tokens || !tokens.length) return null;

  const before = registry.bindings.size;
  const state: State = {
    tokens,
    pos: 0,
    bindings: registry.bindings,
    pillNames: registry.pillNames,
    helpers: new Set(),
    approximations: [],
    seq: registry.seq,
  };
  const expr = parseExpr(state);
  if (expr === null || state.pos !== tokens.length) return null;
  // Sem pill o valor e constante: nao vale um step CODE.
  if (registry.bindings.size === before && !usesExistingBinding(expr, registry)) return null;

  return {
    expr,
    bindings: registry.bindings,
    helpers: state.helpers,
    approximations: [...new Set(state.approximations)],
  };
}

/** A expressao pode nao ter criado binding novo e ainda reusar um anterior. */
function usesExistingBinding(expr: string, registry: BindingRegistry): boolean {
  for (const name of registry.bindings.keys()) {
    if (new RegExp(`\\b${name}\\b`).test(expr)) return true;
  }
  return false;
}

/** Prelude com os helpers pedidos, em ordem estavel. */
export function renderHelpers(helpers: Set<string>): string {
  return Object.keys(HELPERS)
    .filter((name) => helpers.has(name))
    .map((name) => HELPERS[name]!)
    .join('\n');
}
