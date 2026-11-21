import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signToken } from '@erp/kernel';
import { TEST_JWT_SECRET } from '@erp/kernel/testing';
import { definition as identity } from '@erp/svc-identity';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as inventory } from '@erp/svc-inventory';
import { definition as purchasing } from '@erp/svc-purchasing';
import { definition as costing } from '@erp/svc-costing';
import { definition as accounting } from '@erp/svc-accounting';
import { definition as quality } from '@erp/svc-quality';
import { definition as production } from '@erp/svc-production';
import { definition as sales } from '@erp/svc-sales';
import { install, type Installation } from './helpers.ts';

/** "ผลกระทบเมื่อกดยืนยัน" end to end: a dry-run goods receipt, then every subscriber says what it would do — and nothing is saved. */
let erp: Installation;
let token: string;
let tenantId: string;
beforeAll(async () => {
  erp = await install([identity, masterData, inventory, purchasing, costing, accounting, quality, production, sales]);
  ({ token, tenantId } = await erp.provision('impact-co'));
});
afterAll(async () => { await erp?.close(); });

const api = (method: string, path: string, body?: unknown, as = token) => erp.call(method, path, body, as);

describe('impact preview of receiving goods', () => {
  let poId = '';
  let steel = { itemId: '', itemCode: 'RM-SPCC', itemName: 'เหล็กแผ่น SPCC' };

  it('sets up stock, cost, a chart of accounts and an incoming QC plan', async () => {
    steel = { ...steel, itemId: (await api('POST', '/api/master-data/items', { code: steel.itemCode, name: steel.itemName, type: 'raw' })).body.id };
    await api('PUT', '/api/purchasing/settings', { creatorCannotApprove: false });
    await api('POST', '/api/accounting/accounts/setup');
    const first = (await api('POST', '/api/purchasing/purchase-orders', { supplierName: 'สยามเหล็ก', warehouseCode: 'MAIN', lines: [{ ...steel, qty: 100, unitPrice: 30 }] })).body;
    await api('POST', `/api/purchasing/purchase-orders/${first.id}/approve`);
    await api('POST', `/api/purchasing/purchase-orders/${first.id}/receive`);
    await erp.settle();
    expect((await api('POST', '/api/quality/plans', { ...steel, stage: 'incoming', samplingValue: 5, checkpoints: [{ name: 'ความหนา' }] })).status).toBe(201);
    const po = (await api('POST', '/api/purchasing/purchase-orders', { supplierName: 'สยามเหล็ก', warehouseCode: 'MAIN', lines: [{ ...steel, qty: 300, unitPrice: 34 }] })).body;
    await api('POST', `/api/purchasing/purchase-orders/${po.id}/approve`);
    poId = po.id;
  });

  it('dry-runs the receipt, then stock, cost, accounting and QC describe their part', async () => {
    const dry = await api('POST', `/api/purchasing/purchase-orders/${poId}/receive?_dryRun=1`, {});
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, result: { status: 'received' } });
    expect(dry.body.events.map((e: any) => e.type)).toEqual(['purchasing.goods_received']);

    const r = await api('POST', '/api/_impact', { events: dry.body.events });
    expect(r.status).toBe(200);
    const by = Object.fromEntries(r.body.impacts.map((g: any) => [g.module, g.lines.map((l: any) => l.text)]));
    expect(Object.keys(by).sort()).toEqual(['accounting', 'costing', 'inventory', 'quality']);
    expect(by.inventory).toEqual(['สต็อก RM-SPCC เหล็กแผ่น SPCC คลัง MAIN: 100 → 400 (+300)']);
    expect(by.costing).toEqual(['ต้นทุนเฉลี่ย RM-SPCC: 30.00 → 33.00 บาท/หน่วย (+10.0%)']);
    expect(by.quality[0]).toContain('เปิดงานตรวจรับ QC: RM-SPCC 300 หน่วย');
    expect(by.accounting[0]).toMatch(/^ลงบัญชีอัตโนมัติ ลงวันที่ \d{1,2} \S+ 25\d\d$/);
    expect(by.accounting.filter((l: string) => l.startsWith('Dr')).length).toBeGreaterThan(0);
    expect(by.accounting.filter((l: string) => l.startsWith('Cr')).length).toBeGreaterThan(0);
    expect(by.accounting.join('\n')).toContain('10,200.00'); // 300 × 34 before VAT

    // nothing happened anywhere
    await erp.settle();
    expect((await api('GET', `/api/purchasing/purchase-orders/${poId}`)).body.status).toBe('approved');
    expect((await api('GET', `/api/inventory/balances?itemId=${steel.itemId}&warehouseCode=MAIN&nonZero=false`)).body[0].onHand).toBe(100);
    expect((await api('GET', '/api/quality/inspections')).body.filter((i: any) => i.qty === 300)).toEqual([]);
  });

  it('shows a refusal before the button is pressed, and only what the caller may see', async () => {
    const clerk = signToken(TEST_JWT_SECRET, { tenantId, userId: '00000000-0000-4000-8000-0000000000c1', perms: ['purchasing.po.read', 'purchasing.po.receive', 'inventory.stock.read'] });
    const dry = await api('POST', `/api/purchasing/purchase-orders/${poId}/receive?_dryRun=1`, {}, clerk);
    const r = await api('POST', '/api/_impact', { events: dry.body.events }, clerk);
    expect(r.body.impacts.map((g: any) => g.module)).toEqual(['inventory']);

    const tooMuch = await api('POST', `/api/purchasing/purchase-orders/${poId}/receive?_dryRun=1`, { lines: [{ lineId: (await api('GET', `/api/purchasing/purchase-orders/${poId}`)).body.lines[0].id, qty: 999 }] });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.message).toContain('เกินจำนวนค้างรับ');
    expect((await erp.call('POST', '/api/_impact', { events: dry.body.events })).status).toBe(401);
  });
});

describe('impact preview of a production report and a delivery', () => {
  it('shows materials issued, finished goods in, job cost and the final QC; then a delivery that would go below zero', async () => {
    const steel = (await api('GET', '/api/master-data/items?q=RM-SPCC')).body[0];
    const fg = (await api('POST', '/api/master-data/items', { code: 'FG-BOX', name: 'กล่องเหล็ก', type: 'finished' })).body;
    await api('PUT', '/api/production/boms', { itemId: fg.id, itemCode: 'FG-BOX', itemName: 'กล่องเหล็ก', lines: [{ itemId: steel.id, itemCode: 'RM-SPCC', itemName: steel.name, qty: 2 }] });
    expect((await api('POST', '/api/quality/plans', { itemId: fg.id, itemCode: 'FG-BOX', stage: 'final', samplingValue: 2, checkpoints: [{ name: 'รอยเชื่อม' }] })).status).toBe(201);
    const mo = (await api('POST', '/api/production/orders', { itemId: fg.id, itemCode: 'FG-BOX', itemName: 'กล่องเหล็ก', qty: 10, warehouseCode: 'MAIN' })).body;
    await api('POST', `/api/production/orders/${mo.id}/release`);

    const dry = await api('POST', `/api/production/orders/${mo.id}/complete?_dryRun=1`, {});
    expect(dry.body.dryRun).toBe(true);
    const r = await api('POST', '/api/_impact', { events: dry.body.events });
    const by = Object.fromEntries(r.body.impacts.map((g: any) => [g.module, g.lines.map((l: any) => l.text)]));
    expect(by.inventory).toEqual([
      'สต็อก RM-SPCC เหล็กแผ่น SPCC คลัง MAIN: 100 → 80 (-20)',
      'สต็อก FG-BOX กล่องเหล็ก คลัง MAIN: 0 → 10 (+10)',
    ]);
    expect(by.costing[0]).toBe(`ต้นทุนวัตถุดิบงาน ${mo.no}: 600.00 บาท · ต่อชิ้น FG-BOX 60.00 บาท`); // 20 × 30
    expect(by.quality[0]).toContain('เปิดงานตรวจขั้นสุดท้าย QC: FG-BOX 10 ชิ้น');
    await erp.settle();
    expect((await api('GET', `/api/production/orders/${mo.id}`)).body.status).toBe('released');

    const so = (await api('POST', '/api/sales/orders', { customerName: 'ลูกค้า ก', warehouseCode: 'MAIN', lines: [{ itemId: steel.id, itemCode: 'RM-SPCC', itemName: steel.name, qty: 150, unitPrice: 50 }] })).body;
    await api('POST', `/api/sales/orders/${so.id}/confirm`);
    const ship = await api('POST', `/api/sales/orders/${so.id}/deliver?_dryRun=1`, {});
    const lines = (await api('POST', '/api/_impact', { events: ship.body.events })).body.impacts.flatMap((g: any) => g.lines);
    expect(lines).toEqual([{ text: 'สต็อก RM-SPCC เหล็กแผ่น SPCC คลัง MAIN: 100 → -50 (-150) — สต็อกติดลบ ตรวจสอบก่อนยืนยัน', tone: 'stop' }]);
  });
});
