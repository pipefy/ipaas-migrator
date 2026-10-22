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

const INVALID_HASH_KEY =
  'AP-MIGRATION-INVALID-HASH-KEY: chave de hash nao representavel sem perda no destino JSON.';
const INVALID_DIGEST_INPUT = 'AP-MIGRATION-INVALID-DIGEST-INPUT';

/** Helpers do runtime Ruby-like, injetados no step CODE conforme o uso. */
const HELPERS: Record<string, string> = {
  inspect: String.raw`const inspect = (v, hint) => {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'number' && hint === 'float') return floatText(v);
  if (Array.isArray(v)) return '[' + v.map((item, i) => inspect(item, hint?.array?.[i])).join(', ') + ']';
  if (typeof v === 'object') {
    return '{' + Object.entries(v).map(([k, x]) => inspect(k) + '=>' + inspect(x, hint?.object?.[k])).join(', ') + '}';
  }
  if (typeof v === 'string') {
    const escapes = {
      '"': '\\"', '\\': '\\\\', '#': '\\#',
      '\u0007': '\\a', '\b': '\\b', '\t': '\\t', '\n': '\\n',
      '\v': '\\v', '\f': '\\f', '\r': '\\r', '\u001b': '\\e',
    };
    return '"' + v.replace(/["\\\u0000-\u001f\u007f-\u009f\u2028\u2029]|#(?=[{@$])/g,
      (character) => escapes[character] ?? '\\u' + character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')) + '"';
  }
  return String(v);
};`,
  // Array#to_s do Ruby e o inspect (`["a", "b"]`). As receitas contam com isso:
  // logo depois vem gsub tirando colchetes e aspas.
  toS: `const toS = (v, hint) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && hint === 'float') return floatText(v);
  if (typeof v === 'object') return inspect(v, hint);
  return String(v);
};`,
  floatText: `const floatText = (v) => {
  if (typeof v !== 'number') throw new Error('AP-MIGRATION-INVALID-FLOAT-TEXT');
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return 'Infinity';
  if (v === -Infinity) return '-Infinity';
  if (Object.is(v, -0)) return '-0.0';
  if (v === 0) return '0.0';
  const sign = v < 0 ? '-' : '';
  const [mantissa, exponentText] = Math.abs(v).toExponential().split('e');
  const digits = mantissa.replace('.', '');
  const exponent = Number(exponentText);
  const decpt = exponent + 1;
  if (decpt > 0 && decpt < digits.length) {
    return sign + digits.slice(0, decpt) + '.' + digits.slice(decpt);
  }
  if (decpt > 0 && decpt <= 15) {
    return sign + digits + '0'.repeat(decpt - digits.length) + '.0';
  }
  if (decpt <= 0 && decpt > -4) {
    return sign + '0.' + '0'.repeat(-decpt) + digits;
  }
  return sign + digits[0] + '.' + (digits.slice(1) || '0') +
    'e' + (exponent < 0 ? '-' : '+') + String(Math.abs(exponent)).padStart(2, '0');
};`,
  floatOut: `const floatOut = (v) => (typeof v === 'number' ? floatText(v) : v);`,
  toI: `const toI = (v) => parseInt(String(v ?? '').trim(), 10) || 0;`,
  toF: `const toF = (v) => {
  const result = parseFloat(String(v ?? '').trim());
  return Number.isNaN(result) ? 0 : result;
};`,
  list: `const list = (v) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);`,
  pluck: `const pluck = (v, keys) => {
  const read = (item, key) => (Array.isArray(key) ? key : [key])
    .reduce((value, part) => value?.[part], item);
  return list(v).map((item) => keys.length === 1 ? read(item, keys[0]) : keys.map((key) => read(item, key)));
};`,
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
  // Workato/Ruby `blank?`: nil, false, string vazia/espacos, lista/hash vazios.
  blank: `const blank = (v) => {
  if (v === null || v === undefined || v === false) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false;
};`,
  presence: `const presence = (v) => (blank(v) ? null : v);`,
  // smart_join do Workato descarta itens vazios antes de juntar.
  smartJoin: `const smartJoin = (v, sep) => list(v).filter((x) => !blank(x)).map(String).join(sep);`,
  includes: `const includes = (v, needle) => {
  if (typeof v === 'string') {
    if (typeof needle !== 'string') throw new Error('AP-MIGRATION-INVALID-MEMBERSHIP');
    return v.includes(needle);
  }
  if (!Array.isArray(v)) throw new Error('AP-MIGRATION-INVALID-MEMBERSHIP');
  const equal = (a, b) => {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
        a.every((value, i) => equal(value, b[i]));
    }
    const plain = (value) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
    if (!plain(a) || !plain(b)) throw new Error('AP-MIGRATION-INVALID-MEMBERSHIP');
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
  };
  return v.some((item) => equal(item, needle));
};`,
  formatMap: `const formatMap = (v, template, hint) => {
  const invalid = () => { throw new Error('AP-MIGRATION-INVALID-FORMAT-MAP'); };
  if (!Array.isArray(v) || typeof template !== 'string') return invalid();
  const unsafeCompoundText = (kind) => kind === 'symbol' || kind === 'unrepresented' ||
    (kind && typeof kind === 'object' && (kind.rubyKeys ||
      (kind.array ? kind.array.some(unsafeCompoundText) : Object.values(kind.object).some(unsafeCompoundText))));
  const text = (value, kind) => value !== null && typeof value === 'object' && unsafeCompoundText(kind) ? invalid() : toS(value, kind);
  const parts = [];
  let literal = '', mode = '';
  for (let i = 0; i < template.length; i++) {
    if (template[i] !== '%') { literal += template[i]; continue; }
    const next = template[++i];
    if (next === '%') { literal += '%'; continue; }
    parts.push({ literal }); literal = '';
    if (next === 's') {
      if (mode === 'named') return invalid();
      mode = 'positional'; parts.push({ positional: true });
    } else if (next === '{') {
      if (mode === 'positional') return invalid();
      const end = template.indexOf('}', i + 1);
      if (end <= i + 1) return invalid();
      mode = 'named'; parts.push({ key: template.slice(i + 1, end) }); i = end;
    } else return invalid();
  }
  parts.push({ literal });
  return v.map((item, row) => {
    const itemHint = hint?.array?.[row];
    const values = Array.isArray(item) ? item : [item];
    let position = 0;
    return parts.map((part) => {
      if (Object.hasOwn(part, 'literal')) return part.literal;
      if (part.positional) {
        if (position >= values.length) return invalid();
        const valueHint = Array.isArray(item) ? itemHint?.array?.[position] : itemHint;
        return text(values[position++], valueHint);
      }
      if (item === null || typeof item !== 'object' || Array.isArray(item) || !Object.hasOwn(item, part.key)) return invalid();
      if (itemHint?.rubyKeys === 'unsupported') return invalid();
      return text(item[part.key], itemHint?.object?.[part.key]);
    }).join('');
  });
};`,
  stringAffix: `const stringAffix = (v, affixes, prefix) => {
  if (typeof v !== 'string') throw new Error('AP-MIGRATION-INVALID-STRING-AFFIX');
  return affixes.some((affix) => {
    if (typeof affix !== 'string') throw new Error('AP-MIGRATION-INVALID-STRING-AFFIX');
    return prefix ? v.startsWith(affix) : v.endsWith(affix);
  });
};`,
  matches: `const matches = (v, re) => re.test(toS(v));`,
  at: `const at = (v, i) => {
  const n = Number(i);
  if (typeof v === 'string' || Array.isArray(v)) {
    const index = n < 0 ? v.length + n : n;
    return v[index] ?? null;
  }
  return v?.[i];
};`,
  dig: `const dig = (v, k) => typeof k === 'number' ? at(v, k) : v?.[k];`,
  truthy: `const truthy = (v) => v !== null && v !== undefined && v !== false;`,
  rubyAnd: `const rubyAnd = (left, right) => truthy(left) ? right() : left;`,
  rubyOr: `const rubyOr = (left, right) => truthy(left) ? left : right();`,
  // O destino JSON usa chaves string. Nao aceitar chaves compostas ou colisoes
  // entre tipos (1 e "1", :slot e "slot", 1 e 1.0) que Ruby separa.
  rubyHash: `const rubyHash = (entries) => {
  const seen = new Map();
  const mapped = entries.map(([raw, value, hint]) => {
    const supported = raw === null || typeof raw === 'string' || typeof raw === 'boolean' ||
      (typeof raw === 'number' && Number.isFinite(raw));
    if (!supported || hint === 'unsupported' || (hint === 'unknown' && typeof raw === 'number')) {
      throw new Error(${JSON.stringify(INVALID_HASH_KEY)});
    }
    const kind = hint === 'unknown' ? (raw === null ? 'nil' : typeof raw) : hint;
    const key = String(raw);
    const previous = seen.get(key);
    if (previous && (previous.raw !== raw || previous.kind !== kind)) throw new Error(${JSON.stringify(INVALID_HASH_KEY)});
    seen.set(key, { raw, kind });
    return [key, value];
  });
  return Object.fromEntries(mapped);
};`,
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
  return fmt.split('%%').map((part) => part
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
    .replace(/%a/g, (weekdays[wday] ?? '').slice(0, 3))
    .replace(/%w/g, String(wday))
    .replace(/%u/g, String(wday === 0 ? 7 : wday))).join('%');
};`,
  toDate: `const toDate = (v) => {
  if (v === null || v === undefined || v === '') return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
};`,
  toDateFmt: `const toDateFmt = (v, fmt) => {
  const text = String(v ?? '');
  const tokens = { YYYY: '%Y', YY: '%y', MM: '%m', DD: '%d' };
  const format = String(fmt ?? '').replace(/YYYY|YY|MM|DD/g, (token) => tokens[token]);
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
  rangeCount: `const rangeCount = (left, right, exclusive) => {
  const utcDay = (v) => {
    if (typeof v !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}/.test(v)) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  };
  const start = utcDay(left);
  const end = utcDay(right);
  if (start != null && end != null) {
    const days = Math.round((end - start) / 86400000);
    if (days < 0) return 0;
    return exclusive ? days : days + 1;
  }
  if (typeof left === 'number' && typeof right === 'number' && Number.isInteger(left) && Number.isInteger(right)) {
    if (left > right) return 0;
    return exclusive ? right - left : right - left + 1;
  }
  return null;
};`,
  scan: `const scan = (v, re) => {
  const text = toS(v);
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const r = new RegExp(re.source, flags);
  return [...text.matchAll(r)].map((m) => (m.length > 1 ? m.slice(1) : m[0]));
};`,
  strip: `const strip = (v) => String(v ?? '').trim();`,
  // Ruby: split(" ") e split sem argumento cortam em espaços e ignoram os da borda; os vazios do fim saem.
  split: `const split = (v, sep) => {
  const text = String(v ?? '');
  const parts = sep === ' ' ? (text.trim() === '' ? [] : text.trim().split(/\\s+/)) : text.split(sep);
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
};`,
  splitLiteralLimit: `const splitLiteralLimit = (v, sep, limit) => {
  if (typeof v !== 'string' || typeof limit !== 'number' || !Number.isFinite(limit)) throw new TypeError('invalid split receiver or limit');
  const n = Math.trunc(limit);
  if (!v.length) return [];
  if (n <= 0) {
    const parts = v.split(sep);
    if (n === 0) while (parts.length && parts[parts.length - 1] === '') parts.pop();
    return parts;
  }
  const parts = [];
  let start = 0;
  while (parts.length < n - 1) {
    const at = v.indexOf(sep, start);
    if (at < 0) break;
    parts.push(v.slice(start, at));
    start = at + sep.length;
  }
  parts.push(v.slice(start));
  return parts;
};`,
  repeatString: `const repeatString = (v, count) => {
  if (typeof v !== 'string' || typeof count !== 'number' || !Number.isFinite(count)) throw new TypeError('invalid string repetition');
  return v.repeat(Math.trunc(count));
};`,
  sliceAfterArray: `const sliceAfterArray = (v, pattern) => {
  if (!Array.isArray(v)) throw new TypeError('slice_after requires an array');
  const groups = [];
  let group = [];
  for (const item of v) {
    group.push(item);
    const hit = pattern instanceof RegExp ? (typeof item === 'string' && pattern.test(item)) : item === pattern;
    if (hit) { groups.push(group); group = []; }
  }
  if (group.length) groups.push(group);
  return groups;
};`,
  sliceListCount: `const sliceListCount = (v, n, drop = false) => {
  const invalid = () => { throw new Error(drop ? 'AP-MIGRATION-INVALID-DROP' : 'AP-MIGRATION-INVALID-TAKE'); };
  if (!Array.isArray(v) || typeof n !== 'number' || !Number.isFinite(n)) invalid();
  const count = Math.trunc(n);
  if (!Number.isSafeInteger(count) || count < 0) invalid();
  return drop ? v.slice(count) : v.slice(0, count);
};`,
  join: `const join = (v, sep) => {
  if (sep == null) sep = '';
  if (typeof sep !== 'string') throw new Error('AP-MIGRATION-INVALID-JOIN');
  const combine = (items) => items.map((x) => Array.isArray(x) ? combine(x) : x == null ? '' : String(x)).join(sep);
  return combine(list(v));
};`,
  upcase: `const upcase = (v) => String(v ?? '').toUpperCase();`,
  downcase: `const downcase = (v) => String(v ?? '').toLowerCase();`,
  flatten: `const flatten = (v) => list(v).flat(Infinity);`,
  len: `const len = (v) => (Array.isArray(v) || typeof v === 'string' ? v.length : blank(v) ? 0 : Object.keys(v).length);`,
  add: `const add = (left, right) => (typeof left === 'number' ? left + Number(right) : String(left ?? '') + String(right ?? ''));`,
  zonedWall: `const zonedWall = (ms, tz) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(ms);
  const n = (name) => Number(parts.find((p) => p.type === name)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) + ((ms % 1000) + 1000) % 1000;
};`,
  zonedResolve: `const zonedResolve = (wall, tz) => {
  const offsets = new Set([-2, 0, 2].map((days) => {
    const probe = wall + days * 86400000;
    return zonedWall(probe, tz) - probe;
  }));
  const candidates = [...offsets].map((offset) => wall - offset).filter((ms) => zonedWall(ms, tz) === wall);
  if (candidates.length !== 1) throw new Error('AP-MIGRATION-AMBIGUOUS-DATE: local time is ambiguous or nonexistent');
  return { ms: candidates[0], tz };
};`,
  zonedShift: `const zonedShift = (v, n, unit) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('AP-MIGRATION-INVALID-DATE-SHIFT');
  const factors = { hours: 3600000, minutes: 60000, seconds: 1000 };
  if (factors[unit]) {
    const ms = v.ms + n * factors[unit];
    if (!Number.isFinite(ms) || Number.isNaN(new Date(ms).getTime())) throw new Error('AP-MIGRATION-INVALID-DATE-SHIFT');
    return { ms, tz: v.tz };
  }
  if (!Number.isSafeInteger(n)) throw new Error('AP-MIGRATION-INVALID-DATE-SHIFT');
  const date = new Date(zonedWall(v.ms, v.tz));
  if (unit === 'days' || unit === 'weeks') date.setUTCDate(date.getUTCDate() + n * (unit === 'weeks' ? 7 : 1));
  else if (unit === 'months' || unit === 'years') {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + n * (unit === 'years' ? 12 : 1));
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  } else throw new Error('AP-MIGRATION-INVALID-DATE-SHIFT');
  if (Number.isNaN(date.getTime())) throw new Error('AP-MIGRATION-INVALID-DATE-SHIFT');
  return zonedResolve(date.getTime(), v.tz);
};`,
  addCal: `const addCal = (v, n, unit) => {
  const tagged = v && typeof v === 'object' && typeof v.ms === 'number';
  if (tagged && typeof v.tz === 'string') return zonedShift(v, n, unit);
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
  durationSeconds: `const durationSeconds = (unit, n) => {
  const factors = { seconds: 1, minutes: 60, hours: 3600, days: 86400,
    weeks: 604800, months: 2629746, years: 31556952 };
  const factor = factors[unit];
  if (!factor || typeof n !== 'number' || !Number.isFinite(n) ||
      (Number.isInteger(n) && !Number.isSafeInteger(n))) {
    throw new Error('AP-MIGRATION-INVALID-DURATION: duracao exige numero representavel sem perda.');
  }
  const seconds = n * factor;
  if (!Number.isFinite(seconds) || (Number.isInteger(seconds) && !Number.isSafeInteger(seconds))) {
    throw new Error('AP-MIGRATION-INVALID-DURATION: segundos fora da faixa representavel sem perda.');
  }
  return seconds;
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
  if (tz == null) tz = 'UTC';
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
  const invalid = () => { throw new Error('AP-MIGRATION-INVALID-RANGE'); };
  const string = typeof v === 'string';
  if (!string && !Array.isArray(v)) return invalid();
  const seq = string ? Array.from(v) : v;
  const len = seq.length;
  const norm = (i) => {
    if (typeof i !== 'number' || !Number.isFinite(i)) return invalid();
    const n = Math.trunc(i);
    if (!Number.isSafeInteger(n)) return invalid();
    return n < 0 ? len + n : n;
  };
  const a = from === null ? 0 : norm(from);
  const b = to === null ? len : norm(to) + (exclusive ? 0 : 1);
  if (a < 0 || a > len) return null;
  const result = b < a ? [] : seq.slice(a, Math.min(b, len));
  return string ? result.join('') : result;
};`,
  whereNot: `const whereNot = (v, field, op, expected) => list(v).filter((item) => !where([item], field, op, expected).length);`,
  indexOf: `const indexOf = (v, needle) => {
  const i = list(v).findIndex((item) => item === needle || String(item) === String(needle));
  return i < 0 ? null : i;
};`,
  sumOf: `const sumOf = (v) => {
  const invalid = () => { throw new Error('AP-MIGRATION-INVALID-SUM'); };
  if (!Array.isArray(v)) return invalid();
  if (!v.length) return 0;
  const kind = typeof v[0];
  if (kind !== 'number' && kind !== 'string') return invalid();
  return v.reduce((acc, item) => {
    if (typeof item !== kind || (kind === 'number' && !Number.isFinite(item))) return invalid();
    const result = acc + item;
    if (kind === 'number' && !Number.isFinite(result)) return invalid();
    return result;
  }, kind === 'string' ? '' : 0);
};`,
  countOf: `const countOf = (v, needle) => {
  if (!Array.isArray(v)) throw new Error('AP-MIGRATION-INVALID-COUNT');
  return v.reduce((acc, item) => acc + (includes([item], needle) ? 1 : 0), 0);
};`,
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
  if (from < 0 || from > seq.length || size < 0) return null;
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
  // RFC 1321; UTF-8 String -> lowercase hex, using only V8 intrinsics.
  md5Hex: `const md5Hex = (value) => {
  if (typeof value !== 'string') throw new Error('${INVALID_DIGEST_INPUT}');
  const bytes = [];
  for (const character of value) {
    const cp = character.codePointAt(0);
    if (cp >= 0xd800 && cp <= 0xdfff) throw new Error('${INVALID_DIGEST_INPUT}');
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >>> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >>> 12), 0x80 | ((cp >>> 6) & 63), 0x80 | (cp & 63));
    else bytes.push(0xf0 | (cp >>> 18), 0x80 | ((cp >>> 12) & 63), 0x80 | ((cp >>> 6) & 63), 0x80 | (cp & 63));
  }
  const size = Math.ceil((bytes.length + 9) / 64) * 64;
  const words = Array(size / 4).fill(0);
  for (let i = 0; i < bytes.length; i++) words[i >>> 2] |= bytes[i] << ((i & 3) * 8);
  words[bytes.length >>> 2] |= 0x80 << ((bytes.length & 3) * 8);
  words[words.length - 2] = (bytes.length * 8) >>> 0;
  words[words.length - 1] = Math.floor(bytes.length / 0x20000000) >>> 0;
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const rotations = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
  const constants = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];
  for (let block = 0; block < words.length; block += 16) {
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const sum = (a + f + constants[i] + words[block + g]) | 0;
      const shift = rotations[i >>> 4][i & 3];
      const rotated = (sum << shift) | (sum >>> (32 - shift));
      a = d; d = c; c = b; b = (b + rotated) | 0;
    }
    state[0] = (state[0] + a) | 0;
    state[1] = (state[1] + b) | 0;
    state[2] = (state[2] + c) | 0;
    state[3] = (state[3] + d) | 0;
  }
  return state.map((word) => [0, 8, 16, 24].map((shift) => ((word >>> shift) & 255).toString(16).padStart(2, '0')).join('')).join('');
};`,
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
  dig: ['at'],
  rubyAnd: ['truthy'],
  rubyOr: ['truthy'],
  toDateFmt: ['toDate'],
  gsubLit: ['gsub'],
  gsubHash: ['gsub'],
  toCurrencyFmt: ['toCurrency'],
  toCsv: ['list'],
  countryName: ['isoCountries'],
  countryAlpha3: ['isoCountries'],
  inspect: ['floatText'],
  toS: ['inspect', 'floatText'],
  floatOut: ['floatText'],
  formatMap: ['toS'],
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
  countOf: ['includes'],
  maxOf: ['list'],
  minOf: ['list'],
  boundOf: ['datePart', 'inZone'],
  zonedResolve: ['zonedWall'],
  zonedShift: ['zonedWall', 'zonedResolve'],
  addCal: ['zonedShift'],
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
  /** Resultado Float do Ruby: gravado como texto, sai `1500.0`, não `1500`. */
  float?: boolean;
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
  | { kind: 'ident'; value: string; synthetic?: boolean }
  | { kind: 'op'; value: string };

const OPERATORS = [
  '...', '..', '&.', '===', '==', '!=', '>=', '<=', '||', '&&', '<<', '=>', '**',
  '?', ':', '.', ',', '(', ')', '[', ']', '{', '}', '|', ';', '+', '-', '*', '/', '%', '>', '<', '!',
];

const RUBY_STRING_ENCODER = new TextEncoder();
type RubyEscapeBytes = { bytes: number[]; end: number };

function rubyDoubleEscapeBytes(src: string, start: number, flags = 0): RubyEscapeBytes | null {
  const cp = src.codePointAt(start + 1);
  if (cp === undefined || (cp >= 0xd800 && cp <= 0xdfff)) return null;
  const next = String.fromCodePoint(cp);
  let end = start + 1 + next.length;
  const bytes = (text: string): number[] => [...RUBY_STRING_ENCODER.encode(text)];
  if (next === '\n') return { bytes: [], end };
  if (next === '\r' && src[end] === '\n') return { bytes: [], end: end + 1 };
  if (next === 'u') {
    if (flags) return null;
    let points: string[];
    if (src[end] === '{') {
      const close = src.indexOf('}', end + 1);
      if (close < 0) return null;
      const body = src.slice(end + 1, close);
      if (!/^[ \t\v\f\r]*(?:[0-9a-fA-F]{1,6}(?:[ \t\v\f\r]+[0-9a-fA-F]{1,6})*)?[ \t\v\f\r]*$/.test(body)) return null;
      points = body.trim() ? body.trim().split(/[ \t\v\f\r]+/) : [];
      end = close + 1;
    } else {
      const point = src.slice(end).match(/^[0-9a-fA-F]{4}/)?.[0];
      if (!point) return null;
      points = [point];
      end += point.length;
    }
    const codepoints = points.map((point) => Number.parseInt(point, 16));
    if (codepoints.some((point) => point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff))) return null;
    return { bytes: codepoints.flatMap((point) => bytes(String.fromCodePoint(point))), end };
  }
  if (/[0-7]/.test(next)) {
    const digits = src.slice(start + 1).match(/^[0-7]{1,3}/)![0];
    return { bytes: [Number.parseInt(digits, 8) & 0xff], end: start + 1 + digits.length };
  }
  if (next === 'x') {
    const digits = src.slice(end).match(/^[0-9a-fA-F]{1,2}/)?.[0];
    return digits ? { bytes: [Number.parseInt(digits, 16)], end: end + digits.length } : null;
  }
  if (next === 'c' || next === 'C' || next === 'M') {
    const flag = next === 'M' ? 2 : 1;
    if (flags & flag) return null;
    if (next !== 'c') {
      if (src[end] !== '-') return null;
      end++;
    }
    let value: number;
    if (src[end] === '\\') {
      if (src[end + 1] === 'u' || src[end + 1] === 'U') return null;
      const nested = rubyDoubleEscapeBytes(src, end, flags | flag);
      if (!nested || nested.bytes.length !== 1) return null;
      value = nested.bytes[0]!;
      end = nested.end;
    } else {
      const operand = src.codePointAt(end);
      if (operand === undefined || operand > 0x7f ||
          (operand < 0x20 && ![9, 10, 11, 12, 13].includes(operand)) || operand === 0x7f) return null;
      end++;
      if (operand === 13 && src[end] === '\n') end++;
      value = operand === 13 && src[end - 1] === '\n' ? 10 : operand;
      if (flag === 1 && value === 63) return { bytes: [127], end };
    }
    return { bytes: [flag === 2 ? value | 0x80 : value & 0x9f], end };
  }
  const escapes: Record<string, string> = {
    a: '\u0007', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f',
    r: '\r', e: '\u001b', s: ' ',
  };
  return { bytes: bytes(escapes[next] ?? next), end };
}

/** Decode consecutive escapes as UTF-8 bytes; invalid binary strings stay incomplete. */
export function decodeRubyStringEscape(src: string, start: number, quote: '"' | "'"): { value: string; end: number } | null {
  if (src[start] !== '\\') return null;
  const bytes: number[] = [];
  let end = start;
  while (src[end] === '\\') {
    let decoded: RubyEscapeBytes | null;
    if (quote === "'") {
      const cp = src.codePointAt(end + 1);
      if (cp === undefined || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      let next = String.fromCodePoint(cp);
      let nextEnd = end + 1 + next.length;
      if (next === '\r' && src[nextEnd] === '\n') { next = '\n'; nextEnd++; }
      const value = next === "'" || next === '\\' ? next : '\\' + next;
      decoded = { bytes: [...RUBY_STRING_ENCODER.encode(value)], end: nextEnd };
    } else {
      decoded = rubyDoubleEscapeBytes(src, end);
    }
    if (!decoded) return null;
    bytes.push(...decoded.bytes);
    end = decoded.end;
  }
  try {
    // ignoreBOM preserves a BOM as data instead of silently consuming it.
    return { value: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new Uint8Array(bytes)), end };
  } catch {
    return null;
  }
}

/** An already-rendered native expression is opaque to Ruby, including its pills. */
function nativeFormulaAt(src: string, start: number): { value: string; end: number } | null {
  const prefix = 'ap-formula-v1::{', suffix = '}::ap-formula-v1';
  if (!src.startsWith(prefix, start)) return null;
  const end = src.indexOf(suffix, start + prefix.length);
  if (end < 0) return null;
  const body = src.slice(start + prefix.length, end);
  if (!body.trim() || body.includes(prefix)) return null;
  let quote: string | undefined;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") quote = ch;
  }
  if (quote) return null;
  return { value: src.slice(start, end + suffix.length), end: end + suffix.length };
}

/** Aspas duplas do Ruby interpolam `#{...}`. Aspas simples não. */
function scanString(src: string, i: number, percent?: { open: string; close: string; interpolate: boolean }): { tokens: Token[]; end: number; interpolated: boolean } | null {
  const quote = percent ? (percent.interpolate ? '"' : "'") : src[i]!;
  if (quote !== '"' && quote !== "'") return null;
  const close = percent?.close ?? quote;
  let depth = 1;
  let j = i + 1;
  let literal = '';
  const tokens: Token[] = [];
  let interpolated = false;
  const pushLiteral = () => {
    if (!literal) return;
    if (tokens.length) tokens.push({ kind: 'op', value: '+' });
    tokens.push({ kind: 'string', value: literal });
    literal = '';
  };
  const pushInterpolation = (inner: Token[]) => {
    pushLiteral();
    if (tokens.length) tokens.push({ kind: 'op', value: '+' });
    // A Ruby interpolation is a grouped expression converted to a string.
    // Reuse the existing parser and to_s helper; evaluate the inner only once.
    tokens.push(
      { kind: 'op', value: '(' }, ...inner, { kind: 'op', value: ')' },
      { kind: 'op', value: '.' }, { kind: 'ident', value: 'to_s', synthetic: true },
    );
  };
  while (j < src.length) {
    if (src[j] === '\\') {
      if (percent && !percent.interpolate) {
        const next = src[j + 1];
        if (next === undefined) return null;
        literal += next === percent.open || next === close || next === '\\' ? next : '\\' + next;
        j += 2;
        continue;
      }
      const decoded = decodeRubyStringEscape(src, j, quote);
      if (decoded === null) return null;
      literal += decoded.value;
      j = decoded.end;
      continue;
    }
    if (src[j] === '\r' && src[j + 1] === '\n') {
      literal += '\n';
      j += 2;
      continue;
    }
    // Native AP formulas are already rendered input expressions, not Ruby.
    // Bind the complete wrapper so its quotes/pills/question marks stay opaque.
    if (src.startsWith('ap-formula-v1::{', j)) {
      const native = nativeFormulaAt(src, j);
      if (!native) return null;
      interpolated = true;
      pushInterpolation([{ kind: 'pill', value: native.value }]);
      j = native.end;
      continue;
    }
    if (src.startsWith('{{', j)) {
      interpolated = true;
      const end = src.indexOf('}}', j + 2);
      if (end < 0) return null;
      pushInterpolation([{ kind: 'pill', value: src.slice(j, end + 2) }]);
      j = end + 2;
      continue;
    }
    if (quote === '"' && src.startsWith('#{', j)) {
      interpolated = true;
      const end = interpolationEnd(src, j + 2);
      if (end < 0) return null;
      const innerSrc = src.slice(j + 2, end).trim();
      if (innerSrc) {
        const inner = tokenize(innerSrc);
        if (!inner) return null;
        pushInterpolation(inner);
      }
      // An empty interpolation contributes no text; preserve the pending literal.
      j = end + 1;
      continue;
    }
    if (percent && percent.open !== close && src[j] === percent.open) {
      depth++;
      literal += src[j++];
      continue;
    }
    if (src[j] === close && --depth === 0) {
      if (!tokens.length) tokens.push({ kind: 'string', value: literal });
      else pushLiteral();
      // A string remains one atom, so a following method applies to all parts.
      const grouped: Token[] = tokens.length > 1
        ? [{ kind: 'op', value: '(' }, ...tokens, { kind: 'op', value: ')' }]
        : tokens;
      return { tokens: grouped, end: j + 1, interpolated };
    }
    literal += src[j];
    j++;
  }
  return null;
}

/** A bounded String-only subset: never percent shell/array/regex literals. */
function scanPercentString(src: string, start: number): ReturnType<typeof scanString> {
  if (src[start] !== '%') return null;
  let delimiter = start + 1;
  const kind = src[delimiter];
  if (kind === 'q' || kind === 'Q') delimiter++;
  const open = src[delimiter];
  if (!open || !'([{<!|/'.includes(open)) return null;
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' };
  return scanString(src, delimiter, { open, close: pairs[open] ?? open, interpolate: kind !== 'q' });
}

/** Read a static literal at a known offset, sharing the compiler's string grammar. */
export function parseRubyStringLiteralAt(src: string, start: number): { value: string; end: number } | null {
  const scanned = scanString(src, start);
  if (!scanned || scanned.interpolated || scanned.tokens.length !== 1) return null;
  const token = scanned.tokens[0]!;
  return token.kind === 'string' ? { value: token.value, end: scanned.end } : null;
}

/** A complete static Ruby string literal; interpolation is handled as a formula. */
export function parseRubyStringLiteral(source: string): string | null {
  const src = source.trim();
  const parsed = parseRubyStringLiteralAt(src, 0);
  return parsed?.end === src.length ? parsed.value : null;
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
    if (src.startsWith('ap-formula-v1::{', j)) {
      const native = nativeFormulaAt(src, j);
      if (!native) return -1;
      j = native.end;
      continue;
    }
    const ch = src[j]!;
    if (ch === '%') {
      const percent = scanPercentString(src, j);
      if (percent) { j = percent.end; continue; }
    }
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
    if (ch === '%') {
      const prev = prevMeaningful();
      const valuePosition = !prev ||
        (prev.kind === 'op' && ![')', ']', '}', '.', '&.'].includes(prev.value)) ||
        (prev.kind === 'ident' && ['if', 'elsif', 'then', 'else', 'not', 'and', 'or'].includes(prev.value));
      if (valuePosition) {
        const percent = scanPercentString(src, i);
        if (!percent) return null;
        // Retain percent syntax as a grouped atom, not a quoted Symbol/label.
        tokens.push({ kind: 'op', value: '(' }, ...percent.tokens, { kind: 'op', value: ')' });
        i = percent.end;
        continue;
      }
    }
    if (src.startsWith('ap-formula-v1::{', i)) {
      const native = nativeFormulaAt(src, i);
      if (!native) return null;
      tokens.push({ kind: 'pill', value: native.value });
      i = native.end;
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
      // Ruby joins adjacent quoted literals before applying a postfix method.
      // Keep the complete String as one atom, including interpolated parts.
      const parts = [...scanned.tokens];
      let end = scanned.end;
      let adjacent = false;
      for (;;) {
        let next = end;
        for (;;) {
          if (/[ \t\f\v]/.test(src[next] ?? '') && next < src.length) { next++; continue; }
          if (src.startsWith('\\\n', next)) { next += 2; continue; }
          if (src.startsWith('\\\r\n', next)) { next += 3; continue; }
          break;
        }
        if (src[next] !== '"' && src[next] !== "'") break;
        const following = scanString(src, next);
        if (!following) return null;
        parts.push({ kind: 'op', value: '+' }, ...following.tokens);
        adjacent = true;
        end = following.end;
      }
      tokens.push(...(adjacent ? [{ kind: 'op' as const, value: '(' }, ...parts, { kind: 'op' as const, value: ')' }] : parts));
      i = end;
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
          // Dynamic Ruby patterns are not literal JS RegExp source. Refuse
          // until interpolation/dialect have an exact lowering contract.
          if (src.startsWith('#{', j) || src.startsWith('{{', j)) return null;
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
      const m = src.slice(i).match(/^(\d(?:_?\d)*)(?:\.(\d(?:_?\d)*))?(?:[eE]([+-]?\d(?:_?\d)*))?/)!;
      const consumed = m[0].length;
      const separators = m[0].includes('_');
      for (let group = 0; group < m.length; group++) {
        if (m[group] !== undefined) m[group] = m[group]!.replace(/_/g, '');
      }
      // Ruby leading-zero integers may be octal; do not introduce decimal
      // coercion for that syntax while extending only decimal separators.
      if (separators && m[1]!.length > 1 && m[1]!.startsWith('0')) return null;
      const number = Number(m[0]);
      // Ruby Integer tem precisao arbitraria; JS Number nao preserva esses tokens.
      const float = m[2] !== undefined || m[3] !== undefined;
      if (!Number.isFinite(number) || (!float && !Number.isSafeInteger(number))) return null;
      let literal = m[0];
      if (m[3] !== undefined) {
        // Expand the decimal spelling, retaining the existing explicit Float
        // hints for division and hash identity without adding a runtime type.
        if (number === 0) literal = '0.0';
        else {
          const digits = m[1]! + (m[2] ?? '');
          const point = m[1]!.length + Number(m[3]);
          literal = point <= 0 ? `0.${'0'.repeat(-point)}${digits}`
            : point >= digits.length ? `${digits}${'0'.repeat(point - digits.length)}.0`
            : `${digits.slice(0, point)}.${digits.slice(point)}`;
          literal = literal.replace(/^0+(?=\d)/, '');
        }
      }
      tokens.push({ kind: 'number', value: literal });
      i += consumed;
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

/** Methods are lexical candidates. A ternary also requires complete supported
 * syntax, without evaluating CODE. String text, pills and AP wrappers stay opaque. */
export function rubySyntaxFeatures(source: string): { methods: string[]; ternary: boolean } | null {
  const tokens = tokenize(source.trim().replace(/^=/, '').trim());
  if (!tokens) return null;
  const methods = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]!, name = tokens[i + 1]!;
    if (token.kind === 'op' && (token.value === '.' || token.value === '&.') && name.kind === 'ident' && !name.synthetic) {
      methods.add(name.value);
    }
  }
  let ternary = tokens.some(t => t.kind === 'op' && t.value === '?') &&
    tokens.some(t => t.kind === 'op' && t.value === ':');
  if (ternary) {
    const registry = newBindingRegistry();
    const state: State = { tokens, pos: 0, bindings: registry.bindings, pillNames: registry.pillNames,
      helpers: new Set(), approximations: [], seq: registry.seq, dynamic: false };
    ternary = parseExpr(state) !== null && state.pos === tokens.length;
  }
  return { methods: [...methods], ternary };
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
  /** Syntax-proven text types only; never inferred from unknown datapill values. */
  textHints?: Map<string, TextHint>;
  /** Values whose Ruby identity cannot be compared after JSON lowering. */
  nonJsonComparisons?: Set<string>;
  /** A known Float nested in an expression without usable text hints. */
  lostFloatText?: Set<string>;
}

type TextHint = 'int' | 'float' | 'string' | 'symbol' | 'unrepresented' | { array: (TextHint | null)[] } |
  { object: Record<string, TextHint | null>; rubyKeys?: 'symbol' | 'unsupported' };

function textHint(js: string, s: State): TextHint | null {
  while (js.startsWith('(') && js.endsWith(')')) js = js.slice(1, -1);
  const stored = s.textHints?.get(js);
  if (stored) return stored;
  if (/^"(?:\\.|[^"\\])*"$/.test(js)) return 'string';
  const scalar = numTy(js);
  return scalar === 'any' ? null : scalar;
}

function rememberTextHint(js: string, hint: TextHint, s: State): string {
  while (js.startsWith('(') && js.endsWith(')')) js = js.slice(1, -1);
  (s.textHints ??= new Map()).set(js, hint);
  return js;
}

function textCall(target: string, s: State, inspecting = false): string {
  const hint = textHint(target, s);
  let js: string;
  if (hint === 'float') {
    useHelper(s, 'floatText');
    js = `floatText(${target})`;
  } else {
    const helper = inspecting ? 'inspect' : 'toS';
    useHelper(s, helper);
    js = `${helper}(${target}${hint ? `, ${JSON.stringify(hint)}` : ''})`;
  }
  rememberTextHint(js, 'string', s);
  return js;
}

function numericTextHint(js: string, left: string, right: string, s: State): string {
  const l = textHint(left, s), r = textHint(right, s);
  if (l === 'float' || r === 'float') rememberTextHint(js, 'float', s);
  else if (l === 'int' && r === 'int') rememberTextHint(js, 'int', s);
  return js;
}

function numericType(js: string, s: State): 'int' | 'float' | 'any' {
  const hint = textHint(js, s);
  return hint === 'int' || hint === 'float' ? hint : 'any';
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

function jsonComparable(js: string, s: State): boolean {
  while (js.startsWith('(') && js.endsWith(')')) js = js.slice(1, -1);
  return !s.nonJsonComparisons?.has(js);
}

function markNonJsonComparison(js: string, s: State): string {
  let key = js;
  while (key.startsWith('(') && key.endsWith(')')) key = key.slice(1, -1);
  (s.nonJsonComparisons ??= new Set()).add(key);
  if (textHint(js, s) === null) rememberTextHint(js, 'unrepresented', s);
  return js;
}

function inheritJsonComparison(js: string, inputs: string[], s: State): string {
  if (inputs.some((input) => !jsonComparable(input, s))) markNonJsonComparison(js, s);
  if (inputs.some((input) => hasLostFloatText(input, s))) markLostFloatText(js, s);
  return js;
}

function hasLostFloatText(js: string, s: State): boolean {
  while (js.startsWith('(') && js.endsWith(')')) js = js.slice(1, -1);
  return s.lostFloatText?.has(js) ?? false;
}

function markLostFloatText(js: string, s: State): string {
  let key = js;
  while (key.startsWith('(') && key.endsWith(')')) key = key.slice(1, -1);
  (s.lostFloatText ??= new Set()).add(key);
  return js;
}

function hintContainsFloat(hint: TextHint | null): boolean {
  if (hint === 'float') return true;
  if (hint && typeof hint === 'object') {
    return 'array' in hint ? hint.array.some(hintContainsFloat) : Object.values(hint.object).some(hintContainsFloat);
  }
  return false;
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
    if (!['%d', '%m', '%Y', '%y', '%H', '%M', '%S', '%I', '%p', '%z', '%Z', '%k', '%l', '%L', '%b', '%B', '%a', '%A', '%j', '%e', '%w', '%u', '%%'].includes(two)) return false;
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

function calendarCall(target: string, method: string, s: State): string | null {
  const unit = calendarUnit(method);
  if (!unit) return null;
  if (['day', 'month', 'year'].includes(method) && numericType(target, s) === 'any') {
    useHelper(s, 'datePart');
    return `datePart(${target}, '${method}')`;
  }
  return `__cal('${unit}', ${target})`;
}

/** Metodos sem argumento. */
const NULLARY: Record<string, (target: string, s: State) => string> = {
  to_s: (t, s) => textCall(t, s),
  inspect: (t, s) => textCall(t, s, true),
  to_i: (t, s) => (useHelper(s, 'toI'), `toI(${t})`),
  to_f: (t, s) => (useHelper(s, 'toF'), `toF(${t})`),
  strip: (t, s) => (useHelper(s, 'strip'), `strip(${t})`),
  upcase: (t, s) => (useHelper(s, 'upcase'), `upcase(${t})`),
  downcase: (t, s) => (useHelper(s, 'downcase'), `downcase(${t})`),
  flatten: (t, s) => (useHelper(s, 'flatten'), `flatten(${t})`),
  presence: (t, s) => (useHelper(s, 'presence'), `presence(${t})`),
  in_time_zone: (t, s) => (useHelper(s, 'inZone'), `inZone(${t}, "America/Los_Angeles")`),
  'present?': (t, s) => (useHelper(s, 'blank'), `!blank(${t})`),
  'blank?': (t, s) => (useHelper(s, 'blank'), `blank(${t})`),
  'empty?': (t, s) => (useHelper(s, 'blank'), `blank(${t})`),
  'nil?': (t) => `(${t} === null || ${t} === undefined)`,
  length: (t, s) => (useHelper(s, 'len'), `len(${t})`),
  size: (t, s) => (useHelper(s, 'len'), `len(${t})`),
  count: (t, s) => {
    const range = rangeMarker(t);
    if (range && textHint(range.left, s) !== 'float' && textHint(range.right, s) !== 'float') {
      useHelper(s, 'rangeCount');
      return rememberTextHint(
        `rangeCount(${range.left}, ${range.right}, ${range.exclusive})`,
        'int',
        s,
      );
    }
    useHelper(s, 'len');
    return `len(${t})`;
  },
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
  to_json: (t, s) => rememberTextHint(`JSON.stringify(${t})`, 'string', s),
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
  keys: (t) => `Object.keys(${t} ?? {})`,
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
  md5_hexdigest: (t, s) => (useHelper(s, 'md5Hex'), rememberTextHint(`md5Hex(${t})`, 'string', s)),
  to_country_alpha3: (t, s) => (useHelper(s, 'countryAlpha3'), `countryAlpha3(${t})`),
  scrub: (t, s) => (s.approximations.push('scrub troca o caractere invalido por vazio.'), useHelper(s, 'scrub'), `scrub(${t})`),
  to_csv: (t, s) => (useHelper(s, 'toCsv'), `toCsv(${t})`),
  split: (t, s) => (useHelper(s, 'split'), `split(${t}, ' ')`),
};

/** Metodos com argumentos. */
function applyCall(target: string, method: string, args: Arg[], s: State): string | null {
  const plain = args.filter((a) => a.kind === 'value').map((a) => a.js);
  const pairs = args.filter((a): a is HashArg => a.kind === 'hash');
  if (!plain.length && !pairs.length && calendarUnit(method)) return calendarCall(target, method, s);
  if (!plain.length && !pairs.length && NULLARY[method]) return NULLARY[method]!(target, s);

  switch (method) {
    case 'where':
    case 'whereNot': {
      if (!pairs.length || plain.length) return null;
      const helper = method === 'whereNot' ? 'whereNot' : 'where';
      useHelper(s, helper);
      return pairs.reduce(
        (acc, pair) => `${helper}(${acc}, ${jsString(pair.field)}, ${jsString(pair.op)}, ${pair.js})`,
        target,
      );
    }
    case 'pluck': {
      if (!plain.length || pairs.length) return null;
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
      if (pairs.length) return null;
      if (plain.length === 2) {
        const separator = parseRubyStringLiteral(plain[0]!);
        // Regex captures, AWK whitespace and zero-width splits need distinct contracts.
        if (separator === null || separator === '' || separator === ' ') return null;
        useHelper(s, 'splitLiteralLimit');
        return `splitLiteralLimit(${target}, ${plain[0]}, ${plain[1]})`;
      }
      if (plain.length !== 1) return null;
      useHelper(s, 'split');
      return `split(${target}, ${plain[0]})`;
    }
    case 'slice_after': {
      if (pairs.length || plain.length !== 1) return null;
      const pattern = plain[0]!;
      if (parseRubyStringLiteral(pattern) === null && !pattern.startsWith('new RegExp(')) return null;
      // Fuse only explicit materialization, preserving refusal of arbitrary Enumerators.
      if (!eatOp(s, '.')) return null;
      const materialize = peek(s);
      if (materialize?.kind !== 'ident' || materialize.value !== 'to_a') return null;
      s.pos++;
      if (eatOp(s, '(') && !eatOp(s, ')')) return null;
      useHelper(s, 'sliceAfterArray');
      return `sliceAfterArray(${target}, ${pattern})`;
    }
    case 'join': {
      if (pairs.length || plain.length > 1) return null;
      useHelper(s, 'join');
      return `join(${target}, ${plain[0] ?? '""'})`;
    }
    case 'smart_join': {
      useHelper(s, 'smartJoin');
      return `smartJoin(${target}, ${plain[0] ?? '""'})`;
    }
    case 'count': {
      if (pairs.length || plain.length !== 1 || !jsonComparable(target, s) || !jsonComparable(plain[0]!, s)) return null;
      useHelper(s, 'countOf');
      return rememberTextHint(`countOf(${target}, ${plain[0]})`, 'int', s);
    }
    case 'include?':
    case 'exclude?': {
      if (plain.length !== 1 || pairs.length || !jsonComparable(target, s) || !jsonComparable(plain[0]!, s)) return null;
      useHelper(s, 'includes');
      return `${method === 'exclude?' ? '!' : ''}includes(${target}, ${plain[0]})`;
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
      return rememberTextHint(`JSON.stringify(${target})`, 'string', s);
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
      if (pairs.length || plain.length !== 1) return null;
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
    case 'take': {
      if (plain.length !== 1 || pairs.length || hintContainsFloat(textHint(target, s)) || hasLostFloatText(target, s)) return null;
      useHelper(s, 'sliceListCount');
      return `sliceListCount(${target}, ${plain[0]})`;
    }
    case 'drop': {
      if (plain.length !== 1 || pairs.length) return null;
      useHelper(s, 'sliceListCount');
      return `sliceListCount(${target}, ${plain[0]}, true)`;
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
      // Recognize only the existing literal selectors, including their tagged
      // Symbol emission. Do not erase Symbol identity for other method callers.
      const format = ['db', 'iso8601', 'number'].find((name) =>
        plain[0] === jsString(name) || plain[0] === `${jsString(name)} /* Ruby Symbol */`);
      if (format === 'db') {
        useHelper(s, 'strftime');
        return `strftime(${target}, "%Y-%m-%d %H:%M:%S")`;
      }
      if (format === 'iso8601') {
        useHelper(s, 'toDate');
        return `toDate(${target})`;
      }
      if (format === 'number') {
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
    case 'starts_with?':
    case 'end_with?':
    case 'start_with?': {
      const rubyName = method === 'end_with?' || method === 'start_with?';
      if (pairs.length || (!rubyName && plain.length !== 1) || textHint(target, s) === 'symbol' ||
          plain.some((arg) => textHint(arg, s) === 'symbol' || arg.startsWith('new RegExp('))) return null;
      useHelper(s, 'stringAffix');
      return `stringAffix(${target}, [${plain.join(', ')}], ${method === 'starts_with?' || method === 'start_with?'})`;
    }
    case 'format_map': {
      if (plain.length !== 1 || pairs.length || hasLostFloatText(target, s)) return null;
      useHelper(s, 'formatMap');
      const hint = textHint(target, s);
      return rememberTextHint(`formatMap(${target}, ${plain[0]}${hint ? `, ${JSON.stringify(hint)}` : ''})`, { array: [] }, s);
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

function parseArgs(s: State, end: ')' | '}' = ')'): Arg[] | null {
  const args: Arg[] = [];
  if (eatOp(s, end)) return args;
  for (;;) {
    const token = peek(s);
    const next = s.tokens[s.pos + 1];
    const arrow = s.tokens[s.pos + 2];
    if (token?.kind === 'op' && token.value === ':' && (next?.kind === 'ident' || next?.kind === 'string') &&
        arrow?.kind === 'op' && arrow.value === '=>') {
      s.pos += 3;
      const value = parseExpr(s);
      if (value === null) return null;
      const { field, op } = splitFieldOp(next.value);
      args.push({ kind: 'hash', field, op, js: value });
    } else if (
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
    if (eatOp(s, ',')) {
      if (eatOp(s, end)) return args; // one terminal comma, never an empty slot
      continue;
    }
    if (eatOp(s, end)) return args;
    return null;
  }
}

/** where takes one literal condition hash, with optional explicit braces. */
function parseWhereArgs(s: State): Arg[] | null {
  if (!eatOp(s, '{')) return parseArgs(s);
  const args = parseArgs(s, '}');
  eatOp(s, ','); // one trailing comma after the sole explicit hash argument
  if (!args || args.some((arg) => arg.kind !== 'hash') || !eatOp(s, ')')) return null;
  return args;
}

type HashKeyKind = 'symbol' | 'string' | 'integer' | 'float' | 'unknown' | 'unsupported';

/** Preserve somente a identidade demonstravel pela sintaxe da chave. */
function hashKeyKind(tokens: Token[], js: string, s: State): HashKeyKind {
  // Arithmetic/unary hints retain Ruby Integer/Float identity through pills
  // and grouping; do not guess it from a runtime JSON Number.
  const numeric = numericType(js, s);
  if (numeric !== 'any') return numeric === 'int' ? 'integer' : 'float';
  if (js.startsWith('toS(') || js.startsWith('floatText(') || js.startsWith('inspect(')) return 'string';
  if (js.startsWith('toI(') || js.startsWith('len(')) return 'integer';
  if (js.startsWith('toF(')) return 'float';
  let inner = tokens;
  for (;;) {
    const first = inner[0];
    const last = inner[inner.length - 1];
    if (first?.kind !== 'op' || first.value !== '(' || last?.kind !== 'op' || last.value !== ')') break;
    let depth = 0;
    let enclosed = true;
    for (let i = 0; i < inner.length - 1; i++) {
      const token = inner[i]!;
      if (token.kind !== 'op') continue;
      if (token.value === '(') depth++;
      if (token.value === ')' && --depth === 0) { enclosed = false; break; }
    }
    if (!enclosed) break;
    inner = inner.slice(1, -1);
  }
  if (inner.length === 1 && inner[0]?.kind === 'string') return 'string';
  if (inner.length === 2 && inner[0]?.kind === 'op' && inner[0].value === ':' && (inner[1]?.kind === 'ident' || inner[1]?.kind === 'string')) {
    return 'symbol';
  }
  if (inner.some((token) => token.kind === 'number') && inner.every((token) =>
    token.kind === 'number' || (token.kind === 'op' && ['+', '-', '*', '/', '%', '(', ')'].includes(token.value)))) {
    return inner.some((token) => token.kind === 'number' && token.value.includes('.')) ? 'float' : 'integer';
  }
  // Chaves calculadas com simbolos podem perder o tipo ao passar pelo runtime JS.
  if (inner.some((token, index) => token.kind === 'op' && token.value === ':' && inner[index + 1]?.kind === 'ident')) {
    return 'unsupported';
  }
  return 'unknown';
}

function parseHash(s: State): string | null {
  if (!eatOp(s, '{')) return null;
  const entries: { key: string; value: string; kind: HashKeyKind }[] = [];
  if (!eatOp(s, '}')) {
    for (;;) {
      const keyTok = peek(s);
      let key: string | null = null;
      let kind: HashKeyKind = 'unknown';
      const colon = s.tokens[s.pos + 1];
      if (keyTok?.kind === 'ident' && colon?.kind === 'op' && colon.value === ':') {
        s.pos += 2;
        key = jsString(keyTok.value);
        kind = 'symbol';
      } else if (keyTok?.kind === 'op' && keyTok.value === ':') {
        const name = s.tokens[s.pos + 1];
        if (name?.kind !== 'ident' && name?.kind !== 'string') return null;
        s.pos += 2;
        if (!eatOp(s, '=>')) return null;
        key = jsString(name.value);
        kind = 'symbol';
      } else {
        const keyStart = s.pos;
        key = parseEquality(s);
        if (key !== null) kind = hashKeyKind(s.tokens.slice(keyStart, s.pos), key, s);
        if (key === null) return null;
        if (!eatOp(s, '=>')) {
          // Ruby `"label": valor` cria Symbol, diferente de `"label" => valor`.
          if (keyTok?.kind !== 'string' || s.pos !== keyStart + 1 || !eatOp(s, ':')) return null;
          kind = 'symbol';
        }
      }
      const value = parseExpr(s);
      if (value === null || key === null) return null;
      entries.push({ key, value, kind });
      if (eatOp(s, ',')) {
        if (eatOp(s, '}')) break;
        continue;
      }
      if (eatOp(s, '}')) break;
      return null;
    }
  }
  const seen = new Set<string>();
  const asObject = entries.length > 0 && entries.every((entry) => {
    if (entry.kind !== 'string' && entry.kind !== 'symbol') return false;
    if (!/^"(?:\\.|[^"\\])*"$/.test(entry.key)) return false;
    if (entry.key === '"__proto__"' || entry.key === '"constructor"' || entry.key === '"prototype"') return false;
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
  if (asObject) {
    // An annotation keeps distinct source identities distinct in compile-only
    // metadata. It adds no runtime representation of Ruby Symbol/Hash keys.
    const js = `({${entries.map((entry) => `${entry.key}${entry.kind === 'symbol' ? ' /* Ruby Symbol key */' : ''}: ${entry.value}`).join(', ')}})`;
    rememberTextHint(js, {
      object: Object.fromEntries(entries.map((entry) => [JSON.parse(entry.key), textHint(entry.value, s)])),
      ...(entries.some((entry) => entry.kind === 'symbol') ? { rubyKeys: 'symbol' as const } : {}),
    }, s);
    inheritJsonComparison(js, entries.map((entry) => entry.value), s);
    return entries.some((entry) => entry.kind !== 'string' || !jsonComparable(entry.value, s)) ? markNonJsonComparison(js, s) : js;
  }
  useHelper(s, 'rubyHash');
  const js = `rubyHash([${entries.map((entry) => `[${entry.key}, ${entry.value}, ${jsString(entry.kind)}]`).join(', ')}])`;
  const literalFields = entries.every((entry) => (entry.kind === 'string' || entry.kind === 'symbol') && /^"(?:\\.|[^"\\])*"$/.test(entry.key));
  if (literalFields && !entries.some((entry) => hintContainsFloat(textHint(entry.value, s)))) {
    rememberTextHint(js, {
      object: Object.fromEntries(entries.map((entry) => [JSON.parse(entry.key), textHint(entry.value, s)])),
      ...(entries.some((entry) => entry.kind === 'symbol') ? { rubyKeys: 'symbol' as const } : {}),
    }, s);
  } else if (!literalFields) rememberTextHint(js, { object: {}, rubyKeys: 'unsupported' }, s);
  inheritJsonComparison(js, entries.map((entry) => entry.value), s);
  if (entries.some((entry) => hintContainsFloat(textHint(entry.value, s)))) markLostFloatText(js, s);
  return entries.some((entry) => entry.kind !== 'string' || !jsonComparable(entry.value, s)) ? markNonJsonComparison(js, s) : js;
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
    if (name?.kind === 'ident' || name?.kind === 'string') {
      s.pos += 2;
      return rememberTextHint(markNonJsonComparison(`(${jsString(name.value)} /* Ruby Symbol */)`, s), 'symbol', s);
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
        if (eatOp(s, ',')) {
          if (eatOp(s, ']')) break; // Ruby permits one trailing comma, not an empty item.
          continue;
        }
        if (eatOp(s, ']')) break;
        return null;
      }
    }
    const js = `[${items.join(', ')}]`;
    rememberTextHint(js, { array: items.map((item) => textHint(item, s)) }, s);
    inheritJsonComparison(js, items, s);
    return items.some((item) => !jsonComparable(item, s)) ? markNonJsonComparison(js, s) : js;
  }
  if (token.kind === 'ident') {
    s.pos++;
    switch (token.value) {
      // `skip` do Workato = nao preencher o campo. `undefined` some do objeto
      // devolvido pelo CODE, que e o mais proximo no AP.
      case 'skip':
        s.approximations.push('skip do Workato virou undefined para omitir o campo no objeto devolvido pelo CODE');
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
  const receiverStart = s.pos;
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
        target = inheritJsonComparison(guard(applied), [target, ...args.map((arg) => arg.js)], s);
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
          target = inheritJsonComparison(guard(numericTextHint(`add(${target}, ${arg})`, target, arg, s)), [target, arg], s);
        } else if (name.value === '-') {
          useHelper(s, 'minus');
          target = guard(numericTextHint(`minus(${target}, ${arg})`, target, arg, s));
        } else if (name.value === '*') {
          useHelper(s, 'mul');
          s.approximations.push(MULTIPLY_NOTE);
          target = guard(numericTextHint(`mul(${target}, ${arg})`, target, arg, s));
        } else {
          useHelper(s, 'div');
          target = guard(numericTextHint(`div(${target}, ${arg}, ${jsString(numericType(target, s))}, ${jsString(numericType(arg, s))})`, target, arg, s));
        }
        continue;
      }
      if (name?.kind !== 'ident') return null;
      s.pos += 2;
      if (name.value === 'md5_hexdigest' && textHint(target, s) === 'symbol') return null;
      // Plain JS numbers cannot preserve known Ruby Float spelling in JSON.
      if (name.value === 'to_json' && (hintContainsFloat(textHint(target, s)) || hasLostFloatText(target, s))) return null;

      // Known Float values in compound receivers lose their Ruby type when
      // represented as plain JSON/JS numbers. Refuse text conversion rather
      // than silently print an Integer. Literal/to_f scalars retain a hint.
      if (
        (name.value === 'to_s' || name.value === 'inspect') &&
        hasLostFloatText(target, s) &&
        !/^rubyRound\(/.test(target.trim())
      ) {
        return null;
      }
      if ((name.value === 'to_s' || name.value === 'inspect' || name.value === 'format_map') && textHint(target, s) === null &&
          !/^(?:floatText|toS|inspect)\(/.test(target) &&
          s.tokens.slice(receiverStart, s.pos - 2).some((part) =>
            (part.kind === 'number' && part.value.includes('.')) ||
            (part.kind === 'ident' && part.value === 'to_f'))) return null;

      if (name.value === 'where') {
        const dot = s.tokens[s.pos];
        const nxt = s.tokens[s.pos + 1];
        if (dot?.kind === 'op' && dot.value === '.' && nxt?.kind === 'ident' && nxt.value === 'not') {
          s.pos += 2;
          if (!eatOp(s, '(')) return null;
          const whereNotArgs = parseWhereArgs(s);
          if (!whereNotArgs) return null;
          const applied = applyCall(target, 'whereNot', whereNotArgs, s);
          if (applied === null) return null;
          target = inheritJsonComparison(guard(applied), [target, ...whereNotArgs.map((arg) => arg.js)], s);
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
        const args = name.value === 'where' ? parseWhereArgs(s) : parseArgs(s);
        if (!args) return null;
        const following = peek(s);
        if ((name.value === 'gsub' || name.value === 'sub') && following?.kind === 'op' && following.value === '{') {
          const block = parseGsubBlock(target, name.value, args, s);
          if (block === null) return null;
          target = guard(block);
          continue;
        }
        const applied = applyCall(target, name.value, args, s);
        if (applied === null) return null;
        // Format/projection selectors are consumed; their Symbol identity is
        // not part of the returned values' comparison semantics.
        const comparisonInputs: string[] = (name.value === 'to_s' && args.length === 1) || name.value === 'pluck'
          ? [target] : [target, ...args.map((arg) => arg.js)];
        target = name.value === 'format_map' || name.value === 'present?' || name.value === 'to_json'
          ? guard(applied) : inheritJsonComparison(guard(applied), comparisonInputs, s);
        continue;
      }
      if (calendarUnit(name.value)) {
        target = calendarCall(target, name.value, s)!;
        continue;
      }
      const nullary = NULLARY[name.value];
      if (!nullary) return null;
      const applied = nullary(target, s);
      // present? returns Boolean and to_json String, independently of receiver identity.
      target = name.value === 'present?' || name.value === 'to_json' ? guard(applied) : inheritJsonComparison(guard(applied), [target], s);
      continue;
    }

    if (token.kind === 'op' && token.value === '[') {
      s.pos++;
      const from = parseExpr(s);
      if (from === null) return null;
      const retain = (next: string) => inheritJsonComparison(next, [target!, from], s);
      if (eatOp(s, ',')) {
        const len = parseExpr(s);
        if (len === null || !eatOp(s, ']')) return null;
        if (from.startsWith('new RegExp(')) {
          useHelper(s, 'regexAt');
          target = retain(`regexAt(${target}, ${from}, ${len})`);
        } else {
          useHelper(s, 'sliceLen');
          target = retain(`sliceLen(${target}, ${from}, ${len})`);
        }
        continue;
      }
      if (!eatOp(s, ']')) return null;
      if (from.startsWith('__range(')) {
        if (hintContainsFloat(textHint(target, s)) || hasLostFloatText(target, s)) return null;
        useHelper(s, 'sliceAt');
        target = retain(from.replace('__range(', `sliceAt(${target}, `));
        continue;
      }
      if (/^-?\d+$/.test(from)) {
        useHelper(s, 'at');
        target = retain(`at(${target}, ${from})`);
      } else {
        useHelper(s, 'dig');
        target = retain(`dig(${target}, ${from})`);
      }
      continue;
    }
    return target;
  }
}

function numTy(js: string): 'int' | 'float' | 'any' {
  while (js.startsWith('(') && js.endsWith(')')) js = js.slice(1, -1);
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
    useHelper(s, 'truthy');
    return `!truthy(${inner})`;
  }
  if (eatOp(s, '+')) return parseUnary(s);
  if (eatOp(s, '-')) {
    const inner = parseUnary(s);
    if (inner === null) return null;
    if (/^\d+(\.\d+)?$/.test(inner)) return `-${inner}`;
    const js = `(-(${inner}))`;
    const hint = textHint(inner, s);
    if (hint === 'int' || hint === 'float') rememberTextHint(js, hint, s);
    return js;
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
  return numericTextHint(`pow(${left}, ${right})`, left, right, s);
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
      if (textHint(left, s) === 'string') {
        useHelper(s, 'repeatString');
        left = rememberTextHint(`repeatString(${left}, ${right})`, 'string', s);
        continue;
      }
      useHelper(s, 'mul');
      s.approximations.push(MULTIPLY_NOTE);
      left = numericTextHint(`mul(${left}, ${right})`, left, right, s);
      continue;
    }
    if (op.value === '/') {
      useHelper(s, 'div');
      left = numericTextHint(`div(${left}, ${right}, ${jsString(numericType(left, s))}, ${jsString(numericType(right, s))})`, left, right, s);
      continue;
    }
    useHelper(s, 'mod');
    left = numericTextHint(`mod(${left}, ${right})`, left, right, s);
  }
}

function parseAdditive(s: State): string | null {
  let left = parseMultiplicative(s);
  if (left === null) return null;
  for (;;) {
    const token = peek(s);
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
        left = numericTextHint(`minus(${left}, ${right})`, left, right, s);
        continue;
      }
      // Um helper so: aninhar `String(left)+String(right)` duplica `left` a cada `+`
      // e estoura a memoria numa mensagem longa.
      if (token.value === '<<') useHelper(s, 'append');
      else useHelper(s, 'add');
      left = inheritJsonComparison(token.value === '<<' ? `append(${left}, ${right})` : numericTextHint(`add(${left}, ${right})`, left, right, s), [left, right], s);
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
    const coerce: boolean = numericLiteral(left) !== numericLiteral(right);
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
    if (right === null || !jsonComparable(left, s) || !jsonComparable(right, s)) return null;
    const coerce: boolean = numericLiteral(left) !== numericLiteral(right);
    if (coerce) s.approximations.push(EQ_NOTE);
    useHelper(s, 'eq');
    const same: string = `eq(${left}, ${right}, ${coerce})`;
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
    useHelper(s, 'rubyAnd');
    left = inheritJsonComparison(`rubyAnd(${left}, () => (${right}))`, [left, right], s);
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
    useHelper(s, 'rubyOr');
    left = inheritJsonComparison(`rubyOr(${left}, () => (${right}))`, [left, right], s);
  }
}

function unwrapParens(expr: string): string {
  let bare = expr.trim();
  for (;;) {
    if (!bare.startsWith('(') || !bare.endsWith(')')) return bare;
    let depth = 0;
    let quote: string | null = null;
    for (let i = 0; i < bare.length; i++) {
      const ch = bare[i]!;
      if (quote) {
        if (ch === '\\') {
          i++;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0 && i !== bare.length - 1) return bare;
        if (depth < 0) return bare;
      }
    }
    if (depth !== 0) return bare;
    bare = bare.slice(1, -1).trim();
  }
}

function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts;
}

/** `(left...right)` ainda marcado, inclusive com parenteses em volta. */
function rangeMarker(expr: string): { left: string; right: string; exclusive: boolean } | null {
  const bare = unwrapParens(expr);
  if (!bare.startsWith('__range(') || !bare.endsWith(')')) return null;
  const parts = splitTopLevel(bare.slice('__range('.length, -1));
  if (parts.length !== 3 || (parts[2] !== 'true' && parts[2] !== 'false')) return null;
  return { left: parts[0]!, right: parts[1]!, exclusive: parts[2] === 'true' };
}

function parseRange(s: State): string | null {
  const first = peek(s);
  const beginless = first?.kind === 'op' && (first.value === '..' || first.value === '...');
  const left = beginless ? 'null' : parseOr(s);
  if (left === null) return null;
  const token = peek(s);
  if (token?.kind !== 'op' || (token.value !== '..' && token.value !== '...')) return left;
  s.pos++;
  const next = peek(s);
  const endless = !next || (next.kind === 'op' && [']', ')', ',', ';'].includes(next.value));
  if (beginless && endless) return null;
  const right = endless ? 'null' : parseOr(s);
  if (right === null) return null;
  return `__range(${left}, ${right}, ${token.value === '...'})`;
}

/** Branches have ternary precedence; parentheses may contain lower-precedence
 * keyword operators/sequences. Keep the existing full if-expression branch. */
function parseTernaryBranch(s: State): string | null {
  const first = peek(s);
  return first?.kind === 'ident' && first.value === 'if' ? parseIf(s) : parseTernary(s);
}

function parseTernary(s: State): string | null {
  const condition = parseRange(s);
  if (condition === null) return null;
  if (!eatOp(s, '?')) return condition;
  // Recursive branches preserve Ruby's right associativity without consuming
  // an outer `and`, `or` or `;` into the selected branch.
  const truthy = parseTernaryBranch(s);
  if (truthy === null || !eatOp(s, ':')) return null;
  const falsy = parseTernaryBranch(s);
  if (falsy === null) return null;
  useHelper(s, 'truthy');
  return inheritJsonComparison(`(truthy(${condition}) ? (${truthy}) : (${falsy}))`, [truthy, falsy], s);
}

function parseNot(s: State): string | null {
  if (!eatIdent(s, 'not')) return parseTernary(s);
  const inner = parseNot(s);
  if (inner === null) return null;
  useHelper(s, 'truthy');
  return `!truthy(${inner})`;
}

/** Ruby keyword and/or share precedence and associate left to right. */
function parseKeywordOr(s: State): string | null {
  let left = parseNot(s);
  if (left === null) return null;
  for (;;) {
    const token = peek(s);
    if (token?.kind !== 'ident' || (token.value !== 'and' && token.value !== 'or')) return left;
    s.pos++;
    const right = parseNot(s);
    if (right === null) return null;
    const helper = token.value === 'and' ? 'rubyAnd' : 'rubyOr';
    useHelper(s, helper);
    left = inheritJsonComparison(`${helper}(${left}, () => (${right}))`, [left, right], s);
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
  useHelper(s, 'truthy');
  let out = elseExpr;
  for (let i = clauses.length - 1; i >= 0; i--) {
    const clause = clauses[i]!;
    out = inheritJsonComparison(`(truthy(${clause.cond}) ? (${clause.expr}) : (${out}))`, [clause.expr, out], s);
  }
  return out;
}

function parseExpr(s: State): string | null {
  const first = peek(s);
  if (first?.kind === 'ident' && first.value === 'if') return parseIf(s);
  let left = parseKeywordOr(s);
  if (left === null) return null;
  while (eatOp(s, ';')) {
    const next = peek(s);
    if (!next || (next.kind === 'op' && next.value === '}')) break;
    const right = parseKeywordOr(s);
    if (right === null) return null;
    left = inheritJsonComparison(`(${left}, ${right})`, [right], s);
  }
  return left;
}

function splitJoinedStrings(js: string): [string, string] | null {
  if (js.startsWith('(add(') && js.endsWith('))')) js = js.slice(1, -1);
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

/** JSON transforma NaN/Infinity em null, inclusive dentro de arrays e hashes. */
function containsNonFiniteNumber(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (value !== null && typeof value === 'object') return Object.values(value).some(containsNonFiniteNumber);
  return false;
}

/**
 * Compila uma expressao Workato (pills JA convertidas para `{{...}}`) em JS.
 * Devolve `null` quando algum token esta fora do recorte suportado.
 */
export function compileRubyExpression(
  source: string,
  registry: BindingRegistry = newBindingRegistry(),
): CompiledExpr | null {
  // A expressao recusada nao pode deixar inputs sem uso no CODE compartilhado.
  // Mantenha as identidades dos Maps publicos nas compilacoes bem-sucedidas.
  const staged: BindingRegistry = {
    bindings: new Map(registry.bindings),
    pillNames: new Map(registry.pillNames),
    seq: { n: registry.seq.n },
  };
  const compiled = compileRubyExpressionInternal(source, staged);
  if (!compiled) return null;
  registry.bindings.clear();
  for (const [name, pill] of staged.bindings) registry.bindings.set(name, pill);
  registry.pillNames.clear();
  for (const [pill, name] of staged.pillNames) registry.pillNames.set(pill, name);
  registry.seq.n = staged.seq.n;
  return { ...compiled, bindings: registry.bindings };
}

function compileRubyExpressionInternal(source: string, registry: BindingRegistry): CompiledExpr | null {
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
  let expr = parseExpr(state);
  if (expr === null || state.pos !== tokens.length) return null;
  const approximations = [...new Set(state.approximations)];
  const loose = looseDurationSeconds(expr);
  if (loose !== null && registry.bindings.size === before && !usesExistingBinding(expr, registry)) {
    if (!Number.isFinite(loose) || (Number.isInteger(loose) && !Number.isSafeInteger(loose))) return null;
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
  // A whole standalone Duration is serialized as seconds by Workato. Keep
  // calendar markers during parsing so date arithmetic still uses addCal.
  // Do not rewrite markers embedded in compound expressions or string values.
  const standaloneDuration = parseCalDuration(expr);
  if (standaloneDuration && !/\b__cal\(/.test(standaloneDuration.n)) {
    useHelper(state, 'durationSeconds');
    expr = `durationSeconds('${standaloneDuration.unit}', ${standaloneDuration.n})`;
    if (standaloneDuration.unit === 'months' || standaloneDuration.unit === 'years') {
      approximations.push('Duracao solta virou segundos. 1.month e 1.year usam a media do ActiveSupport.');
    }
  }
  if (/\b__cal\(/.test(expr) || /\b__range\(/.test(expr)) return null;
  const float = textHint(expr, state) === 'float';
  if (registry.bindings.size === before && !usesExistingBinding(expr, registry)) {
    if (state.dynamic) {
      return { expr, bindings: registry.bindings, helpers: state.helpers, approximations };
    }
    try {
      const value = new Function(`${renderHelpers(state.helpers)}\nreturn (${expr});`)();
      if (containsNonFiniteNumber(value)) return null;
      return {
        expr,
        bindings: registry.bindings,
        helpers: state.helpers,
        approximations,
        constant: true,
        value,
        ...(float ? { float } : {}),
      };
    } catch (error) {
      if (error instanceof Error && (error.message === INVALID_HASH_KEY || error.message === INVALID_DIGEST_INPUT || error.message === 'divided by 0' ||
          error.message === 'AP-MIGRATION-INVALID-MEMBERSHIP' || error.message === 'AP-MIGRATION-INVALID-TAKE' || error.message === 'AP-MIGRATION-INVALID-DROP' || error.message === 'AP-MIGRATION-INVALID-RANGE' || error.message === 'AP-MIGRATION-INVALID-FORMAT-MAP')) return null;
      // Fuso anonimo e outros erros so aparecem na execucao.
      return { expr, bindings: registry.bindings, helpers: state.helpers, approximations };
    }
  }

  return {
    expr,
    bindings: registry.bindings,
    helpers: state.helpers,
    approximations,
    ...(float ? { float } : {}),
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
/** `Float#to_s` do Ruby: `1500.0`, `1.0e-05`. */
export function rubyFloatText(value: number): string {
  return new Function('v', `${HELPERS.floatText}\nreturn floatText(v);`)(value) as string;
}

export function renderHelpers(helpers: Set<string>): string {
  return Object.keys(HELPERS)
    .filter((name) => helpers.has(name))
    .map((name) => HELPERS[name]!)
    .join('\n');
}
