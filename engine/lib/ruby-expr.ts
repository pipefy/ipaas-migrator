import { ISO_COUNTRIES } from './iso-countries.ts';

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
  "to_currency formata unidade, precisao, separador decimal e delimitador de milhar. O separador decimal troca o ponto do numero ja arredondado.";

export const PHONE_NOTE =
  'Telefone com 12 dígitos ganha um 9 depois dos 4 primeiros, num step CODE. Os outros comprimentos saem iguais.';

/** Literal numérico comparado com string numérica. No Ruby puro, `"5" == 5` é falso. */
export const EQ_NOTE =
  'Comparacao com literal numerico tambem aceita a string numerica do outro lado. No Ruby, "5" == 5 e falso.';

/**
 * O campo FILE do iPaaS consome base64. Binário (byte nulo) fica em base64;
 * texto sem byte nulo vira UTF-8.
 */
export const DECODE_B64_NOTE =
  'decode_base64: texto UTF-8 e decodificado; binario (byte nulo) continua em base64 para o campo FILE.';

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
    if (expected === null || expected === undefined) return actual == null;
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
  at: `const at = (v, i) => {
  const n = Number(i);
  if (typeof v === 'string' || Array.isArray(v)) {
    const index = n < 0 ? v.length + n : n;
    return v[index];
  }
  return v?.[i];
};`,
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
  const tagged = v && typeof v === 'object' && typeof v.ms === 'number';
  const ms = tagged ? v.ms : new Date(v).getTime();
  if (Number.isNaN(ms)) return '';
  const tz = tagged && typeof v.tz === 'string' ? v.tz : '';
  const d = new Date(ms);
  const zoned = tz ? new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long',
  }).formatToParts(d) : null;
  const part = (type) => (zoned ? zoned.find((p) => p.type === type)?.value : '');
  const year = zoned ? Number(part('year')) : d.getFullYear();
  const month = zoned ? Number(part('month')) : d.getMonth() + 1;
  const day = zoned ? Number(part('day')) : d.getDate();
  const hour = zoned ? Number(part('hour')) : d.getHours();
  const minute = zoned ? Number(part('minute')) : d.getMinutes();
  const second = zoned ? Number(part('second')) : d.getSeconds();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const wday = zoned ? weekdays.indexOf(part('weekday')) : d.getDay();
  const start = new Date(year, month - 1, day);
  const yday = Math.round((start - new Date(year, 0, 1)) / 86400000) + 1;
  let offset = '';
  if (tz) {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(d).find((item) => item.type === 'timeZoneName')?.value ?? 'GMT';
    const m = name.match(/GMT(?:([+-])(\\d{1,2})(?::(\\d{2}))?)?/);
    const sign = m?.[1] === '-' ? '-' : '+';
    offset = m && m[1] ? sign + p(Number(m[2] ?? 0)) + p(Number(m[3] ?? 0)) : '+0000';
  } else {
    const min = -d.getTimezoneOffset();
    const sign = min < 0 ? '-' : '+';
    offset = sign + p(Math.floor(Math.abs(min) / 60)) + p(Math.abs(min) % 60);
  }
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const ms3 = String(d.getMilliseconds()).padStart(3, '0');
  const zoneName = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, timeZoneName: 'short' })
    .formatToParts(d).find((item) => item.type === 'timeZoneName')?.value ?? '';
  return fmt
    .replace(/%:z/g, offset.slice(0, 3) + ':' + offset.slice(3))
    .replace(/%z/g, offset)
    .replace(/%Z/g, zoneName)
    .replace(/%L/g, ms3)
    .replace(/%k/g, String(hour).padStart(2, ' '))
    .replace(/%l/g, String(h12).padStart(2, ' '))
    .replace(/%Y/g, p(year, 4))
    .replace(/%y/g, p(year % 100))
    .replace(/%-m/g, String(month))
    .replace(/%m/g, p(month))
    .replace(/%B/g, months[month - 1])
    .replace(/%b/g, months[month - 1].slice(0, 3))
    .replace(/%e/g, String(day).padStart(2, ' '))
    .replace(/%-d/g, String(day))
    .replace(/%d/g, p(day))
    .replace(/%-H/g, String(hour))
    .replace(/%H/g, p(hour))
    .replace(/%I/g, p(h12))
    .replace(/%p/g, hour < 12 ? 'AM' : 'PM')
    .replace(/%M/g, p(minute))
    .replace(/%S/g, p(second))
    .replace(/%j/g, p(yday, 3))
    .replace(/%A/g, weekdays[wday] ?? '')
    .replace(/%a/g, (weekdays[wday] ?? '').slice(0, 3));
};`,
  toDate: `const toDate = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
};`,
  toDateFmt: `const toDateFmt = (v, fmt) => {
  const text = String(v ?? '');
  const format = String(fmt ?? '');
  let i = 0;
  let j = 0;
  let year = 1970;
  let month = 1;
  let day = 1;
  let hh = 0;
  let mm = 0;
  let ss = 0;
  const read = (n) => {
    const part = text.slice(j, j + n);
    j += n;
    return Number(part);
  };
  while (i < format.length) {
    if (format[i] === '%') {
      const dir = format.slice(i, i + 2);
      if (dir === '%Y') year = read(4);
      else if (dir === '%y') { const y = read(2); year = y >= 70 ? 1900 + y : 2000 + y; }
      else if (dir === '%m') month = read(2);
      else if (dir === '%d' || dir === '%e') day = read(2);
      else if (dir === '%H') hh = read(2);
      else if (dir === '%M') mm = read(2);
      else if (dir === '%S') ss = read(2);
      else return toDate(v);
      i += 2;
      continue;
    }
    if (format[i] !== text[j]) return '';
    i++;
    j++;
  }
  return new Date(Date.UTC(year, month - 1, day, hh, mm, ss)).toISOString();
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
  const tagged = v && typeof v === 'object' && typeof v.ms === 'number';
  const raw = tagged ? '' : String(v ?? '');
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
  } else if (tagged) {
    const d = new Date(v.ms);
    y = d.getUTCFullYear();
    m = d.getUTCMonth() + 1;
    day = d.getUTCDate();
    hh = d.getUTCHours();
    mm = d.getUTCMinutes();
    ss = d.getUTCSeconds();
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
  let amount = Number(n);
  let unitName = unit;
  if (unitName === 'weeks') {
    amount *= 7;
    unitName = 'days';
  }
  if (unitName === 'hours' || unitName === 'minutes' || unitName === 'seconds') {
    const base = new Date(y, m - 1, day, hh, mm, ss);
    const ms = unitName === 'hours' ? amount * 3600000 : unitName === 'minutes' ? amount * 60000 : amount * 1000;
    const next = new Date(base.getTime() + ms);
    return next.getFullYear() + '-' + p(next.getMonth() + 1) + '-' + p(next.getDate()) + 'T' + p(next.getHours()) + ':' + p(next.getMinutes()) + ':' + p(next.getSeconds());
  }
  if (unitName === 'days') {
    const d = new Date(y, m - 1, day + amount, hh, mm, ss);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  const months = unitName === 'years' ? amount * 12 : amount;
  const zero = y * 12 + (m - 1) + months;
  y = Math.floor(zero / 12);
  m = zero - y * 12 + 1;
  const last = new Date(y, m, 0).getDate();
  day = Math.min(day, last);
  return y + '-' + p(m) + '-' + p(day) + 'T' + p(hh) + ':' + p(mm) + ':' + p(ss);
};`,
  mul: `const mul = (left, right) => Number(left) * Number(right);`,
  toCurrency: `const toCurrency = (value, unit, precision, separator, delimiter) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const delim = delimiter == null || delimiter === '' ? ',' : String(delimiter);
  const prec = Number.isFinite(Number(precision)) ? Math.max(0, Number(precision)) : 2;
  const neg = num < 0;
  const fixed = Math.abs(num).toFixed(prec);
  const dot = fixed.indexOf('.');
  const intRaw = dot < 0 ? fixed : fixed.slice(0, dot);
  const frac = dot < 0 ? '' : fixed.slice(dot + 1);
  const int = intRaw.replace(/\\B(?=(\\d{3})+(?!\\d))/g, delim);
  const body = prec > 0 ? int + '.' + frac : int;
  const decimal = separator == null || separator === '' ? '.' : String(separator);
  const shown = decimal === '.' ? body : body.split('.').join(decimal);
  return (neg ? '-' : '') + String(unit == null ? '$' : unit) + shown;
};`,
  append: `const append = (left, right) => String(left ?? '') + String(right ?? '');`,
  div: `const div = (left, right, lt, rt) => {
  const n = Number(left);
  const d = Number(right);
  if (d === 0) throw new Error('divided by 0');
  const float = lt === 'float' || rt === 'float' || (lt === 'any' && !Number.isInteger(n)) || (rt === 'any' && !Number.isInteger(d));
  return float ? n / d : Math.floor(n / d);
};`,
  mod: `const mod = (left, right) => {
  const n = Number(left);
  const d = Number(right);
  if (d === 0) throw new Error('divided by 0');
  return n - d * Math.floor(n / d);
};`,
  pow: `const pow = (left, right) => Number(left) ** Number(right);`,
  minus: `const minus = (left, right) => {
  if (Array.isArray(left)) {
    const drop = Array.isArray(right) ? right : [right];
    return left.filter((item) => !drop.some((gone) => gone === item || String(gone) === String(item)));
  }
  const iso = (v) => typeof v === 'string' && /^\\d{4}-\\d{2}-\\d{2}/.test(v);
  const tagged = (v) => v && typeof v === 'object' && typeof v.ms === 'number';
  if ((iso(left) || tagged(left) || left instanceof Date) && (iso(right) || tagged(right) || right instanceof Date)) {
    const ms = (v) => (tagged(v) ? v.ms : new Date(v).getTime());
    return (ms(left) - ms(right)) / 1000;
  }
  return Number(left) - Number(right);
};`,
  eq: `const eq = (left, right, coerce) => {
  if (left === right) return true;
  if (!coerce) return false;
  const num = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  const a = num(left);
  const b = num(right);
  return a !== null && b !== null && a === b;
};`,
  cmp: `const cmp = (left, right, op, coerce) => {
  const num = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (coerce && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  const a = num(left);
  const b = num(right);
  const x = a !== null && b !== null ? a : left;
  const y = a !== null && b !== null ? b : right;
  if (op === '>') return x > y;
  if (op === '>=') return x >= y;
  if (op === '<') return x < y;
  return x <= y;
};`,
  inZone: `const inZone = (v, tz) => {
  const ms = v && typeof v === 'object' && typeof v.ms === 'number' ? v.ms : new Date(v).getTime();
  if (Number.isNaN(ms)) return '';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz }).format(ms);
  } catch {
    throw new Error('invalid timezone ' + tz);
  }
  return { ms, tz: String(tz) };
};`,
  rubyRound: `const rubyRound = (v, n) => {
  const prec = Number(n) || 0;
  const f = 10 ** prec;
  const x = Number(v) * f;
  const r = (x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5)) / f;
  return prec === 0 ? Math.trunc(r) : r;
};`,
  decodeB64: `const decodeB64 = (v) => {
  const raw = String(v ?? '').replace(/\\s/g, '');
  const buf = Buffer.from(raw, 'base64');
  if (buf.includes(0)) return raw;
  return buf.toString('utf8');
};`,
  sliceAt: `const sliceAt = (v, from, to, exclusive) => {
  const seq = typeof v === 'string' || Array.isArray(v) ? v : String(v ?? '');
  const len = seq.length;
  const norm = (i) => {
    const n = Number(i);
    return n < 0 ? len + n : n;
  };
  let a = norm(from);
  let b = norm(to);
  if (!exclusive) b += 1;
  if (a < 0) a = 0;
  return seq.slice(a, b);
};`,
  whereNot: `const whereNot = (v, field, op, expected) => list(v).filter((item) => !where([item], field, op, expected).length);`,
  indexOf: `const indexOf = (v, needle) => {
  const i = list(v).findIndex((item) => item === needle || String(item) === String(needle));
  return i < 0 ? null : i;
};`,
  sumOf: `const sumOf = (v) => list(v).reduce((acc, item) => acc + Number(item), 0);`,
  maxOf: `const maxOf = (v) => {
  const xs = list(v);
  if (!xs.length) return null;
  return xs.reduce((acc, item) => (acc > item ? acc : item));
};`,
  minOf: `const minOf = (v) => {
  const xs = list(v);
  if (!xs.length) return null;
  return xs.reduce((acc, item) => (acc < item ? acc : item));
};`,
  lstrip: `const lstrip = (v) => String(v ?? '').replace(/^\\s+/, '');`,
  rstrip: `const rstrip = (v) => String(v ?? '').replace(/\\s+$/, '');`,
  rjust: `const rjust = (v, width, pad) => {
  const s = String(v ?? '');
  const p = pad == null || pad === '' ? ' ' : String(pad);
  const n = Number(width) || 0;
  if (s.length >= n) return s;
  return p.repeat(Math.ceil((n - s.length) / p.length)).slice(0, n - s.length) + s;
};`,
  ljust: `const ljust = (v, width, pad) => {
  const s = String(v ?? '');
  const p = pad == null || pad === '' ? ' ' : String(pad);
  const n = Number(width) || 0;
  if (s.length >= n) return s;
  return s + p.repeat(Math.ceil((n - s.length) / p.length)).slice(0, n - s.length);
};`,
  titleize: `const titleize = (v) => String(v ?? '').replace(/[_-]+/g, ' ').replace(/[A-Za-zÀ-ÿ]+/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());`,
  parameterize: `const parameterize = (v) => String(v ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');`,
  stripTags: `const stripTags = (v) => String(v ?? '').replace(/<[^>]*>/g, '');`,
  isTrue: `const isTrue = (v) => {
  if (v === true || v === 1) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === 't' || s === 'yes' || s === 'y' || s === '1';
};`,
  datePart: `const datePart = (v, part) => {
  const tagged = v && typeof v === 'object' && typeof v.ms === 'number';
  const ms = tagged ? v.ms : new Date(v).getTime();
  if (Number.isNaN(ms)) return null;
  const tz = tagged && v.tz ? v.tz : undefined;
  const d = new Date(ms);
  const bits = tz ? new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(d) : null;
  const read = (type, local) => (bits ? Number(bits.find((item) => item.type === type)?.value) : local);
  const year = read('year', d.getFullYear());
  const month = read('month', d.getMonth() + 1);
  const day = read('day', d.getDate());
  if (part === 'year') return year;
  if (part === 'month') return month;
  if (part === 'day') return day;
  if (part === 'wday') return tz ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(bits.find((item) => item.type === 'weekday')?.value) : d.getDay();
  const start = Date.UTC(year, month - 1, day);
  return Math.round((start - Date.UTC(year, 0, 1)) / 86400000) + 1;
};`,
  boundOf: `const boundOf = (v, part, end) => {
  const tagged = v && typeof v === 'object' && typeof v.ms === 'number' ? v : inZone(v, 'UTC');
  const y = datePart(tagged, 'year');
  const m = datePart(tagged, 'month');
  const d = datePart(tagged, 'day');
  let yy = y;
  let mm = m;
  let dd = d;
  let hh = 0;
  let mi = 0;
  let ss = 0;
  if (part === 'year') {
    mm = end ? 12 : 1;
    dd = end ? 31 : 1;
  } else if (part === 'month') {
    dd = end ? new Date(Date.UTC(y, m, 0)).getUTCDate() : 1;
  }
  if (part === 'hour') {
    const bits = new Intl.DateTimeFormat('en-US', { timeZone: tagged.tz || 'UTC', hourCycle: 'h23', hour: '2-digit' }).formatToParts(new Date(tagged.ms));
    hh = Number(bits.find((item) => item.type === 'hour')?.value);
    mi = end ? 59 : 0;
    ss = end ? 59 : 0;
  } else if (end) {
    hh = 23;
    mi = 59;
    ss = 59;
  }
  const utc = Date.UTC(yy, mm - 1, dd, hh, mi, ss);
  const shown = new Intl.DateTimeFormat('en-US', {
    timeZone: tagged.tz || 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utc));
  const num = (type) => Number(shown.find((item) => item.type === type)?.value);
  const asUtc = Date.UTC(num('year'), num('month') - 1, num('day'), num('hour'), num('minute'), num('second'));
  return { ms: utc + (utc - asUtc), tz: tagged.tz || 'UTC' };
};`,
  rubyFloor: `const rubyFloor = (v, n) => {
  const f = 10 ** Math.max(0, Number(n) || 0);
  return Math.floor(Number(v) * f) / f;
};`,
  rubyCeil: `const rubyCeil = (v, n) => {
  const f = 10 ** Math.max(0, Number(n) || 0);
  return Math.ceil(Number(v) * f) / f;
};`,
  sliceLen: `const sliceLen = (v, start, len) => {
  const seq = typeof v === 'string' || Array.isArray(v) ? v : String(v ?? '');
  const n = Number(start);
  const from = n < 0 ? seq.length + n : n;
  const size = Number(len);
  if (!Number.isFinite(from) || !Number.isFinite(size)) return '';
  return seq.slice(from, from + size);
};`,
  regexAt: `const regexAt = (v, re, group) => {
  const found = String(v ?? '').match(re);
  if (!found) return null;
  return found[Number(group) || 0] ?? null;
};`,
  gsubLit: `const gsubLit = (v, find, to) => {
  const escaped = String(find).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  return gsub(v, new RegExp(escaped, 'g'), to);
};`,
  gsubHash: `const gsubHash = (v, find, map) => {
  const text = v === null || v === undefined ? '' : String(v);
  const re = find instanceof RegExp ? new RegExp(find.source, 'g' + find.flags.replace('g', '')) : null;
  if (!re) return text.split(String(find)).join(String(map[find] ?? find));
  return text.replace(re, (hit) => (map && Object.prototype.hasOwnProperty.call(map, hit) ? String(map[hit]) : hit));
};`,
  gsubBlock: `const gsubBlock = (v, find, fn, once) => {
  const text = v === null || v === undefined ? '' : String(v);
  const re = find instanceof RegExp ? new RegExp(find.source, (once ? '' : 'g') + find.flags.replace('g', '')) : new RegExp(String(find).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), once ? '' : 'g');
  return text.replace(re, (hit) => String(fn(hit) ?? ''));
};`,
  toCurrencyFmt: `const toCurrencyFmt = (value, format, unit, precision, separator, delimiter) => {
  const shown = toCurrency(value, '', precision, separator, delimiter);
  return String(format ?? '').split('%u').join(String(unit == null ? '$' : unit)).split('%n').join(shown);
};`,
  toCsv: `const toCsv = (v) => list(v).map((item) => {
  const text = item === null || item === undefined ? '' : String(item);
  return /[",\\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}).join(',');`,
  byteslice: `const byteslice = (v, start, len) => {
  const buf = Buffer.from(String(v ?? ''), 'utf8');
  const n = Number(start);
  const from = n < 0 ? buf.length + n : n;
  const size = len == null ? 1 : Number(len);
  return buf.subarray(from, from + size).toString('utf8');
};`,
  scrub: `const scrub = (v) => String(v ?? '').replace(/\\uFFFD|[\\uD800-\\uDFFF]/g, '');`,
  isoCountries: `const ISO_COUNTRIES = ${JSON.stringify(ISO_COUNTRIES)};`,
  countryName: `const countryName = (v) => {
  const q = String(v ?? '').trim().toLowerCase();
  const row = ISO_COUNTRIES.find((item) => item[0].toLowerCase() === q || item[1].toLowerCase() === q || item[2].toLowerCase() === q);
  return row ? row[2] : '';
};`,
  countryAlpha3: `const countryAlpha3 = (v) => {
  const q = String(v ?? '').trim().toLowerCase();
  const row = ISO_COUNTRIES.find((item) => item[0].toLowerCase() === q || item[1].toLowerCase() === q || item[2].toLowerCase() === q);
  return row ? row[1] : '';
};`,
};

/** Dependencias entre helpers: puxar um traz o que ele usa. */
const HELPER_DEPS: Record<string, string[]> = {
  toDateFmt: ['toDate'],
  gsubLit: ['gsub'],
  gsubHash: ['gsub'],
  toCurrencyFmt: ['toCurrency'],
  toCsv: ['list'],
  countryName: ['isoCountries'],
  countryAlpha3: ['isoCountries'],
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
  whereNot: ['where', 'list'],
  indexOf: ['list'],
  sumOf: ['list'],
  maxOf: ['list'],
  minOf: ['list'],
  boundOf: ['datePart', 'inZone'],
  decodeB64: [],
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
  /** literal puro, ja avaliado no transpile. */
  constant?: boolean;
  value?: unknown;
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

const OPERATORS = [
  '...', '..', '&.', '===', '==', '!=', '>=', '<=', '||', '&&', '<<', '=>', '**',
  '?', ':', '.', ',', '(', ')', '[', ']', '{', '}', '|', ';', '+', '-', '*', '/', '%', '>', '<', '!',
];

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
    if (src.startsWith('{{', j)) {
      const end = src.indexOf('}}', j + 2);
      if (end < 0) return null;
      pushLiteral();
      if (tokens.length) tokens.push({ kind: 'op', value: '+' });
      tokens.push({ kind: 'pill', value: src.slice(j, end + 2) });
      j = end + 2;
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

/** `/.../` só depois de `(`, `,` ou início. Divisão não entra aqui. */
function regexAt(src: string, j: number): number | null {
  let k = j - 1;
  while (k >= 0 && /\s/.test(src[k]!)) k--;
  const prev = k >= 0 ? src[k] : '';
  if (prev && prev !== '(' && prev !== ',' && prev !== '=') return null;
  let i = j + 1;
  while (i < src.length && src[i] !== '/') {
    if (src[i] === '\\') {
      i += 2;
      continue;
    }
    i++;
  }
  if (i >= src.length) return null;
  i++;
  while (i < src.length && /[imxoun]/.test(src[i]!)) i++;
  return i;
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
    if (src.startsWith('{{', j)) {
      const end = src.indexOf('}}', j + 2);
      if (end < 0) return -1;
      j = end + 2;
      continue;
    }
    if (ch === '/' && regexAt(src, j)) {
      j = regexAt(src, j)!;
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
        (prev.kind === 'op' && prev.value !== ')' && prev.value !== ']' && prev.value !== '.' && prev.value !== '&.') ||
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
        while (j < src.length && /[imxoun]/.test(src[j]!)) {
          if (src[j] === 'i' || src[j] === 'm') flags += src[j];
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
  /** `now` / `today` / `from_now`: o valor muda a cada execucao. */
  dynamic: boolean;
  /** Parametro de bloco `gsub { |m| ... }`. */
  locals?: Map<string, string>;
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
    const two = format.slice(i, i + 2);
    const three = format.slice(i, i + 3);
    if (['%:z', '%-d', '%-m', '%-H'].includes(three)) {
      i += 2;
      continue;
    }
    if (!['%d', '%m', '%Y', '%y', '%H', '%M', '%S', '%I', '%p', '%z', '%Z', '%k', '%l', '%L', '%b', '%B', '%a', '%A', '%j', '%e'].includes(two)) return false;
    i++;
  }
  return true;
}

function calendarUnit(name: string): 'days' | 'months' | 'years' | 'hours' | 'minutes' | 'seconds' | 'weeks' | null {
  if (name === 'day' || name === 'days') return 'days';
  if (name === 'month' || name === 'months') return 'months';
  if (name === 'year' || name === 'years') return 'years';
  if (name === 'hour' || name === 'hours') return 'hours';
  if (name === 'minute' || name === 'minutes') return 'minutes';
  if (name === 'second' || name === 'seconds') return 'seconds';
  if (name === 'week' || name === 'weeks') return 'weeks';
  return null;
}

function parseCalDuration(js: string): { unit: string; n: string } | null {
  const bare = js.replace(/^\((.*)\)$/s, '$1');
  const matched = bare.match(/^__cal\('(\w+)',\s*(.+)\)$/s);
  return matched ? { unit: matched[1]!, n: matched[2]! } : null;
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
  to_currency: (t, s) => (
    useHelper(s, 'toCurrency'),
    s.approximations.push(CURRENCY_NOTE),
    `toCurrency(${t}, "$", 2, ".", ",")`
  ),
  to_time: (t, s) => (useHelper(s, 'toDate'), `toDate(${t})`),
  utc: (t, s) => (useHelper(s, 'toDate'), `toDate(${t})`),
  round: (t, s) => (useHelper(s, 'rubyRound'), `rubyRound(${t}, 0)`),
  ceil: (t) => `Math.ceil(Number(${t}))`,
  floor: (t) => `Math.floor(Number(${t}))`,
  abs: (t) => `Math.abs(Number(${t}))`,
  lstrip: (t, s) => (useHelper(s, 'lstrip'), `lstrip(${t})`),
  rstrip: (t, s) => (useHelper(s, 'rstrip'), `rstrip(${t})`),
  reverse: (t) => `String(${t} ?? '').split('').reverse().join('')`,
  titleize: (t, s) => (useHelper(s, 'titleize'), `titleize(${t})`),
  parameterize: (t, s) => (useHelper(s, 'parameterize'), `parameterize(${t})`),
  strip_tags: (t, s) => (useHelper(s, 'stripTags'), `stripTags(${t})`),
  capitalize: (t) => `(() => { const s = String(${t} ?? ''); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; })()`,
  as_utf8: (t) => `String(${t} ?? '')`,
  transliterate: (t) => `String(${t} ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')`,
  to_a: (t, s) => (useHelper(s, 'list'), `list(${t})`),
  sum: (t, s) => (useHelper(s, 'sumOf'), `sumOf(${t})`),
  max: (t, s) => (useHelper(s, 'maxOf'), `maxOf(${t})`),
  min: (t, s) => (useHelper(s, 'minOf'), `minOf(${t})`),
  values: (t) => `Object.values(${t} ?? {})`,
  wday: (t, s) => (useHelper(s, 'datePart'), `datePart(${t}, 'wday')`),
  yday: (t, s) => (useHelper(s, 'datePart'), `datePart(${t}, 'yday')`),
  beginning_of_day: (t, s) => (useHelper(s, 'boundOf'), `boundOf(${t}, 'day', false)`),
  beginning_of_hour: (t, s) => (useHelper(s, 'boundOf'), `boundOf(${t}, 'hour', false)`),
  beginning_of_month: (t, s) => (useHelper(s, 'boundOf'), `boundOf(${t}, 'month', false)`),
  beginning_of_year: (t, s) => (useHelper(s, 'boundOf'), `boundOf(${t}, 'year', false)`),
  end_of_day: (t, s) => (useHelper(s, 'boundOf'), `boundOf(${t}, 'day', true)`),
  end_of_month: (t, s) => (useHelper(s, 'boundOf'), `boundOf(${t}, 'month', true)`),
  end_of_year: (t, s) => (useHelper(s, 'boundOf'), `boundOf(${t}, 'year', true)`),
  'is_true?': (t, s) => (useHelper(s, 'isTrue'), `isTrue(${t})`),
  'is_not_true?': (t, s) => (useHelper(s, 'isTrue'), `!isTrue(${t})`),
  'even?': (t) => `(Number(${t}) % 2 === 0)`,
  decode_base64: (t, s) => (useHelper(s, 'decodeB64'), s.approximations.push(DECODE_B64_NOTE), `decodeB64(${t})`),
  encode_url: (t) => `encodeURIComponent(String(${t} ?? ''))`,
  decode_url: (t) => `decodeURIComponent(String(${t} ?? ''))`,
  decode_hex: (t) => `Buffer.from(String(${t} ?? ''), 'hex').toString('utf8')`,
  to_country_name: (t, s) => (useHelper(s, 'countryName'), `countryName(${t})`),
  to_country_alpha3: (t, s) => (useHelper(s, 'countryAlpha3'), `countryAlpha3(${t})`),
  scrub: (t, s) => (s.approximations.push('scrub troca o caractere invalido por vazio.'), useHelper(s, 'scrub'), `scrub(${t})`),
  to_csv: (t, s) => (useHelper(s, 'toCsv'), `toCsv(${t})`),
  split: (t, s) => (useHelper(s, 'split'), `split(${t}, /\\s+/)`),
};

/** Metodos com argumentos. */
function applyCall(target: string, method: string, args: Arg[], s: State): string | null {
  const plain = args.filter((a) => a.kind === 'value').map((a) => a.js);
  const pairs = args.filter((a): a is HashArg => a.kind === 'hash');
  if (!plain.length && !pairs.length && NULLARY[method]) return NULLARY[method]!(target, s);

  switch (method) {
    case 'where':
    case 'whereNot': {
      if (!pairs.length) return null;
      const helper = method === 'whereNot' ? 'whereNot' : 'where';
      useHelper(s, helper);
      return pairs.reduce(
        (acc, pair) => `${helper}(${acc}, ${jsString(pair.field)}, ${jsString(pair.op)}, ${pair.js})`,
        target,
      );
    }
    case 'pluck': {
      if (!plain.length) return null;
      useHelper(s, 'pluck');
      return `pluck(${target}, [${plain.join(', ')}])`;
    }
    case 'gsub':
    case 'sub': {
      if (method === 'sub') s.approximations.push('sub traduzido como gsub (troca global)');
      if (plain.length === 1 && !pairs.length) {
        const parts = splitJoinedStrings(plain[0]!);
        if (!parts) return null;
        s.approximations.push('gsub sem virgula: a primeira string vira regex literal e a segunda vira a troca.');
        useHelper(s, 'gsubLit');
        return `gsubLit(${target}, ${parts[0]}, ${parts[1]})`;
      }
      if (plain.length === 2 && plain[1]!.startsWith('({')) {
        useHelper(s, 'gsubHash');
        return `gsubHash(${target}, ${plain[0]}, ${plain[1]})`;
      }
      if (plain.length === 1 && pairs.length) {
        useHelper(s, 'gsubHash');
        const map = `({${pairs.map((pair) => `${jsString(pair.field)}: ${pair.js}`).join(', ')}})`;
        return `gsubHash(${target}, ${plain[0]}, ${map})`;
      }
      if (plain.length !== 2) return null;
      useHelper(s, 'gsub');
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
    case 'to_json': {
      if (plain.length || pairs.length) return null;
      return `JSON.stringify(${target})`;
    }
    case 'encode_base64': {
      if (plain.length || pairs.length) return null;
      useHelper(s, 'b64');
      return `b64(${target})`;
    }
    case 'to_currency': {
      if (plain.length) return null;
      const allowed = new Set(['unit', 'precision', 'separator', 'delimiter', 'format']);
      if (pairs.some((p) => !allowed.has(p.field) || p.op)) return null;
      const by = Object.fromEntries(pairs.map((p) => [p.field, p.js]));
      s.approximations.push(CURRENCY_NOTE);
      if (by.format) {
        useHelper(s, 'toCurrencyFmt');
        return `toCurrencyFmt(${target}, ${by.format}, ${by.unit ?? '"$"'}, ${by.precision ?? '2'}, ${by.separator ?? '"."'}, ${by.delimiter ?? '","'})`;
      }
      useHelper(s, 'toCurrency');
      return `toCurrency(${target}, ${by.unit ?? '"$"'}, ${by.precision ?? '2'}, ${by.separator ?? '"."'}, ${by.delimiter ?? '","'})`;
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
      useHelper(s, 'inZone');
      return `inZone(${target}, ${plain[0]})`;
    }
    case 'from_now':
    case 'ago': {
      const dur = parseCalDuration(target);
      if (!dur || plain.length || pairs.length) return null;
      s.dynamic = true;
      useHelper(s, 'addCal');
      const n = method === 'ago' ? `-(${dur.n})` : dur.n;
      return `addCal(new Date().toISOString(), ${n}, '${dur.unit}')`;
    }
    case 'round': {
      if (pairs.length || plain.length > 1) return null;
      useHelper(s, 'rubyRound');
      return `rubyRound(${target}, ${plain[0] ?? '0'})`;
    }
    case 'floor':
    case 'ceil': {
      if (pairs.length || plain.length > 1) return null;
      const helper = method === 'floor' ? 'rubyFloor' : 'rubyCeil';
      useHelper(s, helper);
      return `${helper}(${target}, ${plain[0] ?? '0'})`;
    }
    case 'slice':
    case 'byteslice': {
      if (plain.length < 1 || plain.length > 2 || pairs.length) return null;
      if (plain.length === 1 && plain[0]!.startsWith('__range(')) {
        useHelper(s, 'sliceAt');
        return plain[0]!.replace('__range(', `sliceAt(${target}, `);
      }
      if (plain.length === 2) {
        const helper = method === 'byteslice' ? 'byteslice' : 'sliceLen';
        useHelper(s, helper);
        return `${helper}(${target}, ${plain[0]}, ${plain[1]})`;
      }
      if (method === 'byteslice') {
        useHelper(s, 'byteslice');
        return `byteslice(${target}, ${plain[0]}, 1)`;
      }
      useHelper(s, 'sliceAt');
      return `sliceAt(${target}, ${plain[0]}, ${plain[0]}, false)`;
    }
    case 'rjust':
    case 'ljust': {
      if (!plain.length || plain.length > 2 || pairs.length) return null;
      const helper = method === 'rjust' ? 'rjust' : 'ljust';
      useHelper(s, helper);
      return `${helper}(${target}, ${plain[0]}, ${plain[1] ?? '" "'})`;
    }
    case 'index':
    case 'find_index': {
      if (plain.length !== 1) return null;
      useHelper(s, 'indexOf');
      return `indexOf(${target}, ${plain[0]})`;
    }
    case 'first': {
      if (pairs.length || plain.length > 1) return null;
      if (!plain.length) return NULLARY.first!(target, s);
      useHelper(s, 'list');
      return `list(${target}).slice(0, Number(${plain[0]}))`;
    }
    case 'last': {
      if (pairs.length || plain.length > 1) return null;
      if (!plain.length) return NULLARY.last!(target, s);
      useHelper(s, 'list');
      return `list(${target}).slice(-Number(${plain[0]}))`;
    }
    case 'drop': {
      if (plain.length !== 1) return null;
      useHelper(s, 'list');
      return `list(${target}).slice(${plain[0]})`;
    }
    case 'concat': {
      if (plain.length !== 1) return null;
      useHelper(s, 'list');
      return `list(${target}).concat(list(${plain[0]}))`;
    }
    case 'except': {
      if (!plain.length) return null;
      const keys = plain.map((item) => item).join(', ');
      return `Object.fromEntries(Object.entries(${target} ?? {}).filter(([key]) => ![${keys}].map(String).includes(String(key))))`;
    }
    case 'decode_base64': {
      if (plain.length || pairs.length) return null;
      useHelper(s, 'decodeB64');
      s.approximations.push(DECODE_B64_NOTE);
      return `decodeB64(${target})`;
    }
    case 'encode_url': {
      if (plain.length || pairs.length) return null;
      return `encodeURIComponent(String(${target} ?? ''))`;
    }
    case 'decode_url': {
      if (plain.length || pairs.length) return null;
      return `decodeURIComponent(String(${target} ?? ''))`;
    }
    case 'decode_hex': {
      if (plain.length || pairs.length) return null;
      return `Buffer.from(String(${target} ?? ''), 'hex').toString('utf8')`;
    }
    case 'to_date':
    case 'to_time': {
      if (plain.length > 1) return null;
      const format = pairs.find((pair) => pair.field === 'format');
      if (pairs.length && !format) return null;
      if (plain.length === 1 || format) {
        useHelper(s, 'toDateFmt');
        return `toDateFmt(${target}, ${plain[0] ?? format!.js})`;
      }
      useHelper(s, 'toDate');
      return `toDate(${target})`;
    }
    case 'to_s': {
      if (pairs.length || plain.length > 1) return null;
      if (!plain.length) return NULLARY.to_s!(target, s);
      if (plain[0] === '"db"') {
        useHelper(s, 'strftime');
        return `strftime(${target}, "%Y-%m-%d %H:%M:%S")`;
      }
      if (plain[0] === '"iso8601"') {
        useHelper(s, 'toDate');
        return `toDate(${target})`;
      }
      if (plain[0] === '"number"') {
        useHelper(s, 'strftime');
        return `strftime(${target}, "%Y%m%d%H%M%S")`;
      }
      return null;
    }
    case 'day':
    case 'month':
    case 'year': {
      if (plain.length || pairs.length) return null;
      useHelper(s, 'datePart');
      return `datePart(${target}, '${method}')`;
    }
    case 'ends_with?':
    case 'starts_with?': {
      if (plain.length !== 1) return null;
      const call = method === 'ends_with?' ? 'endsWith' : 'startsWith';
      return `String(${target} ?? '').${call}(String(${plain[0]} ?? ''))`;
    }
    case 'format_map': {
      if (plain.length !== 1) return null;
      s.approximations.push('format_map aproximado: troca %s pelo item.');
      useHelper(s, 'list');
      return `list(${target}).map((item) => String(${plain[0]}).split('%s').join(String(item ?? '')))`;
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
      (next.value === ':' || next.value === '=>')
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

function parseHash(s: State): string | null {
  if (!eatOp(s, '{')) return null;
  const parts: string[] = [];
  if (!eatOp(s, '}')) {
    for (;;) {
      const keyTok = peek(s);
      let key: string | null = null;
      const colon = s.tokens[s.pos + 1];
      if (keyTok?.kind === 'ident' && colon?.kind === 'op' && colon.value === ':') {
        s.pos += 2;
        key = jsString(keyTok.value);
      } else if (keyTok?.kind === 'op' && keyTok.value === ':') {
        const name = s.tokens[s.pos + 1];
        if (name?.kind !== 'ident') return null;
        s.pos += 2;
        if (!eatOp(s, '=>')) return null;
        key = jsString(name.value);
      } else {
        key = parseEquality(s);
        if (key === null || (!eatOp(s, '=>') && !eatOp(s, ':'))) return null;
      }
      const value = parseExpr(s);
      if (value === null || key === null) return null;
      parts.push(`${key}: ${value}`);
      if (eatOp(s, ',')) {
        if (eatOp(s, '}')) break;
        continue;
      }
      if (eatOp(s, '}')) break;
      return null;
    }
  }
  return `({${parts.join(', ')}})`;
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
  if (token.kind === 'op' && token.value === ':') {
    const name = s.tokens[s.pos + 1];
    if (name?.kind === 'ident') {
      s.pos += 2;
      return jsString(name.value);
    }
  }
  if (token.kind === 'op' && token.value === '{') return parseHash(s);
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
      case 'blank':
      case 'clear':
        if (eatOp(s, '(') && !eatOp(s, ')')) return null;
        return '""';
      case 'workato': {
        if (!eatOp(s, '.') ) return null;
        const member = peek(s);
        if (member?.kind !== 'ident' || member.value !== 'uuid') return null;
        s.pos++;
        if (eatOp(s, '(') && !eatOp(s, ')')) return null;
        s.dynamic = true;
        return 'crypto.randomUUID()';
      }
      case 'today':
        s.dynamic = true;
        if (eatOp(s, '(') && !eatOp(s, ')')) return null;
        return 'new Date().toISOString().slice(0, 10)';
      case 'now':
        s.dynamic = true;
        if (eatOp(s, '(') && !eatOp(s, ')')) return null;
        return 'new Date().toISOString()';
      default:
        if (s.locals?.has(token.value)) return s.locals.get(token.value)!;
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
      if (name?.kind === 'op' && ['+', '-', '*', '/'].includes(name.value)) {
        s.pos += 2;
        let arg: string | null;
        if (eatOp(s, '(')) {
          arg = parseExpr(s);
          if (arg === null || !eatOp(s, ')')) return null;
        } else {
          arg = parsePostfix(s);
        }
        if (arg === null) return null;
        const dur = parseCalDuration(arg);
        if (dur) {
          useHelper(s, 'addCal');
          const n = name.value === '-' ? `-(${dur.n})` : dur.n;
          target = guard(`addCal(${target}, ${n}, '${dur.unit}')`);
          continue;
        }
        if (name.value === '+') {
          useHelper(s, 'add');
          target = guard(`add(${target}, ${arg})`);
        } else if (name.value === '-') {
          useHelper(s, 'minus');
          target = guard(`minus(${target}, ${arg})`);
        } else if (name.value === '*') {
          useHelper(s, 'mul');
          s.approximations.push(MULTIPLY_NOTE);
          target = guard(`mul(${target}, ${arg})`);
        } else {
          useHelper(s, 'div');
          target = guard(`div(${target}, ${arg}, ${jsString(numTy(target))}, ${jsString(numTy(arg))})`);
        }
        continue;
      }
      if (name?.kind !== 'ident') return null;
      s.pos += 2;

      if (name.value === 'where') {
        const dot = s.tokens[s.pos];
        const nxt = s.tokens[s.pos + 1];
        if (dot?.kind === 'op' && dot.value === '.' && nxt?.kind === 'ident' && nxt.value === 'not') {
          s.pos += 2;
          if (!eatOp(s, '(')) return null;
          const whereNotArgs = parseArgs(s);
          if (!whereNotArgs) return null;
          const applied = applyCall(target, 'whereNot', whereNotArgs, s);
          if (applied === null) return null;
          target = guard(applied);
          continue;
        }
      }
      if (name.value === 'from_now' || name.value === 'ago') {
        const applied = applyCall(target, name.value, [], s);
        if (applied === null) return null;
        target = guard(applied);
        continue;
      }

      if (eatOp(s, '(')) {
        const args = parseArgs(s);
        if (!args) return null;
        if ((name.value === 'gsub' || name.value === 'sub') && peek(s)?.kind === 'op' && peek(s)?.value === '{') {
          const block = parseGsubBlock(target, name.value, args, s);
          if (block === null) return null;
          target = guard(block);
          continue;
        }
        const applied = applyCall(target, name.value, args, s);
        if (applied === null) return null;
        target = guard(applied);
        continue;
      }
      const cal = calendarUnit(name.value);
      if (cal) {
        const datePartName = name.value === 'day' || name.value === 'month' || name.value === 'year';
        if (datePartName && !/^-?\d+(?:\.\d+)?$/.test(target)) {
          useHelper(s, 'datePart');
          target = guard(`datePart(${target}, '${name.value}')`);
          continue;
        }
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
      const from = parseExpr(s);
      if (from === null) return null;
      if (eatOp(s, ',')) {
        const len = parseExpr(s);
        if (len === null || !eatOp(s, ']')) return null;
        if (from.startsWith('new RegExp(')) {
          useHelper(s, 'regexAt');
          target = `regexAt(${target}, ${from}, ${len})`;
        } else {
          useHelper(s, 'sliceLen');
          target = `sliceLen(${target}, ${from}, ${len})`;
        }
        continue;
      }
      if (!eatOp(s, ']')) return null;
      if (from.startsWith('__range(')) {
        useHelper(s, 'sliceAt');
        target = from.replace('__range(', `sliceAt(${target}, `);
        continue;
      }
      if (/^-?\d+$/.test(from)) {
        useHelper(s, 'at');
        target = `at(${target}, ${from})`;
      } else {
        useHelper(s, 'dig');
        target = `dig(${target}, ${from})`;
      }
      continue;
    }
    return target;
  }
}

function numTy(js: string): 'int' | 'float' | 'any' {
  if (/^-?\d+\.\d+$/.test(js)) return 'float';
  if (/^-?\d+$/.test(js)) return 'int';
  if (js.startsWith('toF(')) return 'float';
  if (js.startsWith('toI(') || js.startsWith('len(')) return 'int';
  return 'any';
}

function numericLiteral(js: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(js);
}

function parseUnary(s: State): string | null {
  if (eatOp(s, '!')) {
    const inner = parseUnary(s);
    if (inner === null) return null;
    return `(${inner} === null || ${inner} === undefined || ${inner} === false)`;
  }
  if (eatOp(s, '+')) return parseUnary(s);
  if (eatOp(s, '-')) {
    const inner = parseUnary(s);
    if (inner === null) return null;
    if (/^\d+(\.\d+)?$/.test(inner)) return `-${inner}`;
    return `(-(${inner}))`;
  }
  return parsePostfix(s);
}

function parsePower(s: State): string | null {
  const left = parseUnary(s);
  if (left === null) return null;
  if (!eatOp(s, '**')) return left;
  const right = parsePower(s);
  if (right === null) return null;
  useHelper(s, 'pow');
  return `pow(${left}, ${right})`;
}

function parseMultiplicative(s: State): string | null {
  let left = parsePower(s);
  if (left === null) return null;
  for (;;) {
    const op = peek(s);
    if (op?.kind !== 'op' || (op.value !== '*' && op.value !== '/' && op.value !== '%')) return left;
    s.pos++;
    const right = parsePower(s);
    if (right === null) return null;
    if (op.value === '*') {
      useHelper(s, 'mul');
      s.approximations.push(MULTIPLY_NOTE);
      left = `mul(${left}, ${right})`;
      continue;
    }
    if (op.value === '/') {
      useHelper(s, 'div');
      left = `div(${left}, ${right}, ${jsString(numTy(left))}, ${jsString(numTy(right))})`;
      continue;
    }
    useHelper(s, 'mod');
    left = `mod(${left}, ${right})`;
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
      if (token.value === '-') {
        useHelper(s, 'minus');
        left = `minus(${left}, ${right})`;
        continue;
      }
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

function parseComparison(s: State): string | null {
  let left = parseAdditive(s);
  if (left === null) return null;
  for (;;) {
    const token = peek(s);
    if (token?.kind !== 'op' || !['>', '>=', '<', '<='].includes(token.value)) return left;
    s.pos++;
    const right = parseAdditive(s);
    if (right === null) return null;
    const coerce = numericLiteral(left) !== numericLiteral(right);
    if (coerce) s.approximations.push(EQ_NOTE);
    useHelper(s, 'cmp');
    left = `cmp(${left}, ${right}, ${jsString(token.value)}, ${coerce})`;
  }
}

function parseEquality(s: State): string | null {
  let left = parseComparison(s);
  if (left === null) return null;
  for (;;) {
    const token = peek(s);
    if (token?.kind !== 'op' || (token.value !== '==' && token.value !== '!=' && token.value !== '===')) return left;
    s.pos++;
    const right = parseComparison(s);
    if (right === null) return null;
    const coerce = numericLiteral(left) !== numericLiteral(right);
    if (coerce) s.approximations.push(EQ_NOTE);
    useHelper(s, 'eq');
    const same = `eq(${left}, ${right}, ${coerce})`;
    left = token.value === '!=' ? `!${same}` : same;
  }
}

function parseAnd(s: State): string | null {
  let left = parseEquality(s);
  if (left === null) return null;
  for (;;) {
    if (!eatOp(s, '&&')) return left;
    const right = parseEquality(s);
    if (right === null) return null;
    left = `((${left}) === null || (${left}) === undefined || (${left}) === false ? (${left}) : (${right}))`;
  }
}

function parseOr(s: State): string | null {
  let left = parseAnd(s);
  if (left === null) return null;
  for (;;) {
    if (!eatOp(s, '||')) return left;
    const right = parseAnd(s);
    if (right === null) return null;
    // Ruby considera `nil`/`false` falsos; string vazia e VERDADEIRA. `??`
    // erraria com `false`, `||` erraria com `""`.
    left = `((${left}) === null || (${left}) === undefined || (${left}) === false ? (${right}) : (${left}))`;
  }
}

function parseRange(s: State): string | null {
  const left = parseOr(s);
  if (left === null) return null;
  const token = peek(s);
  if (token?.kind !== 'op' || (token.value !== '..' && token.value !== '...')) return left;
  s.pos++;
  const right = parseOr(s);
  if (right === null) return null;
  return `__range(${left}, ${right}, ${token.value === '...'})`;
}

function parseTernary(s: State): string | null {
  const condition = parseRange(s);
  if (condition === null) return null;
  if (!eatOp(s, '?')) return condition;
  const truthy = parseExpr(s);
  if (truthy === null || !eatOp(s, ':')) return null;
  const falsy = parseExpr(s);
  if (falsy === null) return null;
  return `((${condition}) === null || (${condition}) === undefined || (${condition}) === false ? (${falsy}) : (${truthy}))`;
}

function parseNot(s: State): string | null {
  if (!eatIdent(s, 'not')) return parseTernary(s);
  const inner = parseTernary(s);
  if (inner === null) return null;
  return `(${inner} === null || ${inner} === undefined || ${inner} === false)`;
}

function parseKeywordAnd(s: State): string | null {
  let left = parseNot(s);
  if (left === null) return null;
  for (;;) {
    if (!eatIdent(s, 'and')) return left;
    const right = parseNot(s);
    if (right === null) return null;
    left = `((${left}) === null || (${left}) === undefined || (${left}) === false ? (${left}) : (${right}))`;
  }
}

function parseKeywordOr(s: State): string | null {
  let left = parseKeywordAnd(s);
  if (left === null) return null;
  for (;;) {
    if (!eatIdent(s, 'or')) return left;
    const right = parseKeywordAnd(s);
    if (right === null) return null;
    left = `((${left}) === null || (${left}) === undefined || (${left}) === false ? (${right}) : (${left}))`;
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
  const cond = parseKeywordOr(s);
  eatIdent(s, 'then');
  const thenExpr = parseKeywordOr(s);
  if (cond === null || thenExpr === null) return null;
  clauses.push({ cond, expr: thenExpr });
  while (eatIdent(s, 'elsif')) {
    const elsifCond = parseKeywordOr(s);
    eatIdent(s, 'then');
    const elsifExpr = parseKeywordOr(s);
    if (elsifCond === null || elsifExpr === null) return null;
    clauses.push({ cond: elsifCond, expr: elsifExpr });
  }
  let elseExpr = 'undefined';
  if (eatIdent(s, 'else')) {
    const parsed = parseKeywordOr(s);
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
  let left = parseKeywordOr(s);
  if (left === null) return null;
  while (eatOp(s, ';')) {
    if (!peek(s) || peek(s)?.value === '}') break;
    const right = parseKeywordOr(s);
    if (right === null) return null;
    left = `(${left}, ${right})`;
  }
  return left;
}

function splitJoinedStrings(js: string): [string, string] | null {
  const matched = js.match(/^add\(("(?:\\.|[^"\\])*"), ("(?:\\.|[^"\\])*")\)$/);
  return matched ? [matched[1]!, matched[2]!] : null;
}

function parseGsubBlock(target: string, method: string, args: Arg[], s: State): string | null {
  if (!eatOp(s, '{') || !eatOp(s, '|')) return null;
  const param = peek(s);
  if (param?.kind !== 'ident') return null;
  s.pos++;
  if (!eatOp(s, '|')) return null;
  const plain = args.filter((arg): arg is ValueArg => arg.kind === 'value');
  if (plain.length !== 1) return null;
  const prev = s.locals;
  s.locals = new Map(prev);
  s.locals.set(param.value, param.value);
  const body = parseExpr(s);
  s.locals = prev;
  if (body === null || !eatOp(s, '}')) return null;
  useHelper(s, 'gsubBlock');
  return `gsubBlock(${target}, ${plain[0]!.js}, (${param.value}) => (${body}), ${method === 'sub'})`;
}

function looseDurationSeconds(expr: string): number | null {
  const matched = expr.match(/^__cal\('(\w+)',\s*(-?\d+(?:\.\d+)?)\)$/);
  if (!matched) return null;
  const scale: Record<string, number> = {
    seconds: 1,
    minutes: 60,
    hours: 3600,
    days: 86400,
    weeks: 604800,
    months: 2629746,
    years: 31556952,
  };
  const factor = scale[matched[1]!];
  if (!factor) return null;
  return Number(matched[2]) * factor;
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
      dynamic: false,
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
    dynamic: false,
  };
  const expr = parseExpr(state);
  if (expr === null || state.pos !== tokens.length) return null;
  const approximations = [...new Set(state.approximations)];
  const loose = looseDurationSeconds(expr);
  if (loose !== null && registry.bindings.size === before && !usesExistingBinding(expr, registry)) {
    approximations.push('Duracao solta virou segundos. 1.month e 1.year usam a media do ActiveSupport.');
    return {
      expr: String(loose),
      bindings: registry.bindings,
      helpers: state.helpers,
      approximations: [...new Set(approximations)],
      constant: true,
      value: loose,
    };
  }
  if (/\b__cal\(/.test(expr) || /\b__range\(/.test(expr)) return null;
  if (registry.bindings.size === before && !usesExistingBinding(expr, registry)) {
    if (state.dynamic) {
      return { expr, bindings: registry.bindings, helpers: state.helpers, approximations };
    }
    try {
      const value = new Function(`${renderHelpers(state.helpers)}\nreturn (${expr});`)();
      return {
        expr,
        bindings: registry.bindings,
        helpers: state.helpers,
        approximations,
        constant: true,
        value,
      };
    } catch {
      // Fuso anonimo e outros erros so aparecem na execucao.
      return { expr, bindings: registry.bindings, helpers: state.helpers, approximations };
    }
  }

  return {
    expr,
    bindings: registry.bindings,
    helpers: state.helpers,
    approximations,
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
