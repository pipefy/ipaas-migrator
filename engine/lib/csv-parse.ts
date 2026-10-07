// parse_csv da Workato vira Code JS. O piece-csv não declara header_schema:
// has_headers true usa a primeira linha do arquivo; false gera field_1, field_2.
// Com column_value_by index a receita lê column_0, column_1, … em lines[].

export interface CsvParsePlan {
  separator: string;
  quote: string;
  skipFirstLine: boolean;
  /** Chaves de cada linha. Vazio: o Code numera column_N em runtime. */
  columns: string[];
}

function schemaNames(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((field) => (field && typeof field === 'object' ? String(field.name ?? '').trim() : ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function flag(value: unknown): boolean {
  return value === true || /^(true|yes|1)$/i.test(String(value ?? '').trim());
}

export function csvParsePlan(input: Record<string, unknown>): CsvParsePlan {
  const mode = String(input.column_value_by ?? 'index').trim().toLowerCase();
  const byIndex = mode === '' || mode === 'index';
  const names = schemaNames(input.header_schema);
  return {
    separator: typeof input.col_sep === 'string' && input.col_sep !== '' ? input.col_sep : ',',
    quote: typeof input.quote_char === 'string' ? input.quote_char : '"',
    skipFirstLine: flag(input.skip_first_line),
    columns: byIndex ? names.map((_, index) => `column_${index}`) : names,
  };
}

/**
 * Parser embutido no step. ECMAScript puro, sem pacote.
 * Uma so funcao: o sandbox do Code rejeita `function` aninhada
 * (e o compilador trata o helper depois do return como codigo morto).
 */
export function csvParseCode(columns: string[]): string {
  const listed = JSON.stringify(columns);
  return `/**
 * parse_csv da Workato. Saida { lines }.
 * column_value_by index nomeia column_0, column_1, … na ordem do header_schema.
 * Por nome, as chaves sao o name do schema. ECMAScript puro, sem pacote.
 */
export const code = async (inputs) => {
  const box = inputs == null ? {} : inputs;
  let text = box.csv == null ? '' : String(box.csv);
  if (text.charCodeAt(0) === 65279) text = text.slice(1);
  const sep = box.separator == null || box.separator === '' ? ',' : String(box.separator);
  const quote = box.quote == null ? '"' : String(box.quote);
  const skipFirst = box.skipFirstLine === true || box.skipFirstLine === 'true';
  const columns = ${listed};
  const q = quote || '';
  const sepCh = sep || ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (q && text.slice(i, i + q.length) === q) {
        if (text.slice(i + q.length, i + q.length + q.length) === q) {
          cell += q;
          i += q.length * 2 - 1;
        } else {
          quoted = false;
          i += q.length - 1;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (q && cell === '' && text.slice(i, i + q.length) === q) {
      quoted = true;
      i += q.length - 1;
      continue;
    }
    if (text.slice(i, i + sepCh.length) === sepCh) {
      row.push(cell);
      cell = '';
      i += sepCh.length - 1;
      continue;
    }
    if (ch === '\\n' || ch === '\\r') {
      if (ch === '\\r' && text.charAt(i + 1) === '\\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  if (quoted || cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const body = skipFirst ? rows.slice(1) : rows;
  const lines = [];
  for (let r = 0; r < body.length; r++) {
    const cells = body[r] || [];
    const line = {};
    const width = columns.length > cells.length ? columns.length : cells.length;
    for (let c = 0; c < width; c++) {
      const key = columns[c] || ('column_' + c);
      line[key] = c < cells.length && cells[c] != null ? String(cells[c]) : '';
    }
    lines.push(line);
  }
  return { lines };
};
`;
}
