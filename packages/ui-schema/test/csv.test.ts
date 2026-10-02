import { describe, expect, it } from 'vitest';
import {
  brokenLinks, csvCell, csvDate, csvTemplate, csvValue, endpointsOf, filterRows, filtersToQuery, headerKey, mapImportRows, parseCsv, toCsv,
  type Column, type ImportColumn, type ModuleUi,
} from '../src/index.ts';

describe('CSV export', () => {
  it('writes dates as dd/mm/Buddhist-year text', () => {
    expect(csvDate('2026-10-02')).toBe('02/10/2569');
    const local = new Date(2026, 0, 5, 9, 7).toISOString();
    expect(csvDate(local)).toBe('05/01/2569');
    expect(csvDate(local, true)).toBe('05/01/2569 09:07');
    expect(csvDate('not a date')).toBe('not a date');
  });

  it('keeps numbers plain and turns codes into Thai labels', () => {
    expect(csvValue('1070.5000', 'money')).toBe('1070.50');
    expect(csvValue(1234567.891, 'qty')).toBe('1234567.891');
    expect(csvValue(12.5, 'percent')).toBe('12.5');
    expect(csvValue('raw', 'label')).toBe('วัตถุดิบ');
    expect(csvValue('in_progress', 'status', { in_progress: 'กำลังซ่อม' })).toBe('กำลังซ่อม');
    expect(csvValue(true, 'boolean')).toBe('ใช่');
    expect(csvValue(['a', 'b'], 'list')).toBe('a, b');
    expect(csvValue('2026-03', 'month')).toBe('03/2569');
    expect(csvValue(null, 'money')).toBe('');
    expect(csvValue({ a: 1 })).toBe('{"a":1}');
  });

  it('quotes cells and neutralises spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-5', true)).toBe('-5');
    expect(csvCell('-5')).toBe("'-5");
    // SEC-13 (security review 0.3): a text value in a numeric column is still neutralised
    expect(csvCell('=1+cmd|"/c calc"!A1', true)).toBe(`"'=1+cmd|""/c calc""!A1"`);
    expect(csvCell('-2+3', true)).toBe("'-2+3");
    expect(csvCell('1.5e3', true)).toBe('1.5e3');
    expect(toCsv([{ key: 'q', label: 'Q', format: 'qty' }], [{ q: '@SUM(A1)' }]).slice(1)).toBe("Q\r\n'@SUM(A1)\r\n");
  });

  it('builds a BOM-prefixed file with the column labels as headers', () => {
    const cols: Column[] = [{ key: 'code', label: 'รหัส' }, { key: 'customer.name', label: 'ลูกค้า' }, { key: 'total', label: 'ยอด', format: 'money' }, { key: 'date', label: 'วันที่', format: 'date' }];
    const csv = toCsv(cols, [{ code: 'SO-1', customer: { name: 'บจก. เอ, บี' }, total: '1500', date: '2026-10-02' }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('รหัส,ลูกค้า,ยอด,วันที่\r\nSO-1,"บจก. เอ, บี",1500.00,02/10/2569\r\n');
    expect(csvTemplate({ endpoint: '/x/import', columns: [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }] })).toBe('﻿รหัส,ชื่อ\r\n');
  });
});

describe('CSV import', () => {
  it('parses quotes, escaped quotes, line breaks in cells, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",2\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', '2']]);
    expect(parseCsv('a,b\n1,')).toEqual([['a', 'b'], ['1', '']]);
    expect(parseCsv('')).toEqual([]);
  });

  it('detects semicolon and tab delimiters from the header', () => {
    expect(parseCsv('code;name\nA;"x;y"')).toEqual([['code', 'name'], ['A', 'x;y']]);
    expect(parseCsv('code\tname\nA\tB')).toEqual([['code', 'name'], ['A', 'B']]);
    expect(parseCsv('a,b;c\n1,2;3')).toEqual([['a', 'b;c'], ['1', '2;3']]);
  });

  it('round-trips an exported file', () => {
    const cols: Column[] = [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }];
    const rows = [{ code: 'A', name: 'มี "คำพูด", และจุลภาค' }, { code: 'B', name: 'สองบรรทัด\nบรรทัดที่สอง' }];
    expect(parseCsv(toCsv(cols, rows))).toEqual([['รหัส', 'ชื่อ'], ['A', rows[0].name], ['B', rows[1].name]]);
  });

  const columns: ImportColumn[] = [{ key: 'code', label: 'รหัส', required: true }, { key: 'name', label: 'ชื่อ', required: true }, { key: 'stdPrice', label: 'ราคามาตรฐาน' }];

  it('maps Thai labels or keys to fields and keeps spreadsheet row numbers', () => {
    const table = parseCsv('รหัส *, NAME ,ราคามาตรฐาน,หมายเหตุ\nA,สินค้า เอ,10,x\n,,,\nB, สินค้า บี ,,\n');
    const r = mapImportRows(columns, table);
    expect(r.rows).toEqual([{ code: 'A', name: 'สินค้า เอ', stdPrice: '10' }, { code: 'B', name: 'สินค้า บี' }]);
    expect(r.lines).toEqual([2, 4]);
    expect(r.missing).toEqual([]);
    expect(r.ignored).toEqual(['หมายเหตุ']);
    expect(headerKey('﻿  ชื่อ   สินค้า *')).toBe('ชื่อ สินค้า');
  });

  it('reports required columns missing from the header', () => {
    const r = mapImportRows(columns, parseCsv('ชื่อ\nX'));
    expect(r.missing.map((c) => c.key)).toEqual(['code']);
    expect(mapImportRows(columns, []).rows).toEqual([]);
  });
});

describe('list helpers', () => {
  const cols: Column[] = [{ key: 'code', label: 'รหัส' }, { key: 'type', label: 'ประเภท', format: 'label' }];
  const rows = [{ code: 'RM-STEEL', type: 'raw' }, { code: 'FG-BRACKET', type: 'finished' }];
  it('filters loaded rows by raw or formatted text, all words required', () => {
    expect(filterRows(rows, cols, 'steel')).toEqual([rows[0]]);
    expect(filterRows(rows, cols, 'วัตถุดิบ')).toEqual([rows[0]]);
    expect(filterRows(rows, cols, 'fg สำเร็จรูป')).toEqual([rows[1]]);
    expect(filterRows(rows, cols, 'fg วัตถุดิบ')).toEqual([]);
    expect(filterRows(rows, cols, '  ')).toBe(rows);
  });
  it('turns filters into a stable query string', () => {
    expect(filtersToQuery({ type: 'raw', q: 'เหล็ก', empty: '', off: false, none: null })).toBe(`q=${encodeURIComponent('เหล็ก')}&type=raw`);
    expect(filtersToQuery({})).toBe('');
  });
});

describe('import descriptors', () => {
  const ui = (columns: ImportColumn[]): ModuleUi => ({
    module: 'm', label: 'm', glyph: 'm', menu: [{ label: 'x', screen: 'list' }],
    screens: { list: { kind: 'list', title: 'x', endpoint: '/things', columns: [], import: { endpoint: '/things/import', columns } } },
  });
  it('declares the import endpoint as a POST of the module', () => {
    expect(endpointsOf(ui([{ key: 'code', label: 'รหัส' }]))).toContainEqual({ module: 'm', method: 'POST', path: '/things/import', where: 'm.list.import' });
  });
  it('rejects empty or ambiguous import columns', () => {
    expect(brokenLinks(ui([{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }]))).toEqual([]);
    expect(brokenLinks(ui([]))).toEqual(['m: list.import has no columns']);
    expect(brokenLinks(ui([{ key: 'code', label: 'รหัส' }, { key: 'code', label: 'Code' }]))[0]).toMatch(/declared twice/);
    expect(brokenLinks(ui([{ key: 'code', label: 'ชื่อ' }, { key: 'name', label: 'ชื่อ' }]))[0]).toMatch(/matches both/);
  });
});
