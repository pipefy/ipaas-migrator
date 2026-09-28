// Python `read_excel` + `to_csv` vira Code JS com o pacote `xlsx`.
// `xlsxToCsvPureCode` é o mesmo passo sem npm (zip + inflate no próprio step),
// para a skill sem-dependencia reescrever quando o sandbox não instala pacote.

function xlsxRuntime(sheetName: string): string {
  const sheet = JSON.stringify(sheetName);
  return `// py_eval/invoke_custom_py_code
const sheetName = ${sheet};

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

function unzip(bytes) {
  const files = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 30 < bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLen + extraLen;
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const data = bytes.subarray(start, start + compSize);
    files[name] = method === 0 ? data : inflateRaw(data);
    offset = start + compSize;
  }
  return files;
}

function text(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  try {
    return decodeURIComponent(escape(out));
  } catch (error) {
    return out;
  }
}

function xmlText(source, tag) {
  const found = [];
  const re = new RegExp('<' + tag + '(?:\\\\s[^>]*)?>([\\\\s\\\\S]*?)</' + tag + '>', 'g');
  let match;
  while ((match = re.exec(source))) found.push(match[1]);
  return found;
}

function sheetPath(files) {
  const workbook = text(files['xl/workbook.xml'] || new Uint8Array());
  const rels = text(files['xl/_rels/workbook.xml.rels'] || new Uint8Array());
  const sheets = [...workbook.matchAll(/<sheet\\b[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"/g)];
  const chosen = sheets.find((item) => item[1] === sheetName) || sheets[0];
  if (!chosen) return '';
  const rel = [...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].find((item) => item[1] === chosen[2]);
  if (!rel) return '';
  const target = rel[2].replace(/^\\//, '');
  return target.startsWith('xl/') ? target : 'xl/' + target.replace(/^\\.\\//, '');
}

function shared(files) {
  const source = text(files['xl/sharedStrings.xml'] || new Uint8Array());
  return xmlText(source, 'si').map((item) => xmlText(item, 't').join(''));
}

function rowsOf(xml, strings) {
  return xmlText(xml, 'row').map((row) => {
    const cells = [];
    const re = /<c\\b([^>]*)>([\\s\\S]*?)<\\/c>|<c\\b([^>]*)\\/>/g;
    let match;
    while ((match = re.exec(row))) {
      const attrs = match[1] || match[3] || '';
      const body = match[2] || '';
      const ref = (attrs.match(/r="([A-Z]+)/) || [])[1] || '';
      const col = ref.replace(/[0-9]/g, '').split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const kind = (attrs.match(/t="([^"]+)"/) || [])[1] || '';
      const value = (body.match(/<v>([\\s\\S]*?)<\\/v>/) || [])[1] || '';
      const inline = xmlText(body, 't').join('');
      const textValue = kind === 's' ? strings[Number(value)] || '' : inline || value;
      if (col >= 0) cells[col] = textValue;
    }
    return cells;
  });
}

function csvCell(value) {
  const textValue = value == null ? '' : String(value);
  return /[",\\n]/.test(textValue) ? '"' + textValue.split('"').join('""') + '"' : textValue;
}

export const code = async (inputs) => {
  const raw = String(inputs.csv || '');
  const binary = atob(raw.replace(/\\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const files = unzip(bytes);
  const path = sheetPath(files);
  const xml = text(files[path] || new Uint8Array());
  const table = rowsOf(xml, shared(files));
  const width = table.reduce((max, row) => Math.max(max, row.length), 0);
  const csv = table
    .map((row) => Array.from({ length: width }, (_, index) => csvCell(row[index])).join(','))
    .join('\\n');
  return { wd_data: csv };
};
`;
}

export const XLSX_VERSION = '0.18.5';

export function xlsxPackageJson(): string {
  return JSON.stringify({ dependencies: { xlsx: XLSX_VERSION } });
}

/** Leitor sem pacote. A skill sem-dependencia troca o import de `xlsx` por isto. */
export function xlsxToCsvPureCode(sheetName: string): string {
  return xlsxRuntime(sheetName);
}

export function xlsxToCsvCode(sheetName: string): string {
  const sheet = JSON.stringify(sheetName);
  return `// py_eval/invoke_custom_py_code
import * as XLSX from 'xlsx';

const sheetName = ${sheet};

export const code = async (inputs) => {
  const raw = String(inputs.csv || '');
  const workbook = XLSX.read(raw, { type: 'base64' });
  const name = sheetName || workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error('sheet not found: ' + name);
  return { wd_data: XLSX.utils.sheet_to_csv(sheet) };
};
`;
}

/** Troca o template do motor (import de xlsx, inputs.csv, wd_data) pelo leitor puro. */
export function rewriteEngineXlsxImport(code: string): string | null {
  if (!/import \* as XLSX from 'xlsx'/.test(code)) return null;
  if (!code.includes('XLSX.read') || !code.includes('inputs.csv') || !code.includes('wd_data')) return null;
  const match = code.match(/const sheetName = ("(?:\\.|[^"\\])*")/);
  if (!match) return null;
  let sheet = '';
  try {
    sheet = JSON.parse(match[1]!);
  } catch {
    return null;
  }
  if (typeof sheet !== 'string') return null;
  return xlsxToCsvPureCode(sheet);
}

export function xlsxSheetName(python: string): string {
  const match = python.match(/sheet_name\s*=\s*["']([^"']+)["']/);
  return match?.[1] ?? '';
}

export function isXlsxToCsvPython(python: string): boolean {
  return /read_excel/.test(python) && /to_csv/.test(python) && /b64decode|base64/.test(python);
}
