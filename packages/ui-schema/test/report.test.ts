import { describe, expect, it } from 'vitest';
import {
  accounting, auditDetailText, columnTotals, csvValue, datePresets, factSections, fillTemplate, filterGroups, formatValue, isNegative,
  repeatsAbove, reportIndent, reportRowStyle, type Column, type Field, type ReportSpec,
} from '../src/index.ts';

const spec: ReportSpec = { heading: ['section'], subtotal: ['total'], total: ['result'], muted: ['opening'], levels: { account: 1 } };

describe('accounting format', () => {
  it('prints negatives in parentheses and zero as a dash', () => {
    expect(accounting(1250)).toBe('1,250.00');
    expect(accounting(-1250.5)).toBe('(1,250.50)');
    expect(accounting(0)).toBe('–');
    expect(accounting(-0.001)).toBe('–');
    expect(formatValue(-3.2, 'accounting')).toBe('(3.20)');
    expect(formatValue(null, 'accounting')).toBe('—');
  });
  it('exports plain numbers to CSV and knows what is negative', () => {
    expect(csvValue(-1250.5, 'accounting')).toBe('-1250.50');
    expect(isNegative(-1, 'accounting')).toBe(true);
    expect(isNegative(-0.001, 'money')).toBe(false);
    expect(isNegative(-1, 'qty')).toBe(false);
  });
});

describe('report rows', () => {
  it('styles and indents rows by kind or by a level field', () => {
    expect(reportRowStyle(spec, { kind: 'section' })).toBe('heading');
    expect(reportRowStyle(spec, { kind: 'result' })).toBe('total');
    expect(reportRowStyle(spec, { kind: 'total' })).toBe('subtotal');
    expect(reportRowStyle(spec, { kind: 'opening' })).toBe('muted');
    expect(reportRowStyle(spec, { kind: 'account' })).toBeNull();
    expect(reportRowStyle(undefined, { kind: 'section' })).toBeNull();
    expect(reportIndent(spec, { kind: 'account' })).toBe(1);
    expect(reportIndent(spec, { kind: 'section' })).toBe(0);
    expect(reportIndent({ indentFrom: 'level' }, { level: 3 })).toBe(3);
    expect(reportIndent({ indentFrom: 'level' }, { level: 'x' })).toBe(0);
  });

  it('sums only ordinary rows into the footer', () => {
    const cols: Column[] = [{ key: 'name', label: 'รายการ' }, { key: 'amount', label: 'เงิน', format: 'accounting', total: true }];
    const rows = [
      { kind: 'section', name: 'รายได้' }, { kind: 'account', amount: 100.105 }, { kind: 'account', amount: '50.2' },
      { kind: 'total', amount: 150.3 }, { kind: 'result', amount: 150.3 },
    ];
    expect(columnTotals(cols, rows, spec)).toEqual({ amount: 150.31 });
    expect(columnTotals([{ key: 'name', label: 'x' }], rows)).toBeNull();
    expect(columnTotals(cols, rows)).toEqual({ amount: 450.91 }); // no report: every row counts
  });

  it('finds repeated cells for grouped columns', () => {
    const rows = [{ a: '11200' }, { a: '11200' }, { a: '11300' }, { a: '' }, { a: '' }];
    expect(repeatsAbove(rows, 0, 'a')).toBe(false);
    expect(repeatsAbove(rows, 1, 'a')).toBe(true);
    expect(repeatsAbove(rows, 2, 'a')).toBe(false);
    expect(repeatsAbove(rows, 4, 'a')).toBe(false);
  });
});

describe('report titles', () => {
  it('fills a period template from the response', () => {
    expect(fillTemplate('ณ วันที่ {asOf|date}', { asOf: '2026-10-03' })).toBe('ณ วันที่ 3 ต.ค. 2569');
    expect(fillTemplate('ปีภาษี {year|year}', { year: '2026' })).toBe('ปีภาษี 2569');
    expect(fillTemplate('เดือน {month|month}', { month: '2026-10' })).toMatch(/ตุลาคม 2569/);
    expect(fillTemplate('ต่าง {d|money} บาท', { d: 1234.5 })).toBe('ต่าง 1,234.50 บาท');
    expect(fillTemplate('{a.b}', { a: { b: 'x' } })).toBe('x');
    expect(fillTemplate('ณ วันที่ {asOf|date}', {})).toBe('');
  });
});

describe('filters and facts', () => {
  const f = (name: string, type: Field['type']): Field => ({ name, label: name, type });
  it('pairs from/to date filters into one range', () => {
    const groups = filterGroups([f('q', 'text'), f('from', 'date'), f('to', 'date'), f('dateFrom', 'date'), f('dateTo', 'date'), f('x', 'date')]);
    expect(groups.map((g) => (g.kind === 'range' ? `${g.from.name}-${g.to.name}` : g.field.name))).toEqual(['q', 'from-to', 'dateFrom-dateTo', 'x']);
    expect(filterGroups([f('from', 'date'), f('dueTo', 'date')]).length).toBe(2);
  });
  it('offers this month, last month, this quarter and this year', () => {
    const p = Object.fromEntries(datePresets(new Date(2026, 0, 15)).map((x) => [x.id, [x.from, x.to]]));
    expect(p.month).toEqual(['2026-01-01', '2026-01-31']);
    expect(p['last-month']).toEqual(['2025-12-01', '2025-12-31']);
    expect(p.quarter).toEqual(['2026-01-01', '2026-03-31']);
    expect(p.year).toEqual(['2026-01-01', '2026-12-31']);
  });
  it('splits detail facts into titled sections', () => {
    const groups = factSections([{ key: 'a', label: 'a' }, { key: 'b', label: 'b', section: 'รายได้' }, { key: 'c', label: 'c' }, { key: 'd', label: 'd', section: 'หัก' }]);
    expect(groups.map((g) => [g.title, g.fields.map((x) => x.key).join('')])).toEqual([[undefined, 'a'], ['รายได้', 'bc'], ['หัก', 'd']]);
    expect(factSections([{ key: 'a', label: 'a', section: 'S' }]).length).toBe(1);
  });
});

describe('audit detail text', () => {
  it('drops internal ids and names uploaded files', () => {
    expect(auditDetailText({ route: '/_attachments', summary_text: 'ref: claim:1342e882-3174-4b28-93bd-5b3ec55063e3 · fileName: ใบเสร็จ.png · contentType: image/png' })).toBe('ไฟล์ ใบเสร็จ.png');
    expect(auditDetailText({ route: '/claims', summary_text: 'purpose: หมึก · customerId: 1342e882-3174-4b28-93bd-5b3ec55063e3 · lines: 1 รายการ' })).toBe('purpose: หมึก · lines: 1 รายการ');
  });
});
