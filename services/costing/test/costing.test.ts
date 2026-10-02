import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const steel = { itemId: randomUUID(), itemCode: 'RM-STEEL' };
const bolt = { itemId: randomUUID(), itemCode: 'SP-BOLT' };
const bracket = { itemId: randomUUID(), itemCode: 'FG-BRACKET' };

describe('costing (standalone, manual costs)', () => {
  it('refuses a cost sheet with unpriced materials, then computes one', async () => {
    const sheet = { ...bracket, qty: 100, materials: [{ ...steel, qty: 50 }, { ...bolt, qty: 400 }], laborHours: 8, laborRatePerHour: 75, overheadPct: 20 };
    const missing = await t.api('POST', '/cost-sheets', sheet);
    expect(missing.status).toBe(422);
    expect(missing.body.error.details).toEqual(['RM-STEEL', 'SP-BOLT']);
    await t.api('PUT', `/item-costs/${steel.itemId}`, { itemCode: 'RM-STEEL', cost: 30 });
    await t.api('PUT', `/item-costs/${bolt.itemId}`, { itemCode: 'SP-BOLT', cost: 1.25 });
    const ok = await t.api('POST', '/cost-sheets', sheet);
    expect(ok.status).toBe(201);
    // material 1500 + 500 = 2000, labour 600, overhead 20% of 2600 = 520
    expect(ok.body).toMatchObject({ material_cost: 2000, labor_cost: 600, overhead_cost: 520, total_cost: 3120, unit_cost: 31.2 });
  });
});

describe('costing (with purchasing and production installed)', () => {
  it('keeps a quantity-weighted moving average from goods receipts', async () => {
    const receive = (qty: number, unitPrice: number) => t.deliver('purchasing.goods_received', {
      poId: randomUUID(), poNo: 'PO', supplierId: null, supplierName: 'S', warehouseCode: 'RM', lines: [{ ...steel, qty, unitPrice }],
    });
    await receive(100, 32);
    await receive(300, 36);
    const costs = await t.api('GET', '/item-costs');
    // manual 30 is replaced by purchases: first receipt resets basis 0 -> (0*30 + 100*32)/100 = 32, then (100*32 + 300*36)/400 = 35
    expect(costs.body.find((c: any) => c.item_code === 'RM-STEEL')).toMatchObject({ avg_cost: 35, last_cost: 36, qty_basis: 400, source: 'purchase' });
  });

  it('records actual job cost when production completes', async () => {
    await t.deliver('production.completed', {
      orderId: randomUUID(), orderNo: 'MO-2569-0001', item: bracket, qty: 10, warehouseCode: 'FG',
      components: [{ ...steel, qty: 5 }, { ...bolt, qty: 40 }],
    });
    const jobs = await t.api('GET', '/job-costs');
    expect(jobs.body[0]).toMatchObject({ order_no: 'MO-2569-0001', material_cost: 225, unit_cost: 22.5, missing_costs: [] });
  });
});
