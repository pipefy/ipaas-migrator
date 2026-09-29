# Sem dependência — blocos sem pacote

Retrato, não contrato. O motor emite o leitor puro em `read_excel` + `to_csv`. Estes blocos cobrem o que sobrar, sem pacote e sem lib do Node.

O script `scripts/sem-dependencia.mjs` já troca o template do motor (`import * as XLSX`, `inputs.csv`, `wd_data`). O que sobrar em `manual` usa os blocos abaixo.

Não usar `exceljs` nem `xlsx` aqui. `packageJson` fica `{}`.

## CSV para xlsx

Quando o original gera um `.xlsx` de uma tabela CSV. Visto na receita `46740012` (card `1448579797`): `step_3` faz `pandas.read_csv` + `to_excel` e devolve `excel_content`; `step_5` faz `openpyxl` `Workbook.save` e devolve `encoded_xlsx_content`. Os dois recebem CSV em base64 e o nome da aba.

O worker do iPaaS descarta `packageJson.dependencies` quando `ALLOW_NPM_PACKAGES_IN_CODE_STEP` está desligada. O sandbox desse worker não define `Buffer`, `atob`, `btoa` nem `TextDecoder`. O arquivo abaixo é OOXML (zip sem compressão) em `Uint8Array`. Um CSV com aspas e vírgula no meio da célula abriu no LibreOffice e voltou com as mesmas linhas.

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

function utf8Bytes(value) {
  const encoded = unescape(encodeURIComponent(String(value)));
  const out = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) out[i] = encoded.charCodeAt(i) & 255;
  return out;
}

function bytesToUtf8(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  try {
    return decodeURIComponent(escape(out));
  } catch (error) {
    return out;
  }
}

function concatBytes(parts) {
  let len = 0;
  for (const part of parts) len += part.length;
  const out = new Uint8Array(len);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function putU16(buf, offset, value) {
  buf[offset] = value & 255;
  buf[offset + 1] = (value >>> 8) & 255;
}

function putU32(buf, offset, value) {
  buf[offset] = value & 255;
  buf[offset + 1] = (value >>> 8) & 255;
  buf[offset + 2] = (value >>> 16) & 255;
  buf[offset + 3] = (value >>> 24) & 255;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (bytes[i] << 16) | (b << 8) | c;
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >>> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

function base64ToBytes(raw) {
  const clean = String(raw).replace(/[^A-Za-z0-9+/]/g, '');
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    out.push((a << 2) | (b >> 4));
    if (c >= 0) out.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) out.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(out);
}

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = utf8Bytes(text);
    const nameBuf = utf8Bytes(name);
    const crc = crc32(data);
    const local = new Uint8Array(30);
    putU32(local, 0, 0x04034b50);
    putU16(local, 4, 20);
    putU32(local, 14, crc);
    putU32(local, 18, data.length);
    putU32(local, 22, data.length);
    putU16(local, 26, nameBuf.length);
    const entry = concatBytes([local, nameBuf, data]);
    locals.push(entry);
    const central = new Uint8Array(46);
    putU32(central, 0, 0x02014b50);
    putU16(central, 4, 20);
    putU16(central, 6, 20);
    putU32(central, 16, crc);
    putU32(central, 20, data.length);
    putU32(central, 24, data.length);
    putU16(central, 28, nameBuf.length);
    putU32(central, 42, offset);
    centrals.push(concatBytes([central, nameBuf]));
    offset += entry.length;
  }
  const centralDir = concatBytes(centrals);
  const eocd = new Uint8Array(22);
  putU32(eocd, 0, 0x06054b50);
  putU16(eocd, 8, files.length);
  putU16(eocd, 10, files.length);
  putU32(eocd, 12, centralDir.length);
  putU32(eocd, 16, offset);
  return concatBytes([...locals, centralDir, eocd]);
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
  return bytesToBase64(zip);
}

export const code = async (inputs) => {
  const { file_content, sheet_name } = inputs.code_input.data;
  const csv = bytesToUtf8(base64ToBytes(file_content));
  return { excel_content: csvToXlsxBase64(csv, sheet_name) };
};
```

Copiar as funções para dentro do step. Trocar a chave do `return` pela do original. CSV que já chega como texto não passa pelo `base64ToBytes`.

## Xlsx para CSV

Quando o original lê uma aba e devolve o CSV dela. Visto na receita `55161670` (card `1448579773`): `step_6` e `step_26` fazem `pandas.read_excel` + `to_csv(index=False, header=True)` e devolvem `csv`. A receita `59157200` (Validate Excel) devolve `wd_data` e lê `inputs.csv`, aba `Supplier Listing`. O script `sem-dependencia.mjs` já troca o template do motor (`import * as XLSX`, `inputs.csv`, `wd_data`) pelo leitor puro. Para outro step, gerar e adaptar a entrada e a chave do `return`:

```bash
npx tsx -e "import { xlsxToCsvPureCode } from './engine/lib/xlsx-csv.ts'; console.log(xlsxToCsvPureCode(''))"
```

O bloco abaixo é o leitor com data, para o step que o script não reconhece. Não importa `node:zlib` e não chama `Buffer`: o sandbox sem libs não define nenhum dos dois. Abre zip store e deflate, shared string, inline string, número, booleano e data com `numFmtId` de data.

Conferido: um `.xlsx` gerado pelo LibreOffice (zip deflate, shared strings) voltou `nome,valor` / `Ana, B` / `Bob,20`. Uma célula data serial `43845` com formato 14 virou `2020-01-15`.

Diferenças em relação ao pandas, de propósito: número sai como está no XML (`10`, `10.5`), não reclassificado em inteiro/float; data sem hora sai `YYYY-MM-DD` (o `to_csv` do pandas às vezes acrescenta ` 00:00:00`); booleano sai `True`/`False`. A primeira linha da aba é o cabeçalho. Sem coluna de índice. Quebra de linha no fim, como o `to_csv`.

Aba com outro nome que não existe: o step lança `sheet not found`. Arquivo que não é zip OOXML (`.xls` antigo): lança `not an xlsx zip`. Não tentar adivinhar.

```js
function u16(buf, offset) {
  return buf[offset] | (buf[offset + 1] << 8);
}

function u32(buf, offset) {
  return (buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
}

function bytesToUtf8(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  try {
    return decodeURIComponent(escape(out));
  } catch (error) {
    return out;
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToBytes(raw) {
  const clean = String(raw).replace(/[^A-Za-z0-9+/]/g, '');
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : -1;
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : -1;
    out.push((a << 2) | (b >> 4));
    if (c >= 0) out.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) out.push(((c & 3) << 6) | d);
  }
  return new Uint8Array(out);
}

function bits(bytes) {
  let i = 0;
  let buf = 0;
  let n = 0;
  const need = (count) => {
    while (n < count) {
      if (i >= bytes.length) break;
      buf |= bytes[i++] << n;
      n += 8;
    }
  };
  return {
    get: (count) => {
      need(count);
      const value = buf & ((1 << count) - 1);
      buf >>>= count;
      n -= count;
      return value;
    },
    align: () => {
      buf = 0;
      n = 0;
    },
  };
}

function huffman(lengths) {
  const counts = [];
  let max = 0;
  for (const len of lengths) {
    if (!len) continue;
    counts[len] = (counts[len] || 0) + 1;
    if (len > max) max = len;
  }
  const next = [];
  let code = 0;
  counts[0] = 0;
  for (let len = 1; len <= max; len++) {
    code = (code + (counts[len - 1] || 0)) << 1;
    next[len] = code;
  }
  const map = new Map();
  lengths.forEach((len, symbol) => {
    if (!len) return;
    map.set((len << 16) | next[len], symbol);
    next[len]++;
  });
  return (bit) => {
    let value = 0;
    for (let len = 1; len <= max; len++) {
      value = (value << 1) | bit.get(1);
      const symbol = map.get((len << 16) | value);
      if (symbol !== undefined) return symbol;
    }
    return 0;
  };
}

const LEN_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LEN_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

function inflateRaw(bytes) {
  const bit = bits(bytes);
  const out = [];
  let final = 0;
  while (!final) {
    final = bit.get(1);
    const type = bit.get(2);
    if (type === 0) {
      bit.align();
      const len = bit.get(8) | (bit.get(8) << 8);
      bit.get(8);
      bit.get(8);
      for (let n = 0; n < len; n++) out.push(bit.get(8));
      continue;
    }
    let lit;
    let dist;
    if (type === 1) {
      const lens = [];
      for (let i = 0; i < 144; i++) lens.push(8);
      for (let i = 0; i < 112; i++) lens.push(9);
      for (let i = 0; i < 24; i++) lens.push(7);
      for (let i = 0; i < 8; i++) lens.push(8);
      lit = huffman(lens);
      const dl = [];
      for (let i = 0; i < 32; i++) dl.push(5);
      dist = huffman(dl);
    } else {
      const hlit = bit.get(5) + 257;
      const hdist = bit.get(5) + 1;
      const hclen = bit.get(4) + 4;
      const order = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
      const cl = [];
      for (let i = 0; i < hclen; i++) cl[order[i]] = bit.get(3);
      for (let i = hclen; i < 19; i++) cl[order[i]] = 0;
      const codeLen = huffman(cl);
      const lens = [];
      while (lens.length < hlit + hdist) {
        const symbol = codeLen(bit);
        if (symbol < 16) lens.push(symbol);
        else if (symbol === 16) {
          const extra = bit.get(2) + 3;
          const prev = lens[lens.length - 1] || 0;
          for (let n = 0; n < extra; n++) lens.push(prev);
        } else if (symbol === 17) {
          const extra = bit.get(3) + 3;
          for (let n = 0; n < extra; n++) lens.push(0);
        } else {
          const extra = bit.get(7) + 11;
          for (let n = 0; n < extra; n++) lens.push(0);
        }
      }
      lit = huffman(lens.slice(0, hlit));
      dist = huffman(lens.slice(hlit));
    }
    for (;;) {
      const symbol = lit(bit);
      if (symbol < 256) {
        out.push(symbol);
        continue;
      }
      if (symbol === 256) break;
      const len = LEN_BASE[symbol - 257] + bit.get(LEN_EXTRA[symbol - 257]);
      const distanceCode = dist(bit);
      const distance = DIST_BASE[distanceCode] + bit.get(DIST_EXTRA[distanceCode]);
      for (let n = 0; n < len; n++) out.push(out[out.length - distance]);
    }
  }
  return new Uint8Array(out);
}

const BUILTIN_DATE = new Set(['14', '15', '16', '17', '18', '19', '20', '21', '22', '45', '46', '47']);

function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= min; i--) {
    if (u32(buf, i) === 0x06054b50) return i;
  }
  throw new Error('not an xlsx zip');
}

function unzip(buf) {
  const eocd = findEocd(buf);
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error('zip central');
    const method = u16(buf, p + 10);
    const compSize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const localOff = u32(buf, p + 42);
    const name = bytesToUtf8(buf.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    const localNameLen = u16(buf, localOff + 26);
    const localExtraLen = u16(buf, localOff + 28);
    const dataOff = localOff + 30 + localNameLen + localExtraLen;
    const comp = buf.subarray(dataOff, dataOff + compSize);
    let data;
    if (method === 0) data = comp;
    else if (method === 8) data = inflateRaw(comp);
    else throw new Error('zip method ' + method);
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
  const workbookXml = bytesToUtf8(workbook);
  const date1904 = /date1904="1"/.test(workbookXml);
  const rels = bytesToUtf8(files.get('xl/_rels/workbook.xml.rels') || new Uint8Array());
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
  const strings = files.has('xl/sharedStrings.xml') ? sharedStrings(bytesToUtf8(files.get('xl/sharedStrings.xml'))) : [];
  const dates = dateStyleIndexes(bytesToUtf8(files.get('xl/styles.xml') || new Uint8Array()));
  return gridToCsv(parseSheet(bytesToUtf8(sheet), strings, dates, date1904));
}

export const code = async (inputs) => {
  const { file_content, sheet_name } = inputs.code_input.data;
  const file = base64ToBytes(file_content);
  return { csv: xlsxSheetToCsv(file, sheet_name) };
};
```

Copiar as funções para dentro do step. A chave do `return` é a do original (`csv` ou `wd_data`). Conteúdo que já é binário não passa de novo pelo `base64ToBytes`. Na Validate Excel a entrada é `inputs.csv` e o retorno é `{ wd_data }`.
