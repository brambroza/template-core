import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definition as identity } from '@erp/svc-identity';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as inventory } from '@erp/svc-inventory';
import { definition as purchasing } from '@erp/svc-purchasing';
import { definition as sales } from '@erp/svc-sales';
import { definition as production } from '@erp/svc-production';
import { definition as maintenance } from '@erp/svc-maintenance';
import { definition as costing } from '@erp/svc-costing';
import { install, type Installation } from './helpers.ts';

/** A customer who bought every module: events flow end to end through the gateway. */
let erp: Installation;
let token: string;
beforeAll(async () => {
  erp = await install([identity, masterData, inventory, purchasing, sales, production, maintenance, costing]);
  ({ token } = await erp.provision('full-co'));
});
afterAll(async () => { await erp?.close(); });

const api = (method: string, path: string, body?: unknown) => erp.call(method, path, body, token);
const onHand = async (itemId: string, wh: string) => (await api('GET', `/api/inventory/balances?itemId=${itemId}&warehouseCode=${wh}&nonZero=false`)).body[0]?.onHand ?? 0;

describe('full ERP installation', () => {
  const items: Record<string, { itemId: string; itemCode: string; itemName: string }> = {};

  it('lists all installed modules in the catalog', async () => {
    const cat = await erp.call('GET', '/api/_catalog');
    expect(cat.body.modules.map((m: any) => m.id).sort()).toEqual(['costing', 'identity', 'inventory', 'maintenance', 'master-data', 'production', 'purchasing', 'sales']);
  });

  it('sets up master data through the gateway', async () => {
    for (const [code, name, type] of [['RM-STEEL', 'เหล็กแผ่น', 'raw'], ['SP-BOLT', 'น็อต M8', 'raw'], ['FG-BRACKET', 'ขายึด', 'finished']]) {
      const r = await api('POST', '/api/master-data/items', { code, name, type });
      expect(r.status).toBe(201);
      items[code] = { itemId: r.body.id, itemCode: code, itemName: name };
    }
  });

  it('purchase -> stock in + moving-average cost', async () => {
    const po = (await api('POST', '/api/purchasing/purchase-orders', {
      supplierName: 'Siam Steel', warehouseCode: 'MAIN',
      lines: [{ ...items['RM-STEEL'], qty: 100, unitPrice: 32 }, { ...items['SP-BOLT'], qty: 1000, unitPrice: 1.5 }],
    })).body;
    // a one-person installation: the admin raises and approves (wave 8 SoD is on by default, the company switches it off)
    expect((await api('POST', `/api/purchasing/purchase-orders/${po.id}/approve`)).status).toBe(403);
    await api('PUT', '/api/purchasing/settings', { creatorCannotApprove: false });
    await api('POST', `/api/purchasing/purchase-orders/${po.id}/approve`);
    await api('POST', `/api/purchasing/purchase-orders/${po.id}/receive`);
    await erp.settle();
    expect(await onHand(items['RM-STEEL'].itemId, 'MAIN')).toBe(100);
    expect(await onHand(items['SP-BOLT'].itemId, 'MAIN')).toBe(1000);
    const costs = (await api('GET', '/api/costing/item-costs')).body;
    expect(costs.find((c: any) => c.item_code === 'RM-STEEL').avg_cost).toBe(32);
  });

  it('production -> components consumed, finished goods in, job cost recorded', async () => {
    await api('PUT', '/api/production/boms', { ...items['FG-BRACKET'], lines: [{ ...items['RM-STEEL'], qty: 0.5 }, { ...items['SP-BOLT'], qty: 4 }] });
    const mo = (await api('POST', '/api/production/orders', { ...items['FG-BRACKET'], qty: 20, warehouseCode: 'MAIN' })).body;
    await api('POST', `/api/production/orders/${mo.id}/release`);
    await api('POST', `/api/production/orders/${mo.id}/complete`);
    await erp.settle();
    expect(await onHand(items['RM-STEEL'].itemId, 'MAIN')).toBe(90);
    expect(await onHand(items['SP-BOLT'].itemId, 'MAIN')).toBe(920);
    expect(await onHand(items['FG-BRACKET'].itemId, 'MAIN')).toBe(20);
    const job = (await api('GET', '/api/costing/job-costs')).body[0];
    expect(job).toMatchObject({ order_no: mo.no, material_cost: 440, unit_cost: 22 }); // 10 kg * 32 + 80 bolts * 1.5
  });

  it('sales delivery cuts finished goods; tax invoice is printable', async () => {
    const so = (await api('POST', '/api/sales/orders', { customerName: 'ลูกค้า ก', warehouseCode: 'MAIN', lines: [{ ...items['FG-BRACKET'], qty: 15, unitPrice: 50 }] })).body;
    await api('POST', `/api/sales/orders/${so.id}/confirm`);
    await api('POST', `/api/sales/orders/${so.id}/deliver`);
    const inv = (await api('POST', `/api/sales/orders/${so.id}/invoice`)).body;
    expect(inv).toMatchObject({ gross: 802.5, amountText: 'แปดร้อยสองบาทห้าสิบสตางค์' });
    await erp.settle();
    expect(await onHand(items['FG-BRACKET'].itemId, 'MAIN')).toBe(5);
  });

  it('maintenance spare parts are issued from stock', async () => {
    const m = (await api('POST', '/api/maintenance/machines', { code: 'PRESS-01', name: 'Press' })).body;
    const wo = (await api('POST', '/api/maintenance/work-orders', { machineId: m.id, title: 'น็อตหลุด' })).body;
    await api('POST', `/api/maintenance/work-orders/${wo.id}/complete`, { resolution: 'ขันน็อตใหม่', warehouseCode: 'MAIN', parts: [{ ...items['SP-BOLT'], qty: 6 }] });
    await erp.settle();
    expect(await onHand(items['SP-BOLT'].itemId, 'MAIN')).toBe(914);
  });

  it('keeps the stock card traceable to source documents', async () => {
    const card = (await api('GET', `/api/inventory/items/${items['SP-BOLT'].itemId}/stock-card`)).body;
    expect(card.map((r: any) => r.refType)).toEqual(['purchase_order', 'production_order', 'work_order']);
  });

  it('summarises every module for the dashboard', async () => {
    const [inv, po, so, mo, mt, cs, md] = await Promise.all(['inventory', 'purchasing', 'sales', 'production', 'maintenance', 'costing', 'master-data'].map((m) => api('GET', `/api/${m}/summary`)));
    expect(inv.body.skus).toBe(3);
    expect(po.body.toReceive).toBe(0);
    expect(so.body.revenueMonth).toBe(802.5);
    expect(mo.body.outputMonth).toBe(20);
    expect(mt.body.machines).toHaveLength(1);
    expect(cs.body.itemsCosted).toBe(2);
    expect(md.body).toMatchObject({ items: 3 });
  });

  it('rejects calls without a token at every module', async () => {
    expect((await erp.call('GET', '/api/sales/orders')).status).toBe(401);
    expect((await erp.call('GET', '/api/inventory/balances')).status).toBe(401);
  });
});
