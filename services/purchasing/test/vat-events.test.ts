/** Wave 5: goods received / returned carry the VAT split so Accounting books stock and ภาษีซื้อ separately. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const steel = { itemId: randomUUID(), itemCode: 'RM-STEEL-V', itemName: 'เหล็กแผ่น' };

describe('purchasing VAT on events', () => {
  it('goods_received: VAT mode, per-line rate and the receipt totals; goods_returned: the credit-note totals', async () => {
    const po = (await t.api('POST', '/purchase-orders', { supplierName: 'Siam Steel', vatMode: 'inclusive', lines: [{ ...steel, qty: 10, unitPrice: 107 }] })).body;
    await t.api('POST', `/purchase-orders/${po.id}/approve`);
    await t.api('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ lineId: po.lines[0].id, qty: 4 }] });
    const gr = (await t.published('purchasing.goods_received')).map((e) => e.data).find((d) => d.poId === po.id);
    expect(gr).toMatchObject({ vatMode: 'inclusive', net: 400, vat: 28, gross: 428, lines: [{ qty: 4, unitPrice: 107, vatRate: 0.07 }] });
    expect(() => parseEvent('purchasing.goods_received', gr)).not.toThrow();
    await t.api('POST', `/purchase-orders/${po.id}/returns`, { lines: [{ itemId: steel.itemId, qty: 1, reason: 'บุบ' }], returnDate: '2026-10-02' });
    const rt = (await t.published('purchasing.goods_returned')).map((e) => e.data).find((d) => d.poId === po.id);
    expect(rt).toMatchObject({ vatMode: 'inclusive', net: 100, vat: 7, gross: 107, returnDate: '2026-10-02' });
    expect(() => parseEvent('purchasing.goods_returned', rt)).not.toThrow();
  });
});
