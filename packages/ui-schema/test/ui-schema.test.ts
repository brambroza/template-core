import { describe, expect, it } from 'vitest';
import { fillPath, formatValue, get, hasPerm, matches, missingRequired, statusTone, toBody } from '../src/index.ts';

describe('ui-schema helpers', () => {
  it('fills endpoint templates from several sources', () => {
    expect(fillPath('/orders/:id/approve', { id: 'a b' })).toBe('/orders/a%20b/approve');
    expect(fillPath('/item-costs/:itemId', {}, { itemId: 'x' })).toBe('/item-costs/x');
    expect(() => fillPath('/orders/:id', {})).toThrow(/Missing value for :id/);
  });

  it('reads dotted paths and checks conditions and permissions', () => {
    expect(get({ customer: { name: 'A' } }, 'customer.name')).toBe('A');
    expect(matches({ status: 'draft' }, { field: 'status', in: ['draft'] })).toBe(true);
    expect(matches({ status: 'approved' }, { field: 'status', in: ['draft'] })).toBe(false);
    expect(hasPerm(['sales.*'], 'sales.order.write')).toBe(true);
    expect(hasPerm(['sales.order.read'], 'sales.order.write')).toBe(false);
    expect(hasPerm([], undefined)).toBe(true);
  });

  it('formats Thai values', () => {
    expect(formatValue(1070, 'money')).toBe('1,070.00');
    expect(formatValue('draft', 'status')).toBe('ร่าง');
    expect(formatValue('2026-10-02', 'date')).toBe('2 ต.ค. 2569');
    expect(formatValue(null, 'money')).toBe('—');
    expect(statusTone('received')).toBe('ok');
  });

  it('builds request bodies and checks required fields', () => {
    const fields = [{ name: 'qty', label: 'จำนวน', type: 'number' as const, required: true }, { name: 'note', label: 'หมายเหตุ', type: 'text' as const }];
    expect(toBody(fields, { qty: '5', note: '' })).toEqual({ qty: 5 });
    expect(toBody([], {}, { name: 'lines', label: 'x', fields }, [{ qty: '2' }, {}])).toEqual({ lines: [{ qty: 2 }] });
    expect(missingRequired(fields, { qty: '' })).toEqual({ qty: 'กรอกจำนวน' });
  });
});
