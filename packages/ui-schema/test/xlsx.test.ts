import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { columnIndex, isDateFormat, looksLikeXlsx, mapImportRows, readXlsx, serialToIso, unzip, xlsxTemplate, XlsxError, xmlText } from '../src/index.ts';

/** A workbook the way Excel writes it: deflated entries, shared strings, a date style, numbers, gaps between cells. */
function excelLike(): Uint8Array {
  const files: [string, string][] = [
    ['xl/workbook.xml', '<workbook xmlns:r="r"><workbookPr/><sheets><sheet name="สินค้า" sheetId="1" r:id="rId7"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId7" Target="worksheets/sheet3.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', '<sst><si><t>รหัส</t></si><si><t>ชื่อ</t></si><si><r><t>วัน</t></r><r><t xml:space="preserve">ที่</t></r></si><si><t>00123</t></si><si><t>น็อต &amp; สกรู_x000D_</t></si></sst>'],
    ['xl/styles.xml', '<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="4"/></cellXfs></styleSheet>'],
    ['xl/worksheets/sheet3.xml', `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>
      <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" s="2"><v>0.30000000000000004</v></c><c r="D2" s="1"><v>46347</v></c></row>
      <row r="4"><c r="A4" t="inlineStr"><is><t>X-9</t></is></c><c r="B4" t="str"><f>A4&amp;"!"</f><v>X-9!</v></c></row>
    </sheetData></worksheet>`],
  ];
  const enc = new TextEncoder();
  const parts: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, content] of files) {
    const n = Buffer.from(name); const raw = enc.encode(content); const data = deflateRawSync(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(local, n, data); central.push(cd, n); offset += 30 + n.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cdBuf, end]));
}

describe('reading .xlsx', () => {
  it('reads the first sheet through its relationship: shared and inline strings, rich text, dates, plain numbers, gaps', async () => {
    const bytes = excelLike();
    expect(looksLikeXlsx(bytes)).toBe(true);
    expect(await readXlsx(bytes)).toEqual([
      ['รหัส', 'ชื่อ', '', 'วันที่'],
      ['00123', 'น็อต & สกรู', '0.3', '2026-11-21'],
      [],
      ['X-9', 'X-9!'],
    ]);
  });

  it('round-trips the template it writes, and maps it like a CSV', async () => {
    const t = xlsxTemplate(['รหัสสินค้า', 'ชื่อสินค้า', 'หน่วย'], [['001', 'เหล็ก <A> & "B"', 'กก.']]);
    const rows = await readXlsx(t);
    expect(rows).toEqual([['รหัสสินค้า', 'ชื่อสินค้า', 'หน่วย'], ['001', 'เหล็ก <A> & "B"', 'กก.']]);
    const m = mapImportRows([{ key: 'code', label: 'รหัสสินค้า', required: true }, { key: 'name', label: 'ชื่อสินค้า' }], rows);
    expect(m.rows).toEqual([{ code: '001', name: 'เหล็ก <A> & "B"' }]);
    expect(m.ignored).toEqual(['หน่วย']);
    expect([...(await unzip(t)).keys()]).toContain('xl/styles.xml');
  });

  it('refuses what is not an .xlsx with a Thai reason', async () => {
    await expect(readXlsx(new TextEncoder().encode('a,b\n1,2'))).rejects.toBeInstanceOf(XlsxError);
    await expect(readXlsx(new TextEncoder().encode('a,b\n1,2'))).rejects.toThrow(/\.xls รุ่นเก่า/);
  });

  it('helpers', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('AA10')).toBe(26);
    expect(isDateFormat('dd/mm/yyyy')).toBe(true);
    expect(isDateFormat('[$-th-TH]d mmm yy')).toBe(true);
    expect(isDateFormat('#,##0.00')).toBe(false);
    expect(isDateFormat('h:mm')).toBe(false);
    expect(isDateFormat('"day "0')).toBe(false);
    expect(serialToIso(1)).toBe('1899-12-31');
    expect(serialToIso(61)).toBe('1900-03-01');
    expect(serialToIso(46347.75)).toBe('2026-11-21');
    expect(serialToIso(0, true)).toBe('1904-01-01');
    expect(xmlText('&#3585;&#x0E01;&amp;lt;')).toBe('กก&lt;');
  });
});
