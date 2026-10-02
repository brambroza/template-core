import { describe, expect, it } from 'vitest';
import { aiFillable, cleanAiValue, cleanListFilters, isBlankLine, mergeAiFill, toIsoDate, type Field } from '../src/index.ts';

const f = (type: Field['type'], extra: Partial<Field> = {}): Field => ({ name: 'x', label: 'x', type, ...extra });

describe('AI helpers', () => {
  it('reads Thai dates (พ.ศ.) and rejects impossible ones', () => {
    expect(toIsoDate('2569-03-05')).toBe('2026-03-05');
    expect(toIsoDate('5/3/2569')).toBe('2026-03-05');
    expect(toIsoDate('05-03-2026')).toBe('2026-03-05');
    expect(toIsoDate('2026-02-30')).toBeUndefined();
    expect(toIsoDate('เมื่อวาน')).toBeUndefined();
  });

  it('cleans proposed values per field type', () => {
    expect(cleanAiValue(f('number'), '1,070.50 บาท')).toBe(1070.5);
    expect(cleanAiValue(f('number'), 12.345)).toBe(12.35);
    expect(cleanAiValue(f('number'), 'abc')).toBeUndefined();
    expect(cleanAiValue(f('month'), '2569-1')).toBe('2026-01');
    const sel = f('select', { options: [{ value: 'cash', label: 'เงินสด' }] });
    expect(cleanAiValue(sel, 'เงินสด')).toBe('cash');
    expect(cleanAiValue(sel, 'bitcoin')).toBeUndefined();
    expect(cleanAiValue(f('text'), '  ปตท.  ')).toBe('ปตท.');
    expect(cleanAiValue(f('boolean'), true)).toBeUndefined();
    expect(cleanAiValue(f('password'), 'x')).toBeUndefined();
    expect(aiFillable([f('boolean'), f('text'), f('image'), f('lookup')]).map((x) => x.type)).toEqual(['text', 'lookup']);
  });

  it('keeps only declared list filters', () => {
    const filters: Field[] = [
      { name: 'status', label: 'สถานะ', type: 'select', options: [{ value: 'submitted', label: 'รออนุมัติ' }] },
      { name: 'from', label: 'ตั้งแต่', type: 'date' },
      { name: 'mine', label: 'ของฉัน', type: 'boolean' },
    ];
    expect(cleanListFilters(filters, { status: 'รออนุมัติ', from: '1/10/2569', mine: true, tenantId: 'other' })).toEqual({ status: 'submitted', from: '2026-10-01', mine: 'true' });
    expect(cleanListFilters(undefined, { a: 1 })).toEqual({});
  });

  it('fills only empty fields and replaces untouched lines', () => {
    const current = {
      values: { purpose: 'ไปหาลูกค้า', department: '', submit: true },
      lines: [{ amount: 50, description: 'ทางด่วน' }, { vat: '' }],
    };
    const proposal = {
      values: { purpose: 'ค่าน้ำมัน', department: 'ขาย', categoryId: 'c1', '__label.categoryId': 'FUEL ค่าน้ำมัน' },
      lines: [{ amount: 1000, vat: 70, categoryId: 'c1', '__label.categoryId': 'FUEL' }, {}],
    };
    const r = mergeAiFill(current, proposal);
    expect(r.values).toEqual({ purpose: 'ไปหาลูกค้า', department: 'ขาย', submit: true, categoryId: 'c1', '__label.categoryId': 'FUEL ค่าน้ำมัน' });
    expect(r.lines).toEqual([{ amount: 50, description: 'ทางด่วน' }, { amount: 1000, vat: 70, categoryId: 'c1', '__label.categoryId': 'FUEL' }]);
    expect(r.filled).toBe(3);
    // nothing proposed for lines: the person's lines stay as they are
    expect(mergeAiFill(current, { values: {}, lines: [] }).lines).toBe(current.lines);
    expect(isBlankLine({ qty: 1, note: '' }, { qty: 1 })).toBe(true);
  });
});
