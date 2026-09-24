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

/** Parser embutido no step. ECMAScript puro, sem pacote (sandbox ST). */
export function csvParseCode(columns: string[]): string {
  const listed = JSON.stringify(columns);
  return `/**
 * parse_csv da Workato. Saida { lines }.
 * column_value_by index nomeia column_0, column_1, … na ordem do header_schema.
 * Por nome, as chaves sao o name do schema. ECMAScript puro, sem pacote.
 */
export const code = async (inputs) => {
  const text = inputs.csv == null ? '' : String(inputs.csv);
  const sep = inputs.separator == null || inputs.separator === '' ? ',' : String(inputs.separator);
  const quote = inputs.quote == null ? '"' : String(inputs.quote);
  const skipFirst = inputs.skipFirstLine === true || inputs.skipFirstLine === 'true';
  const columns = ${listed};
  const rows = parseRows(text, sep, quote);
  const body = skipFirst ? rows.slice(1) : rows;
  const lines = body.map((cells) => {
    const row = {};
    const width = Math.max(columns.length, cells.length);
    for (let i = 0; i < width; i++) {
      const key = columns[i] || ('column_' + i);
      row[key] = cells[i] == null ? '' : String(cells[i]);
    }
    return row;
  });
  return { lines };

  function parseRows(src, separator, quoteChar) {
    const out = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const value = String(src).replace(/^\\uFEFF/, '');
    const sepCh = separator || ',';
    const q = quoteChar || '';
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (quoted) {
        if (q && value.substr(i, q.length) === q) {
          if (value.substr(i + q.length, q.length) === q) {
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
      if (q && cell === '' && value.substr(i, q.length) === q) {
        quoted = true;
        i += q.length - 1;
        continue;
      }
      if (value.substr(i, sepCh.length) === sepCh) {
        row.push(cell);
        cell = '';
        i += sepCh.length - 1;
        continue;
      }
      if (ch === '\\n' || ch === '\\r') {
        if (ch === '\\r' && value[i + 1] === '\\n') i++;
        row.push(cell);
        out.push(row);
        row = [];
        cell = '';
        continue;
      }
      cell += ch;
    }
    if (cell.length || row.length) {
      row.push(cell);
      out.push(row);
    }
    return out;
  }
};
`;
}
