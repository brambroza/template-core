import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const steel = { itemId: randomUUID(), itemCode: 'RM-STEEL', itemName: 'เหล็กแผ่น' };
const bolt = { itemId: randomUUID(), itemCode: 'SP-BOLT', itemName: 'น็อต' };
const bracket = { itemId: randomUUID(), itemCode: 'FG-BRACKET', itemName: 'ขายึด' };

const balance = async (itemId: string, wh = 'MAIN') => {
  const r = await t.api('GET', `/balances?itemId=${itemId}&warehouseCode=${wh}&nonZero=false`);
  return r.body[0]?.onHand ?? 0;
};

describe('inventory (standalone)', () => {
  it('receives, issues, transfers and adjusts stock', async () => {
    await t.api('POST', '/warehouses', { code: 'MAIN', name: 'คลังหลัก' });
    await t.api('POST', '/warehouses', { code: 'LINE1', name: 'หน้าไลน์ 1' });
    expect((await t.api('POST', '/receipts', { warehouseCode: 'MAIN', lines: [{ ...steel, qty: 100, unitCost: 32.5 }] })).status).toBe(201);
    expect((await t.api('POST', '/issues', { warehouseCode: 'MAIN', lines: [{ ...steel, qty: 30 }] })).body.moves[0].onHand).toBe(70);
    await t.api('POST', '/transfers', { fromWarehouseCode: 'MAIN', toWarehouseCode: 'LINE1', lines: [{ ...steel, qty: 20 }] });
    await t.api('POST', '/adjustments', { warehouseCode: 'MAIN', lines: [{ ...steel, qty: -2 }], note: 'นับสต็อกขาด' });
    expect(await balance(steel.itemId)).toBe(48);
    expect(await balance(steel.itemId, 'LINE1')).toBe(20);
    const card = await t.api('GET', `/items/${steel.itemId}/stock-card?warehouseCode=MAIN`);
    expect(card.body.map((r: any) => [r.kind, r.balance])).toEqual([['receive', 100], ['issue', 70], ['transfer_out', 50], ['adjust', 48]]);
    expect((await t.published('inventory.stock_changed')).length).toBe(5);
  });

  it('blocks negative stock unless allowed', async () => {
    const res = await t.api('POST', '/issues', { warehouseCode: 'MAIN', lines: [{ ...steel, qty: 1000 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/สต็อกไม่พอ: RM-STEEL ที่คลัง MAIN คงเหลือ 48/);
    expect(await balance(steel.itemId)).toBe(48);
    await t.api('PUT', '/settings', { allowNegative: true });
    expect((await t.api('POST', '/issues', { warehouseCode: 'MAIN', lines: [{ ...bolt, qty: 5 }] })).status).toBe(201);
    expect(await balance(bolt.itemId)).toBe(-5);
    await t.api('PUT', '/settings', { allowNegative: false });
  });

  it('rejects unknown warehouses and missing permissions', async () => {
    expect((await t.api('POST', '/receipts', { warehouseCode: 'NOPE', lines: [{ ...steel, qty: 1 }] })).status).toBe(404);
    expect((await t.api('POST', '/receipts', { warehouseCode: 'MAIN', lines: [{ ...steel, qty: 1 }] }, { token: t.token(['inventory.stock.read']) })).status).toBe(403);
  });
});

describe('inventory (reacting to other modules)', () => {
  it('receives goods from purchasing into an auto-created warehouse', async () => {
    const r = await t.deliver('purchasing.goods_received', {
      poId: randomUUID(), poNo: 'PO-2569-0001', supplierId: null, supplierName: 'Siam Steel', warehouseCode: 'RM',
      lines: [{ ...steel, qty: 50, unitPrice: 33 }],
    });
    expect(r.body.status).toBe('handled');
    expect(await balance(steel.itemId, 'RM')).toBe(50);
  });

  it('records deliveries, production and maintenance consumption even below zero', async () => {
    await t.deliver('production.completed', {
      orderId: randomUUID(), orderNo: 'MO-2569-0001', item: bracket, qty: 10, warehouseCode: 'RM',
      components: [{ ...steel, qty: 5 }, { ...bolt, qty: 40 }],
    });
    expect(await balance(bracket.itemId, 'RM')).toBe(10);
    expect(await balance(steel.itemId, 'RM')).toBe(45);
    expect(await balance(bolt.itemId, 'RM')).toBe(-40);
    await t.deliver('sales.delivered', { orderId: randomUUID(), orderNo: 'SO-2569-0001', warehouseCode: 'RM', lines: [{ ...bracket, qty: 4 }] });
    expect(await balance(bracket.itemId, 'RM')).toBe(6);
    await t.deliver('maintenance.parts_used', { workOrderId: randomUUID(), workOrderNo: 'WO-2569-0001', machineCode: 'PRESS-01', warehouseCode: 'RM', parts: [{ ...steel, qty: 1 }] });
    expect(await balance(steel.itemId, 'RM')).toBe(44);
  });
});
