import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition, { PROMPTPAY_ID: '0105536000313' }); });
afterAll(async () => { await t?.close(); });

const bracket = { itemId: randomUUID(), itemCode: 'FG-BRACKET', itemName: 'ขายึด' };
const order = (extra = {}) => ({ customerName: 'บริษัท เอ จำกัด', customerTaxId: '0105536000313', orderDate: '2026-10-02', warehouseCode: 'FG', lines: [{ ...bracket, qty: 10, unitPrice: 100 }], ...extra });

describe('sales', () => {
  it('runs draft -> confirmed -> delivered -> invoiced with events', async () => {
    const o = (await t.api('POST', '/orders', order())).body;
    expect(o).toMatchObject({ no: 'SO-2569-0001', status: 'draft', net: 1000, vat: 70, gross: 1070 });
    expect((await t.api('POST', `/orders/${o.id}/deliver`)).status).toBe(409);
    expect((await t.api('POST', `/orders/${o.id}/confirm`)).body.status).toBe('confirmed');
    expect((await t.api('POST', `/orders/${o.id}/deliver`)).body.status).toBe('delivered');
    const inv = await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-10-02' });
    expect(inv.status).toBe(201);
    expect(inv.body).toMatchObject({
      no: 'INV-2569-0001', gross: 1070, issueDateTh: '2 ตุลาคม 2569', amountText: 'หนึ่งพันเจ็ดสิบบาทถ้วน',
      customer: { taxId: '0105536000313' }, orderNo: 'SO-2569-0001',
    });
    expect(inv.body.promptPay).toContain('54071070.00');
    expect((await t.api('POST', `/orders/${o.id}/invoice`)).status).toBe(409);
    expect((await t.published()).map((e) => e.type)).toEqual(['sales.order_confirmed', 'sales.delivered', 'sales.invoiced']);
    expect((await t.published('sales.delivered'))[0].data).toMatchObject({ warehouseCode: 'FG', lines: [{ itemCode: 'FG-BRACKET', qty: 10 }] });
  });

  it('handles VAT-inclusive prices and validates tax IDs', async () => {
    const o = (await t.api('POST', '/orders', order({ vatMode: 'inclusive', lines: [{ ...bracket, qty: 1, unitPrice: 107 }] }))).body;
    expect(o).toMatchObject({ net: 100, vat: 7, gross: 107 });
    expect((await t.api('POST', '/orders', order({ customerTaxId: '1234567890123' }))).status).toBe(400);
  });

  it('cancels only open orders and respects permissions', async () => {
    const o = (await t.api('POST', '/orders', order())).body;
    expect((await t.api('POST', `/orders/${o.id}/cancel`)).body.status).toBe('cancelled');
    expect((await t.api('POST', `/orders/${o.id}/confirm`)).status).toBe(409);
    const viewer = t.token(['sales.order.read']);
    expect((await t.api('POST', '/orders', order(), { token: viewer })).status).toBe(403);
    expect((await t.api('GET', '/orders?status=cancelled', undefined, { token: viewer })).body).toHaveLength(1);
  });
});
