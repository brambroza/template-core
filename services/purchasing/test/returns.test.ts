import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
// one test user creates and approves here; segregation of duties is covered in sod.test.ts
beforeAll(async () => { t = await bootTestService(definition); await t.api('PUT', '/settings', { creatorCannotApprove: false }); });
afterAll(async () => { await t?.close(); });

const steel = { itemId: randomUUID(), itemCode: 'RM-SPCC-12', itemName: 'เหล็กแผ่น SPCC 1.2' };
const paint = { itemId: randomUUID(), itemCode: 'RM-PAINT', itemName: 'สีฝุ่น' };

describe('purchasing — return to supplier (RT)', () => {
  let po: any;

  it('refuses returns before anything was received', async () => {
    po = (await t.api('POST', '/purchase-orders', {
      supplierName: 'สยามเหล็กกล้า', warehouseCode: 'MAIN', orderDate: '2026-10-01',
      lines: [{ ...steel, qty: 10000, unitPrice: 32 }, { ...paint, qty: 50, unitPrice: 165 }, { ...steel, qty: 8000, unitPrice: 32 }],
    })).body;
    await t.api('POST', `/purchase-orders/${po.id}/approve`);
    const res = await t.api('POST', `/purchase-orders/${po.id}/returns`, { lines: [{ itemId: steel.itemId, qty: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/ยังไม่ได้รับของ/);
  });

  it('returns up to received minus returned, over several PO lines of the same item, with VAT totals', async () => {
    await t.api('POST', `/purchase-orders/${po.id}/receive`);
    const res = await t.api('POST', `/purchase-orders/${po.id}/returns`, {
      warehouseCode: 'QC-HOLD', refNo: 'NCR-2569-0003', returnDate: '2026-10-02',
      lines: [{ itemId: steel.itemId, qty: 12000, reason: 'ความหนา 1.1 มม. ต่ำกว่าสเปก' }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ no: 'RT-2569-0001', po_no: po.no, supplier_name: 'สยามเหล็กกล้า', warehouse_code: 'QC-HOLD', ref_no: 'NCR-2569-0003', net: 384000, vat: 26880, gross: 410880 });
    expect(res.body.lines.map((l: any) => l.qty)).toEqual([10000, 2000]);
    const ev = (await t.published('purchasing.goods_returned'))[0].data;
    expect(ev).toMatchObject({ returnNo: 'RT-2569-0001', poNo: po.no, warehouseCode: 'QC-HOLD', supplierName: 'สยามเหล็กกล้า' });
    expect(ev.lines).toEqual([
      { ...steel, qty: 10000, unitPrice: 32, reason: 'ความหนา 1.1 มม. ต่ำกว่าสเปก' },
      { ...steel, qty: 2000, unitPrice: 32, reason: 'ความหนา 1.1 มม. ต่ำกว่าสเปก' },
    ]);
    const after = (await t.api('GET', `/purchase-orders/${po.id}`)).body;
    expect(after.lines.map((l: any) => [l.returned_qty, l.returnable_qty])).toEqual([[10000, 0], [0, 50], [2000, 6000]]);
    expect(after.returns.map((r: any) => r.no)).toEqual(['RT-2569-0001']);
    expect(after.status).toBe('received');

    const over = await t.api('POST', `/purchase-orders/${po.id}/returns`, { lines: [{ itemId: steel.itemId, qty: 6001 }] });
    expect(over.status).toBe(409);
    expect(over.body.error.message).toBe('ส่งคืน RM-SPCC-12 ได้ไม่เกิน 6,000 (รับแล้ว 18,000 ส่งคืนแล้ว 12,000)');
    expect((await t.api('POST', `/purchase-orders/${po.id}/returns`, { lines: [{ itemId: randomUUID(), qty: 1 }] })).status).toBe(400);
    // default warehouse = the PO's receiving warehouse
    const second = await t.api('POST', `/purchase-orders/${po.id}/returns`, { lines: [{ itemId: paint.itemId, qty: 5 }] });
    expect(second.body).toMatchObject({ no: 'RT-2569-0002', warehouse_code: 'MAIN' });
  });

  it('lists and shows returns, needs purchasing.po.return to create, and hides other tenants', async () => {
    const list = (await t.api('GET', `/purchase-returns?poId=${po.id}`)).body;
    expect(list.map((r: any) => r.no)).toEqual(['RT-2569-0002', 'RT-2569-0001']);
    expect(list[1].items).toBe('RM-SPCC-12 ×10000, RM-SPCC-12 ×2000');
    expect((await t.api('GET', '/purchase-returns?q=NCR-2569-0003')).body).toHaveLength(1);
    expect((await t.api('GET', `/purchase-returns/${list[0].id}`)).body.lines).toHaveLength(1);
    const buyer = t.token(['purchasing.po.read', 'purchasing.po.write', 'purchasing.po.receive']);
    expect((await t.api('POST', `/purchase-orders/${po.id}/returns`, { lines: [{ itemId: paint.itemId, qty: 1 }] }, { token: buyer })).status).toBe(403);
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('GET', '/purchase-returns', undefined, { token: other })).body).toEqual([]);
    expect((await t.api('GET', `/purchase-returns/${list[0].id}`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('POST', `/purchase-orders/${po.id}/returns`, { lines: [{ itemId: paint.itemId, qty: 1 }] }, { token: other })).status).toBe(404);
  });
});
