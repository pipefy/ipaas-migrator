/** Parse and hoist Workato `lookup` / `data_table_lookup` for tables-find-records. */

export interface LookupFilter {
  column: string;
  /** Raw Workato/Ruby fragment (may include {{pills}}). */
  value: string;
}

export interface ParsedLookup {
  table: string;
  filters: LookupFilter[];
  /** Bracket field after lookup, if any. */
  field: string;
  /** Suffix after brackets, e.g. `.present?`, `.to_f`. */
  suffix: string;
  /** Full matched span in the source expression. */
  span: string;
}

const LOOKUP_START = /\b(?:lookup|data_table_lookup)\s*\(/g;

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
}

/** Balanced `(` starting at `open`; returns index after closing `)` or -1. */
function closeParen(s: string, open: number): number {
  let depth = 0;
  let q: "'" | '"' | null = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function readQuoted(s: string, i: number): { end: number; text: string } | null {
  const q = s[i];
  if (q !== '"' && q !== "'") return null;
  let j = i + 1;
  let out = '';
  while (j < s.length) {
    const c = s[j]!;
    if (c === '\\') {
      out += c + (s[j + 1] ?? '');
      j += 2;
      continue;
    }
    if (c === q) return { end: j + 1, text: out };
    out += c;
    j++;
  }
  return null;
}

/** Read one argument: quoted string, number, or expression until `,` or `)` at depth 0. */
function readArg(s: string, i: number): { end: number; text: string } | null {
  i = skipWs(s, i);
  if (i >= s.length) return null;
  const q = readQuoted(s, i);
  if (q) return { end: q.end, text: s.slice(i, q.end) };
  if (/[0-9]/.test(s[i]!)) {
    let j = i;
    while (j < s.length && /[0-9.]/.test(s[j]!)) j++;
    return { end: j, text: s.slice(i, j) };
  }
  if (s.startsWith('{{', i)) {
    const end = s.indexOf('}}', i + 2);
    if (end < 0) return null;
    return { end: end + 2, text: s.slice(i, end + 2) };
  }
  let depth = 0;
  let str: "'" | '"' | null = null;
  let j = i;
  for (; j < s.length; j++) {
    const c = s[j]!;
    if (str) {
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'") {
      str = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0 && c === ')') break;
      depth--;
      continue;
    }
    if (depth === 0 && (c === ',' || c === ')')) break;
  }
  return { end: j, text: s.slice(i, j).trim() };
}

function readKey(s: string, i: number): { end: number; key: string } | null {
  i = skipWs(s, i);
  const q = readQuoted(s, i);
  if (q) return { end: q.end, key: q.text };
  const m = s.slice(i).match(/^([A-Za-z_][\w]*)/);
  if (!m) return null;
  return { end: i + m[1]!.length, key: m[1]! };
}

function parseLookupArgs(callBody: string, isDataTable: boolean): { table: string; filters: LookupFilter[] } | null {
  let i = skipWs(callBody, 0);
  const tableArg = readArg(callBody, i);
  if (!tableArg) return null;
  i = skipWs(callBody, tableArg.end);
  const filters: LookupFilter[] = [];

  if (isDataTable) {
    if (callBody[i] === ',') {
      i = skipWs(callBody, i + 1);
      const sheet = readArg(callBody, i);
      if (!sheet) return null;
      i = skipWs(callBody, sheet.end);
      // table id for AP is "name" or numeric; sheet name kept as synthetic column namespace — use sheet as table suffix in display only.
      // Workato: data_table_lookup(workspace, tableName, COL: val) -> table_id = tableName, filter on COL.
      const table = sheet.text.trim();
      while (callBody[i] === ',') {
        i = skipWs(callBody, i + 1);
        const key = readKey(callBody, i);
        if (!key) break;
        i = skipWs(callBody, key.end);
        if (callBody[i] !== ':') return null;
        i = skipWs(callBody, i + 1);
        const val = readArg(callBody, i);
        if (!val) return null;
        filters.push({ column: key.key, value: val.text.trim() });
        i = skipWs(callBody, val.end);
      }
      return { table, filters };
    }
    return null;
  }

  const table = tableArg.text.trim();
  while (callBody[i] === ',') {
    i = skipWs(callBody, i + 1);
    const key = readKey(callBody, i);
    if (!key) break;
    i = skipWs(callBody, key.end);
    if (callBody[i] !== ':') return null;
    i = skipWs(callBody, i + 1);
    const val = readArg(callBody, i);
    if (!val) return null;
    filters.push({ column: key.key, value: val.text.trim() });
    i = skipWs(callBody, val.end);
  }
  if (!filters.length) return null;
  return { table, filters };
}

function readBracketField(s: string, i: number): { end: number; field: string } | null {
  i = skipWs(s, i);
  if (s[i] !== '[') return { end: i, field: '' };
  i++;
  const q = readQuoted(s, i);
  if (!q) return null;
  i = skipWs(s, q.end);
  if (s[i] !== ']') return null;
  return { end: i + 1, field: q.text };
}

/** Parse one lookup/data_table_lookup call starting at index of `l` in `lookup`. */
export function parseLookupAt(source: string, start: number): ParsedLookup | null {
  const head = source.slice(start);
  const isData = head.startsWith('data_table_lookup');
  const open = source.indexOf('(', start);
  if (open < 0) return null;
  const close = closeParen(source, open);
  if (close < 0) return null;
  const callBody = source.slice(open + 1, close - 1);
  const args = parseLookupArgs(callBody, isData);
  if (!args) return null;
  const bracket = readBracketField(source, close);
  if (!bracket) return null;
  let suffix = source.slice(bracket.end);
  // Stop suffix at operators that belong outside the lookup subexpression.
  const suffixEnd = suffix.search(/(?:\s*\|\||\s*&&|\s+\?|\s*#|\s*\+|\s*==)/);
  if (suffixEnd > 0) suffix = suffix.slice(0, suffixEnd);
  const span = source.slice(start, bracket.end + suffix.length);
  return {
    table: args.table,
    filters: args.filters,
    field: bracket.field,
    suffix: suffix.trim(),
    span,
  };
}

/** Whole-field `lookup(...)[field].suffix` (legacy contract). */
export function parseWholeLookupFormula(source: string): ParsedLookup | null {
  const trimmed = source.trim().replace(/^=\s*/, '');
  const start = trimmed.search(/\b(?:lookup|data_table_lookup)\s*\(/);
  if (start < 0) return null;
  if (trimmed.slice(0, start).trim()) return null;
  const parsed = parseLookupAt(trimmed, start);
  if (!parsed) return null;
  if (trimmed.slice(parsed.span.length).trim()) return null;
  return parsed;
}

export type LookupHoistEmit = (lookup: ParsedLookup) => string;

/**
 * Replace embedded lookup calls (innermost first) with pills returned by `emit`.
 * Preserves `.present?` / `.to_f` suffixes on the pill via `suffix` on the parsed span.
 */
export function hoistEmbeddedLookups(source: string, emit: LookupHoistEmit): string {
  let out = source;
  for (;;) {
    LOOKUP_START.lastIndex = 0;
    const matches: { start: number; parsed: ParsedLookup }[] = [];
    let m: RegExpExecArray | null;
    while ((m = LOOKUP_START.exec(out))) {
      const parsed = parseLookupAt(out, m.index);
      if (parsed) matches.push({ start: m.index, parsed });
    }
    if (!matches.length) break;
    const last = matches[matches.length - 1]!;
    const pill = emit(last.parsed);
    const replacement = last.parsed.suffix ? `${pill}${last.parsed.suffix}` : pill;
    out = out.slice(0, last.start) + replacement + out.slice(last.start + last.parsed.span.length);
  }
  return out;
}
