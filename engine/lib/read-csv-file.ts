// parse_csv de um arquivo (URL) vira @activepieces/piece-csv read_csv_file 0.5.0.
// Saída: { rows, row_count, headers, delimiter }. Conteúdo inline ou fórmula continua no Code.

import { csvSchemaNames } from './csv-parse.ts';

export const CSV_PIECE = '@activepieces/piece-csv';
export const CSV_PIECE_VERSION = '0.5.0';
export const CSV_READ_ACTION = 'read_csv_file';

const PURE_DP = /^\s*=?\s*(?:#\{)?\s*_dp\('((?:\\'|[^'])*)'\)\s*\}?\s*$/;
const FILE_URL_TAILS = new Set(['report_value', 'url', 'download_url', 'file_url', 'public_url']);
const READ_FILE_CONTENT_TAILS = new Set(['file_contents', 'content', 'body']);

export interface CsvDatapill {
  line?: string;
  path: unknown[];
}

export interface ReadCsvNativePlan {
  delimiter: string;
  hasHeaderRow: true;
  /** `column_N` (índice Workato) → nome do header_schema. */
  segmentAlias: Map<string, string>;
}

export function csvDatapill(value: unknown): CsvDatapill | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(PURE_DP);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1].replace(/\\'/g, "'")) as { line?: unknown; path?: unknown };
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      line: parsed.line == null ? undefined : String(parsed.line),
      path: Array.isArray(parsed.path) ? parsed.path : [],
    };
  } catch {
    return null;
  }
}

function lastString(path: unknown[]): string | undefined {
  for (let i = path.length - 1; i >= 0; i--) {
    const segment = path[i];
    if (typeof segment === 'string' && segment !== '') return segment;
  }
  return undefined;
}

function flag(value: unknown): boolean {
  return value === true || /^(true|yes|1)$/i.test(String(value ?? '').trim());
}

/** URL literal ou pill cujo último segmento é o arquivo (anexo, url). */
export function isDirectCsvFileSource(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return true;
  const pill = csvDatapill(trimmed);
  if (!pill) return false;
  const tail = lastString(pill.path);
  return tail != null && FILE_URL_TAILS.has(tail);
}

/**
 * Pill do corpo do `read_file` (`file_contents` / `body`).
 * O `line` é o `as` do passo que o parse consome.
 */
export function readFileContentLine(value: unknown): string | null {
  const pill = csvDatapill(value);
  if (!pill?.line) return null;
  const tail = lastString(pill.path);
  if (!tail || !READ_FILE_CONTENT_TAILS.has(tail)) return null;
  return pill.line;
}

/** Delimitador do dropdown do piece. `null`: separador que o piece não declara → Code. */
export function readCsvDelimiter(raw: unknown): string | null {
  const value = String(raw ?? '').trim();
  const lower = value.toLowerCase();
  if (value === '' || lower === 'auto' || lower === 'comma' || value === ',') return 'auto';
  const named: Record<string, string> = { semicolon: ';', tab: '\t', '\\t': '\t', pipe: '|' };
  if (named[lower]) return named[lower];
  if (value === ';' || value === '\t' || value === '|') return value;
  return null;
}

function defaultQuote(raw: unknown): boolean {
  if (raw == null || raw === '') return true;
  return String(raw) === '"';
}

/**
 * Plano nativo quando o CSV é um arquivo e a 1ª linha é cabeçalho.
 * Índice com `header_schema` troca `column_N` pelo nome. Sem isso, o Code preserva `column_N`.
 */
export function readCsvNativePlan(input: Record<string, unknown> | undefined): ReadCsvNativePlan | null {
  if (!input || !isDirectCsvFileSource(input.csv_content)) return null;
  if (!defaultQuote(input.quote_char)) return null;
  const delimiter = readCsvDelimiter(input.col_sep);
  if (delimiter == null) return null;
  if (!flag(input.skip_first_line)) return null;

  const mode = String(input.column_value_by ?? 'index').trim().toLowerCase();
  const byIndex = mode === '' || mode === 'index';
  const names = csvSchemaNames(input.header_schema);
  if (byIndex && names.length === 0) return null;

  const segmentAlias = new Map<string, string>();
  if (byIndex) {
    names.forEach((name, index) => segmentAlias.set(`column_${index}`, name));
  }
  return { delimiter, hasHeaderRow: true, segmentAlias };
}
