import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const steel = { itemId: randomUUID(), itemCode: 'RM-SPCC-12', itemName: 'เหล็กแผ่น SPCC 1.2' };

describe('quality — data Inventory needs for QC quarantine (wave 4)', () => {
  it('announces each new inspection with item id, warehouse and qty, and completes with the lot location', async () => {
    await t.api('POST', '/plans', { ...steel, stage: 'incoming', name: 'ตรวจรับเหล็ก', samplingValue: 5,
      checkpoints: [{ name: 'ความหนา', type: 'measure', unit: 'มม.', min: 1.14, max: 1.26, critical: true }] });
    await t.deliver('purchasing.goods_received', {
      poId: randomUUID(), poNo: 'PO-2569-0031', supplierId: null, supplierName: 'สยามเหล็ก', warehouseCode: 'MAIN', lines: [{ ...steel, qty: 18000, unitPrice: 32 }],
    });
    const created = (await t.published('quality.inspection_created')).map((e) => e.data);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ stage: 'incoming', itemId: steel.itemId, itemCode: 'RM-SPCC-12', warehouseCode: 'MAIN', qty: 18000, sourceType: 'purchase_order', sourceRef: 'PO-2569-0031' });

    const insp = (await t.api('GET', '/inspections/queue')).body[0];
    const [r] = (await t.api('GET', `/inspections/${insp.id}/results`)).body;
    await t.api('POST', `/inspection-results/${r.id}`, { value: 1.1 });
    const done = await t.api('POST', `/inspections/${insp.id}/complete`, { acceptedQty: 10000, rejectedQty: 8000 });
    expect(done.body).toMatchObject({ result: 'fail', rejected_qty: 8000, warehouse_code: 'MAIN' });
    const ev = (await t.published('quality.inspection_completed')).map((e) => e.data).find((d) => d.no === insp.no);
    expect(ev).toMatchObject({ itemId: steel.itemId, warehouseCode: 'MAIN', qty: 18000, acceptedQty: 10000, rejectedQty: 8000, sourceType: 'purchase_order', sourceRef: 'PO-2569-0031' });

    // NCR with disposition "return to supplier" points the buyer at the PO
    const ncr = (await t.api('POST', `/inspections/${insp.id}/ncr`, { disposition: 'return_to_supplier' })).body;
    expect(ncr.return_hint).toContain('PO-2569-0031');
    expect(ncr.return_hint).toContain(ncr.no);
    const other = (await t.api('POST', '/ncrs', { description: 'ลูกค้าเคลม', severity: 'minor', disposition: 'rework' })).body;
    expect(other.return_hint).toBe('');
  });

  it('a manual inspection can carry the warehouse (optional)', async () => {
    const res = await t.api('POST', '/inspections', { ...steel, stage: 'incoming', qty: 100, warehouseCode: 'MAIN', lotNo: 'H-1' });
    expect(res.status).toBe(201);
    expect(res.body.warehouse_code).toBe('MAIN');
    const ev = (await t.published('quality.inspection_created')).map((e) => e.data).find((d) => d.no === res.body.no);
    expect(ev).toMatchObject({ sourceType: 'manual', warehouseCode: 'MAIN', lotNo: 'H-1', qty: 100 });
  });
});
