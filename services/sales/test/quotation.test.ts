import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const camera = { itemId: randomUUID(), itemCode: 'CCTV-IP4MP', itemName: 'กล้อง IP 4MP' };
const partnerId = randomUUID();
const accepted = (extra: Record<string, unknown> = {}) => ({
  quotationId: randomUUID(), no: 'QT-2569-0010', customerName: 'บริษัท ชลบุรีพลาสติก จำกัด', total: 15798.1,
  partnerId, customerTaxId: '0105536000313', customerBranch: '00000', customerAddress: 'ชลบุรี', vatMode: 'exclusive',
  lines: [
    { ...camera, qty: 4, unitPrice: 2850, discountPct: 5 },
    { itemId: null, itemCode: null, itemName: null, description: 'ค่าติดตั้งและเดินสาย', qty: 1, unitPrice: 3934, discountPct: 0 },
  ],
  ...extra,
});

describe('sales ← crm.quotation_accepted', () => {
  it('drafts a sales order with the same lines, discounts and totals as the quotation', async () => {
    const e = accepted();
    expect((await t.deliver('crm.quotation_accepted', e)).body.status).toBe('handled');
    const list = (await t.api('GET', '/orders?q=QT-2569-0010')).body;
    expect(list).toHaveLength(1);
    const o = (await t.api('GET', `/orders/${list[0].id}`)).body;
    // 4 × 2,850 − 5% = 10,830 + 3,934 = 14,764 → VAT 1,033.48 → 15,797.48
    expect(o).toMatchObject({
      status: 'draft', ref: 'QT-2569-0010', quotation_id: e.quotationId, customer_id: partnerId, customer_name: 'บริษัท ชลบุรีพลาสติก จำกัด',
      customer_tax_id: '0105536000313', vat_mode: 'exclusive', subtotal: 15334, discount: 570, net: 14764, vat: 1033.48, gross: 15797.48, created_by: null,
    });
    expect(o.note).toContain('QT-2569-0010');
    expect(o.lines).toMatchObject([
      { line_no: 1, item_code: 'CCTV-IP4MP', qty: 4, unit_price: 2850, discount_pct: 5, amount: 10830 },
      { line_no: 2, item_id: null, item_code: null, description: 'ค่าติดตั้งและเดินสาย', discount_pct: 0, amount: 3934 },
    ]);
  });

  it('is idempotent by quotation id (redelivery with a new event id creates nothing)', async () => {
    const e = accepted({ no: 'QT-2569-0011' });
    await t.deliver('crm.quotation_accepted', e);
    expect((await t.deliver('crm.quotation_accepted', e)).body.status).toBe('handled');
    const id = randomUUID();
    await t.deliver('crm.quotation_accepted', e, { id });
    expect((await t.deliver('crm.quotation_accepted', e, { id })).body.status).toBe('duplicate');
    expect((await t.api('GET', '/orders?q=QT-2569-0011')).body).toHaveLength(1);
  });

  it('ignores the old payload without lines and keeps tenants apart', async () => {
    await t.deliver('crm.quotation_accepted', { quotationId: randomUUID(), no: 'QT-2569-0099', customerName: 'เก่า', total: 100 });
    expect((await t.api('GET', '/orders?q=QT-2569-0099')).body).toHaveLength(0);
    await t.deliver('crm.quotation_accepted', accepted({ no: 'QT-2569-0050' }), { tenantId: t.otherTenantId });
    expect((await t.api('GET', '/orders?q=QT-2569-0050')).body).toHaveLength(0);
    expect((await t.api('GET', '/orders?q=QT-2569-0050', undefined, { token: t.token(['*'], t.otherTenantId) })).body).toHaveLength(1);
  });

  it('service lines are not issued from stock; a service-only order publishes no delivery', async () => {
    const o = (await t.api('GET', '/orders?q=QT-2569-0010')).body[0];
    await t.api('POST', `/orders/${o.id}/confirm`);
    await t.api('POST', `/orders/${o.id}/deliver`);
    const confirmed = (await t.published('sales.order_confirmed')).at(-1)!.data;
    expect(confirmed.lines).toEqual([{ ...camera, qty: 4, unitPrice: 2850 }]);
    expect(confirmed.total).toBe(15797.48);
    expect((await t.published('sales.delivered')).at(-1)!.data.lines).toEqual([{ ...camera, qty: 4 }]);

    const before = (await t.published('sales.delivered')).length;
    const svc = (await t.api('POST', '/orders', { customerName: 'ลูกค้า MA', lines: [{ description: 'ค่าบริการ MA รายปี', qty: 1, unitPrice: 60000 }] })).body;
    expect(svc.lines[0]).toMatchObject({ item_id: null, description: 'ค่าบริการ MA รายปี', amount: 60000 });
    await t.api('POST', `/orders/${svc.id}/confirm`);
    expect((await t.api('POST', `/orders/${svc.id}/deliver`)).body.status).toBe('delivered');
    expect((await t.published('sales.delivered')).length).toBe(before);
    expect((await t.published('sales.order_confirmed')).at(-1)!.data).toMatchObject({ total: 64200, lines: [] });
  });

  it('POST /orders takes line discounts, a reference and credit days; validates lines', async () => {
    const o = (await t.api('POST', '/orders', {
      customerName: 'บริษัท เอ จำกัด', ref: 'PO-ลูกค้า-77', creditDays: 30, lines: [{ ...camera, qty: 2, unitPrice: 1000, discountPct: 10 }],
    })).body;
    expect(o).toMatchObject({ subtotal: 2000, discount: 200, net: 1800, vat: 126, gross: 1926, ref: 'PO-ลูกค้า-77', credit_days: 30 });
    expect((await t.api('GET', '/orders?q=ลูกค้า-77')).body).toHaveLength(1);
    expect((await t.api('POST', '/orders', { customerName: 'X', lines: [{ qty: 1, unitPrice: 1 }] })).status).toBe(400);
    expect((await t.api('POST', '/orders', { customerName: 'X', lines: [{ ...camera, qty: 1, unitPrice: 1, discountPct: 120 }] })).status).toBe(400);
  });
});
