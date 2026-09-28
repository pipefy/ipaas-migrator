# Sem dependência — blocos sem pacote

Retrato, não contrato. O motor e o traduzir-code emitem `xlsx`. Estes blocos substituem esse pacote.

O script `scripts/sem-dependencia.mjs` já troca o template do motor (`import * as XLSX`, `inputs.csv`, `wd_data`). O que sobrar em `manual` usa os blocos abaixo.

Não usar `exceljs` nem `xlsx` aqui. `packageJson` fica `{}`.

## CSV para xlsx

Quando o original gera um `.xlsx` de uma tabela CSV. Visto na receita `46740012` (card `1448579797`): `step_3` faz `pandas.read_csv` + `to_excel` e devolve `excel_content`; `step_5` faz `openpyxl` `Workbook.save` e devolve `encoded_xlsx_content`. Os dois recebem CSV em base64 e o nome da aba.

O worker do iPaaS descarta `packageJson.dependencies` quando `ALLOW_NPM_PACKAGES_IN_CODE_STEP` está desligada. O arquivo abaixo é OOXML (zip sem compressão) e só usa `Buffer`. Um CSV com aspas e vírgula no meio da célula abriu no LibreOffice e voltou com as mesmas linhas.

Limites, de propósito: uma aba, sem coluna de índice, toda célula como texto. Casa com `csv.reader` + `openpyxl`. O `to_excel` do pandas pode gravar número como número; aqui o `10` continua texto. Várias abas, estilo, gráfico ou `index=True`: não usar este bloco, deixar o stub.

Decodificar base64 só se o original decodifica. O nome da chave de retorno é o do `return` original (`excel_content`, `encoded_xlsx_content`, …). Nome de aba: no máximo 31 caracteres, e `: \ / ? * [ ]` viram espaço.

```js
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text);
    const nameBuf = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(Buffer.concat([local, nameBuf, data]));
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += locals[locals.length - 1].length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnName(index) {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetName(name) {
  const cleaned = String(name || 'Sheet1').replace(/[:\\/?*[\]]/g, ' ').trim();
  return (cleaned || 'Sheet1').slice(0, 31);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}

function csvToXlsxBase64(csvText, name) {
  const rows = parseCsv(csvText);
  const sheet = sheetName(name);
  const sheetData = rows.map((cells, rowIndex) => {
    const refs = cells.map((value, colIndex) => {
      const text = xmlEscape(value);
      const space = value !== String(value).trim() ? ' xml:space="preserve"' : '';
      return `<c r="${columnName(colIndex)}${rowIndex + 1}" t="inlineStr"><is><t${space}>${text}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}">${refs}</row>`;
  }).join('');
  const zip = zipStore([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEscape(sheet)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`],
    ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${sheetData}</sheetData>
</worksheet>`],
  ]);
  return zip.toString('base64');
}

export const code = async (inputs) => {
  const { file_content, sheet_name } = inputs.code_input.data;
  const csv = Buffer.from(file_content, 'base64').toString('utf8');
  return { excel_content: csvToXlsxBase64(csv, sheet_name) };
};
```

Copiar as funções para dentro do step. Trocar a chave do `return` pela do original. CSV que já chega como texto não passa pelo `Buffer.from(..., 'base64')`.

## Xlsx para CSV

O bloco abaixo importa `node:zlib`. O sandbox ST não tem `zlib`. Nesse ambiente, não copiar o import: o script já troca o template do motor pelo leitor com `inflateRaw` no próprio step. Para outro step de leitura, gerar esse leitor e adaptar a entrada e a chave do `return`:

```bash
npx tsx -e "import { xlsxToCsvPureCode } from './engine/lib/xlsx-csv.ts'; console.log(xlsxToCsvPureCode(''))"
```

## Xlsx para CSV (com zlib)

Quando o original lê uma aba e devolve o CSV dela. Visto na receita `55161670` (card `1448579773`): `step_6` e `step_26` fazem `pandas.read_excel` + `to_csv(index=False, header=True)` e devolvem `csv`. Entrada: xlsx em base64 e o nome da aba.

Este leitor usa `node:zlib`. Não colocar pacote no `packageJson`. No sandbox ST, usar o leitor do comando acima, que traz o inflate no step. Abre zip store e deflate, shared string, inline string, número, booleano e data com `numFmtId` de data.

Conferido: um `.xlsx` gerado pelo LibreOffice (zip deflate, shared strings) voltou `nome,valor` / `Ana, B` / `Bob,20`. Uma célula data serial `43845` com formato 14 virou `2020-01-15`.

Diferenças em relação ao pandas, de propósito: número sai como está no XML (`10`, `10.5`), não reclassificado em inteiro/float; data sem hora sai `YYYY-MM-DD` (o `to_csv` do pandas às vezes acrescenta ` 00:00:00`); booleano sai `True`/`False`. A primeira linha da aba é o cabeçalho. Sem coluna de índice. Quebra de linha no fim, como o `to_csv`.

Aba com outro nome que não existe: o step lança `sheet not found`. Arquivo que não é zip OOXML (`.xls` antigo): lança `not an xlsx zip`. Não tentar adivinhar.

```js
import { inflateRawSync } from 'node:zlib';

const BUILTIN_DATE = new Set(['14', '15', '16', '17', '18', '19', '20', '21', '22', '45', '46', '47']);

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error('not an xlsx zip');
}

function unzip(buf) {
  const eocd = findEocd(buf);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip central');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + localNameLen + localExtraLen;
    const comp = buf.subarray(dataOff, dataOff + compSize);
    let data;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = inflateRawSync(comp);
    else throw new Error(`zip method ${method}`);
    if (!name.endsWith('/')) files.set(name.replace(/^\//, ''), data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function decodeXml(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attr(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return match ? decodeXml(match[1]) : '';
}

function sharedStrings(xml) {
  const out = [];
  for (const si of xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) || []) {
    out.push([...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join(''));
  }
  return out;
}

function isDateFormat(id, custom) {
  if (BUILTIN_DATE.has(id)) return true;
  const code = custom.get(id);
  if (!code) return false;
  const stripped = decodeXml(code).replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
  return /[ydhs]/i.test(stripped) || /am\/pm/i.test(stripped);
}

function dateStyleIndexes(stylesXml) {
  const custom = new Map();
  const xml = stylesXml || '';
  for (const tag of xml.match(/<numFmt\b[^>]*\/>/g) || []) {
    const id = attr(tag, 'numFmtId');
    const code = attr(tag, 'formatCode');
    if (id) custom.set(id, code);
  }
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  const indexes = new Set();
  if (!block) return indexes;
  [...block[1].matchAll(/<xf\b[^>]*>/g)].forEach((match, index) => {
    if (isDateFormat(attr(match[0], 'numFmtId'), custom)) indexes.add(String(index));
  });
  return indexes;
}

function columnIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function excelSerialToText(serial, date1904) {
  const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
  const days = Math.floor(serial);
  const fraction = serial - days;
  const date = new Date(epoch + days * 86400000);
  const seconds = Math.round(fraction * 86400);
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = seconds % 60;
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const da = String(date.getUTCDate()).padStart(2, '0');
  if (hh === 0 && mm === 0 && ss === 0) return `${y}-${mo}-${da}`;
  return `${y}-${mo}-${da} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function cellText(inner, type, style, strings, dates, date1904) {
  if (type === 'inlineStr') {
    return [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('');
  }
  const value = decodeXml((/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner) || [])[1] || '');
  if (type === 's') return strings[Number(value)] ?? '';
  if (type === 'b') return value === '1' ? 'True' : 'False';
  if (type === 'e') return value;
  if (dates.has(style) && value !== '' && !Number.isNaN(Number(value))) {
    return excelSerialToText(Number(value), date1904);
  }
  return value;
}

function parseSheet(xml, strings, dates, date1904) {
  const grid = [];
  for (const rowXml of xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) || []) {
    const open = /^<row\b([^>]*)>/.exec(rowXml);
    const rowIndex = Number(attr(open[1], 'r')) - 1;
    const row = [];
    const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    for (let match = cellRe.exec(rowXml); match; match = cellRe.exec(rowXml)) {
      const tag = match[1] || match[2];
      const inner = match[3] || '';
      const ref = attr(tag, 'r');
      const col = ref ? columnIndex(ref.replace(/\d/g, '')) : row.length;
      row[col] = cellText(inner, attr(tag, 't'), attr(tag, 's'), strings, dates, date1904);
      if (rowIndex >= 0) grid[rowIndex] = row;
    }
    if (rowIndex >= 0 && !grid[rowIndex]) grid[rowIndex] = row;
  }
  return grid;
}

function csvField(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function gridToCsv(grid) {
  const rows = [];
  let width = 0;
  for (let i = 0; i < grid.length; i++) {
    const row = grid[i] || [];
    rows.push(row);
    width = Math.max(width, row.length);
  }
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell == null || cell === '')) rows.pop();
  if (rows.length === 0) return '';
  return `${rows.map((row) => {
    const cells = [];
    for (let i = 0; i < width; i++) cells.push(csvField(row[i] ?? ''));
    return cells.join(',');
  }).join('\n')}\n`;
}

function sheetPath(target) {
  const clean = target.replace(/\\/g, '/').replace(/^\//, '');
  if (clean.startsWith('xl/')) return clean;
  return `xl/${clean.replace(/^\.\//, '')}`;
}

function xlsxSheetToCsv(file, sheetName) {
  const files = unzip(file);
  const workbook = files.get('xl/workbook.xml');
  if (!workbook) throw new Error('not an xlsx zip');
  const workbookXml = workbook.toString('utf8');
  const date1904 = /date1904="1"/.test(workbookXml);
  const rels = (files.get('xl/_rels/workbook.xml.rels') || Buffer.from('')).toString('utf8');
  let target = '';
  for (const tag of workbookXml.match(/<sheet\b[^>]*\/?>/g) || []) {
    if (attr(tag, 'name') !== sheetName) continue;
    const id = attr(tag, 'r:id') || attr(tag, 'id');
    const rel = new RegExp(`<Relationship\\b[^>]*Id="${id}"[^>]*\\/?>`).exec(rels);
    if (!rel) break;
    target = attr(rel[0], 'Target');
    break;
  }
  if (!target) throw new Error(`sheet not found: ${sheetName}`);
  const sheet = files.get(sheetPath(target));
  if (!sheet) throw new Error(`sheet not found: ${sheetName}`);
  const strings = files.has('xl/sharedStrings.xml') ? sharedStrings(files.get('xl/sharedStrings.xml').toString('utf8')) : [];
  const dates = dateStyleIndexes((files.get('xl/styles.xml') || Buffer.from('')).toString('utf8'));
  return gridToCsv(parseSheet(sheet.toString('utf8'), strings, dates, date1904));
}

export const code = async (inputs) => {
  const { file_content, sheet_name } = inputs.code_input.data;
  const file = Buffer.from(file_content, 'base64');
  return { csv: xlsxSheetToCsv(file, sheet_name) };
};
```

Copiar o import e as funções para dentro do step. A chave do `return` é a do original (`csv` nesse caso). Conteúdo que já é binário não passa de novo pelo base64.
