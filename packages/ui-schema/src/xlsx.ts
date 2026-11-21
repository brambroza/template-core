/**
 * Excel files for the bulk imports, with no library: an .xlsx is a ZIP of XML files. Customers keep their item lists, customers
 * and stock counts in Excel; saving as CSV garbles Thai in Excel's default encoding and loses leading zeros, so the import screens
 * read .xlsx directly and hand out the template as .xlsx.
 *
 *   readXlsx(bytes)          first worksheet → string[][] (same shape as parseCsv), dates as YYYY-MM-DD
 *   xlsxTemplate(headers)    a workbook with one header row (bold, frozen, every column text so codes keep their zeros)
 *
 * Browser-safe and dependency-free like the rest of this package: only Uint8Array, TextDecoder/TextEncoder and
 * DecompressionStream('deflate-raw') (every current browser, Node ≥ 18). No formulas are evaluated: a formula cell gives the value
 * Excel saved with it.
 */

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** Thai message for a file that is not a readable .xlsx. */
export class XlsxError extends Error {}

/** Every file in a ZIP archive, by name (stored or deflated entries only — what Excel, LibreOffice and Google Sheets write). */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new XlsxError('ไฟล์นี้ไม่ใช่ไฟล์ Excel (.xlsx) — ถ้าเป็นไฟล์ .xls รุ่นเก่า ให้เปิดใน Excel แล้วบันทึกเป็น .xlsx');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new XlsxError('ไฟล์ Excel เสียหาย อ่านไม่ได้');
    const method = u16(bytes, p + 10);
    const size = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflate(data));
    else throw new XlsxError('ไฟล์ Excel ถูกบีบอัดแบบที่ระบบไม่รองรับ — บันทึกใหม่เป็น .xlsx');
  }
  return out;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** XML text → plain text (entities and Excel's _xHHHH_ escapes). */
export function xmlText(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/_x([0-9A-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
/** all <t> texts inside one element (rich text runs are joined; phonetic <rPh> runs are skipped) */
const texts = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => xmlText(m[1] ?? '')).join('');

/** column letters of a cell reference ("BC12") → 0-based index */
export function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
/** a number format that shows a date (d/m/y tokens outside quotes and brackets, not a pure time) */
export function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dy]/i.test(bare) || /m{3,}/i.test(bare);
}

/** Excel serial day → YYYY-MM-DD (1900 system, Lotus leap-year bug included; or 1904). */
export function serialToIso(serial: number, date1904 = false): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const days = Math.floor(serial + 1e-9);
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** a number as the user typed it (no 0.30000000000000004) */
const plainNumber = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : v;
};

/** First worksheet of an .xlsx file as rows of text cells. Empty trailing cells are trimmed; empty rows in between are kept. */
export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const files = await unzip(bytes);
  const dec = new TextDecoder();
  const file = (name: string) => { const f = files.get(name); return f ? dec.decode(f) : undefined; };

  const workbook = file('xl/workbook.xml');
  if (!workbook) throw new XlsxError('ไฟล์นี้ไม่ใช่ไฟล์ Excel (.xlsx)');
  const date1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/.test(workbook);
  const firstSheet = /<sheet\b[^>]*>/.exec(workbook)?.[0] ?? '';
  const rid = attr(firstSheet, 'r:id');
  const rels = file('xl/_rels/workbook.xml.rels') ?? '';
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, 'Id') === rid);
  let target = (rel && attr(rel, 'Target')) || 'worksheets/sheet1.xml';
  target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sheet = file(target);
  if (!sheet) throw new XlsxError('ไม่พบแผ่นงานในไฟล์ Excel');

  const shared = [...(file('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!));

  const styles = file('xl/styles.xml') ?? '';
  const customFormats = new Map([...styles.matchAll(/<numFmt\b[^>]*>/g)].map((m) => [Number(attr(m[0], 'numFmtId')), xmlText(attr(m[0], 'formatCode') ?? '')]));
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const dateStyle = [...cellXfs.matchAll(/<xf\b[^>]*\/?>/g)].map((m) => {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    return BUILTIN_DATE_FORMATS.has(id) || (customFormats.has(id) && isDateFormat(customFormats.get(id)!));
  });

  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNo = Number(attr(r[1]!, 'r') ?? rows.length + 1);
    while (rows.length < rowNo - 1) rows.push([]);
    const cells: string[] = [];
    for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = c[1]!;
      const body = c[2] ?? '';
      const ref = attr(a, 'r');
      const col = ref ? columnIndex(ref) : cells.length;
      const type = attr(a, 't') ?? 'n';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = texts(body);
      else if (type === 'str' || type === 'e') value = xmlText(v ?? '');
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) value = dateStyle[Number(attr(a, 's') ?? 0)] ? serialToIso(Number(v), date1904) : plainNumber(v);
      while (cells.length < col) cells.push('');
      cells[col] = value.trim();
    }
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    rows.push(cells);
  }
  while (rows.length && !rows[rows.length - 1]!.length) rows.pop();
  return rows;
}

/** true when the bytes start like a ZIP (an .xlsx), so a renamed file is still read the right way */
export const looksLikeXlsx = (bytes: Uint8Array) => bytes.length > 4 && u32(bytes, 0) === 0x04034b50;

/* ------------------------------------------------------------------ writing the template ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP with stored (uncompressed) entries — small files, so no compression is needed. */
export function zip(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number): string => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));

/**
 * An .xlsx with the header row (bold, frozen) and optional example rows. Every column is formatted as text (@) so codes like
 * "00123" and tax IDs keep their leading zeros when typed in.
 */
export function xlsxTemplate(headers: string[], examples: string[][] = [], sheetName = 'นำเข้า'): Uint8Array {
  const row = (cells: string[], r: number, style: number) =>
    `<row r="${r}">${cells.map((v, i) => `<c r="${colName(i)}${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('')}</row>`;
  const widths = headers.map((h, i) => Math.min(60, Math.max(12, h.length + 4, ...examples.map((e) => (e[i] ?? '').length + 2))));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" style="2" customWidth="1"/>`).join('')}</cols>
<sheetData>${row(headers, 1, 1)}${examples.map((e, i) => row(e, i + 2, 2)).join('')}</sheetData>
</worksheet>`;
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}
