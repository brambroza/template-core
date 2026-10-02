import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const steel = { itemId: randomUUID(), itemCode: 'RM-SPCC-12', itemName: 'เหล็กแผ่น SPCC 1.2' };
const sus = { itemId: randomUUID(), itemCode: 'RM-SUS304', itemName: 'สแตนเลส' };
const seal = { itemId: randomUUID(), itemCode: 'SP-SEAL', itemName: 'ซีล' };
const bolt = { itemId: randomUUID(), itemCode: 'SP-BOLT', itemName: 'น็อต M8' };
const nut = { itemId: randomUUID(), itemCode: 'SP-NUT', itemName: 'หัวน็อต M8' };

const bal = async (itemId: string, wh: string) => {
  const r = await t.api('GET', `/balances?itemId=${itemId}&warehouseCode=${wh}&nonZero=false`);
  return r.body[0] ?? { onHand: 0, available: 0 };
};
const completed = (over: Record<string, unknown>) => ({
  inspectionId: randomUUID(), no: 'QC-2569-0001', stage: 'incoming', itemCode: steel.itemCode, itemName: steel.itemName, lotNo: null,
  result: 'fail', rejectedQty: 0, itemId: steel.itemId, warehouseCode: 'MAIN', sourceType: 'purchase_order', sourceRef: 'PO-2569-0001', ...over,
});

describe('QC quarantine (QC-HOLD)', () => {
  it('moves rejected qty into an auto-created hold warehouse that is never available', async () => {
    await t.deliver('purchasing.goods_received', { poId: randomUUID(), poNo: 'PO-2569-0001', supplierId: null, supplierName: 'สยามเหล็ก', warehouseCode: 'MAIN', lines: [{ ...steel, qty: 18000, unitPrice: 32 }] });
    const r = await t.deliver('quality.inspection_completed', completed({ no: 'QC-2569-0017', qty: 18000, acceptedQty: 10000, rejectedQty: 8000 }));
    expect(r.body.status).toBe('handled');
    expect(await bal(steel.itemId, 'MAIN')).toMatchObject({ onHand: 10000, available: 10000, isHold: false });
    expect(await bal(steel.itemId, 'QC-HOLD')).toMatchObject({ onHand: 8000, available: 0, isHold: true });
    const wh = (await t.api('GET', '/warehouses')).body.find((w: any) => w.code === 'QC-HOLD');
    expect(wh.is_hold).toBe(true);
    const card = (await t.api('GET', `/items/${steel.itemId}/stock-card?warehouseCode=QC-HOLD`)).body;
    expect(card[0]).toMatchObject({ kind: 'transfer_in', qty: 8000, refType: 'qc_inspection', refId: 'QC-2569-0017' });
    const holds = (await t.api('GET', '/holds?status=pending,rejected')).body;
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ inspection_no: 'QC-2569-0017', qty: 8000, status: 'rejected', status_th: 'ไม่ผ่าน รอตัดสิน', warehouse_code: 'MAIN' });
  });

  it('ignores passed lots and events from an older quality module without a location', async () => {
    await t.deliver('quality.inspection_completed', completed({ result: 'pass', rejectedQty: 0 }));
    await t.deliver('quality.inspection_completed', { ...completed({ rejectedQty: 5 }), itemId: undefined, warehouseCode: undefined });
    expect((await bal(steel.itemId, 'QC-HOLD')).onHand).toBe(8000);
  });

  it('blocks issue, transfer and negative adjustment out of a hold warehouse for everyone — even QC with hold.release (wave 8, N2)', async () => {
    const store = t.token(['inventory.stock.read', 'inventory.move.write']);
    const issue = await t.api('POST', '/issues', { warehouseCode: 'QC-HOLD', lines: [{ ...steel, qty: 10 }] }, { token: store });
    expect(issue.status).toBe(403);
    expect(issue.body.error.message).toMatch(/คลัง QC-HOLD เป็นคลังกักกัน QC .*ปล่อยเข้าคลัง.*ส่งคืนผู้ขาย/);
    expect((await t.api('POST', '/transfers', { fromWarehouseCode: 'QC-HOLD', toWarehouseCode: 'MAIN', lines: [{ ...steel, qty: 10 }] }, { token: store })).status).toBe(403);
    expect((await t.api('POST', '/adjustments', { warehouseCode: 'QC-HOLD', lines: [{ ...steel, qty: -10 }], note: 'x' }, { token: store })).status).toBe(403);
    // into the hold warehouse is fine
    expect((await t.api('POST', '/transfers', { fromWarehouseCode: 'MAIN', toWarehouseCode: 'QC-HOLD', lines: [{ ...steel, qty: 1 }] }, { token: store })).status).toBe(201);
    // QC may release through the hold flow only — not by a plain transfer/issue (the old bypass)
    const qa = t.token(['inventory.stock.read', 'inventory.move.write', 'inventory.hold.release']);
    expect((await t.api('POST', '/transfers', { fromWarehouseCode: 'QC-HOLD', toWarehouseCode: 'MAIN', lines: [{ ...steel, qty: 1 }] }, { token: qa })).status).toBe(403);
    expect((await t.api('POST', '/issues', { warehouseCode: 'QC-HOLD', lines: [{ ...steel, qty: 1 }] }, { token: qa })).status).toBe(403);
    // a reason alone is not enough without inventory.hold.override
    const noPerm = await t.api('POST', '/issues', { warehouseCode: 'QC-HOLD', lines: [{ ...steel, qty: 1 }], overrideHoldReason: 'ลูกค้าขอด่วน' }, { token: qa });
    expect(noPerm.status).toBe(403);
    expect(noPerm.body.error.message).toContain('inventory.hold.override');
    // an admin override needs a real reason
    expect((await t.api('POST', '/issues', { warehouseCode: 'QC-HOLD', lines: [{ ...steel, qty: 1 }], overrideHoldReason: 'x' })).status).toBe(400);
    expect((await bal(steel.itemId, 'QC-HOLD')).onHand).toBe(8001);
  });

  it('admin override with a reason: recorded on the stock card, untracked stock first, then the holds are trimmed and logged', async () => {
    const admin = t.token(['*'], t.tenantId, { userName: 'ผู้ดูแลระบบ' });
    // the 1 kg transferred in by hand above is not under any hold: taking it leaves the hold untouched
    const first = await t.api('POST', '/transfers', { fromWarehouseCode: 'QC-HOLD', toWarehouseCode: 'MAIN', lines: [{ ...steel, qty: 1 }], overrideHoldReason: 'ย้ายผิดคลัง โอนกลับ' }, { token: admin });
    expect(first.status).toBe(201);
    let h = (await t.api('GET', '/holds?status=rejected')).body.find((x: any) => x.inspection_no === 'QC-2569-0017');
    expect(h).toMatchObject({ qty: 8000, hold_on_hand: 8000 });
    expect((await bal(steel.itemId, 'MAIN')).onHand).toBe(10000);
    // now out of a rejected lot itself (another item, so the steel numbers below stay as they were)
    await t.deliver('purchasing.goods_received', { poId: randomUUID(), poNo: 'PO-2569-0009', supplierId: null, supplierName: 'สยามน็อต', warehouseCode: 'MAIN', lines: [{ ...bolt, qty: 1000, unitPrice: 1 }] });
    await t.deliver('quality.inspection_completed', completed({ no: 'QC-2569-0030', itemId: bolt.itemId, itemCode: bolt.itemCode, itemName: bolt.itemName, qty: 1000, acceptedQty: 900, rejectedQty: 100 }));
    const res = await t.api('POST', '/issues', { warehouseCode: 'QC-HOLD', lines: [{ ...bolt, qty: 10 }], overrideHoldReason: 'MD สั่งใช้ทำชิ้นงานทดลอง (ไม่ส่งลูกค้า)' }, { token: admin });
    expect(res.status).toBe(201);
    const card = (await t.api('GET', `/items/${bolt.itemId}/stock-card?warehouseCode=QC-HOLD`)).body;
    expect(card.at(-1)).toMatchObject({ kind: 'issue', qty: -10, note: 'บังคับออกจากคลังกักกัน: MD สั่งใช้ทำชิ้นงานทดลอง (ไม่ส่งลูกค้า)' });
    h = (await t.api('GET', `/holds?itemId=${bolt.itemId}`)).body[0];
    expect(h).toMatchObject({ inspection_no: 'QC-2569-0030', qty: 90, hold_on_hand: 90, status: 'rejected' }); // the hold list matches the stock
    const detail = (await t.api('GET', `/holds/${h.id}`)).body;
    expect(detail.log).toEqual([expect.objectContaining({ kind: 'override', kind_th: 'บังคับจ่ายออก (ผู้ดูแลระบบ)', qty: 10, qty_after: 90, user_name: 'ผู้ดูแลระบบ' })]);
    expect(detail.log[0].note).toContain('MD สั่งใช้ทำชิ้นงานทดลอง');
    expect(detail.note).toContain('บังคับจ่ายออก 10');
    // taking the rest empties the hold: status forced_out
    await t.api('POST', '/adjustments', { warehouseCode: 'QC-HOLD', lines: [{ ...bolt, qty: -90 }], note: 'ทิ้งเป็นเศษเหล็ก', overrideHoldReason: 'MRB ตัดสินทำลาย ไม่ต้องส่งคืน' }, { token: admin });
    expect((await t.api('GET', `/holds/${h.id}`)).body).toMatchObject({ qty: 0, status: 'forced_out', status_th: 'ถูกจ่ายออกนอกขั้นตอน (ดูเหตุผล)' });
  });

  it('another module issuing from QC-HOLD (legacy path) reduces the hold and logs it', async () => {
    await t.deliver('purchasing.goods_received', { poId: randomUUID(), poNo: 'PO-2569-0010', supplierId: null, supplierName: 'สยามน็อต', warehouseCode: 'MAIN', lines: [{ ...nut, qty: 50, unitPrice: 2 }] });
    await t.deliver('quality.inspection_completed', completed({ no: 'QC-2569-0031', itemId: nut.itemId, itemCode: nut.itemCode, itemName: nut.itemName, qty: 50, acceptedQty: 30, rejectedQty: 20 }));
    await t.deliver('sales.delivered', { orderId: randomUUID(), orderNo: 'SO-2569-0099', customerName: 'ลูกค้า', warehouseCode: 'QC-HOLD', lines: [{ ...nut, qty: 5, unitPrice: 3 }] });
    const h = (await t.api('GET', `/holds?itemId=${nut.itemId}`)).body[0];
    expect(h).toMatchObject({ qty: 15, hold_on_hand: 15 });
    const log = (await t.api('GET', `/holds/${h.id}`)).body.log;
    expect(log).toEqual([expect.objectContaining({ kind: 'external', qty: 5, qty_after: 15, ref_type: 'sales_order', ref_id: 'SO-2569-0099' })]);
  });

  it('releases part of a hold back to stock with a note (perm inventory.hold.release)', async () => {
    const h = (await t.api('GET', '/holds?status=rejected')).body.find((x: any) => x.inspection_no === 'QC-2569-0017');
    const store = t.token(['inventory.stock.read', 'inventory.move.write']);
    expect((await t.api('POST', `/holds/${h.id}/release`, { qty: 500, note: 'ใช้ตามสภาพ' }, { token: store })).status).toBe(403);
    expect((await t.api('POST', `/holds/${h.id}/release`, { qty: 500 })).status).toBe(400); // note required
    expect((await t.api('POST', `/holds/${h.id}/release`, { qty: 9000, note: 'x' })).status).toBe(409);
    const r = await t.api('POST', `/holds/${h.id}/release`, { qty: 500, note: 'MRB อนุมัติใช้ตามสภาพ' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ qty: 7500, status: 'rejected' });
    expect((await bal(steel.itemId, 'MAIN')).onHand).toBe(10500);
  });

  it('returns rejected stock to the supplier from QC-HOLD and settles the hold', async () => {
    const r = await t.deliver('purchasing.goods_returned', {
      returnId: randomUUID(), returnNo: 'RT-2569-0001', poId: randomUUID(), poNo: 'PO-2569-0001', supplierId: null, supplierName: 'สยามเหล็ก', warehouseCode: 'QC-HOLD',
      lines: [{ ...steel, qty: 7500, unitPrice: 32, reason: 'ความหนาต่ำกว่าสเปก' }],
    });
    expect(r.body.status).toBe('handled');
    expect((await bal(steel.itemId, 'QC-HOLD')).onHand).toBe(0);
    const h = (await t.api('GET', '/holds')).body.find((x: any) => x.inspection_no === 'QC-2569-0017');
    expect(h).toMatchObject({ qty: 0, status: 'returned' });
    expect((await t.api('GET', `/holds/${h.id}`)).body.log.map((l: any) => [l.kind, l.qty, l.qty_after, l.ref_id])).toEqual([
      ['release', 500, 7500, 'QC-2569-0017'], ['return', 7500, 0, 'RT-2569-0001'],
    ]);
    const card = (await t.api('GET', `/items/${steel.itemId}/stock-card?warehouseCode=QC-HOLD`)).body;
    expect(card.at(-1)).toMatchObject({ kind: 'issue', qty: -7500, refType: 'purchase_return', refId: 'RT-2569-0001' });
  });

  it('receives into hold while the incoming inspection is pending, then releases what passed (setting)', async () => {
    expect((await t.api('PUT', '/settings', { receiveIntoHoldWhenInspected: true }, { token: t.token(['inventory.stock.read']) })).status).toBe(403);
    expect((await t.api('PUT', '/settings', { receiveIntoHoldWhenInspected: true })).body).toEqual({ allowNegative: false, receiveIntoHoldWhenInspected: true });
    expect((await t.api('GET', '/settings')).body.receiveIntoHoldWhenInspected).toBe(true);
    await t.deliver('purchasing.goods_received', { poId: randomUUID(), poNo: 'PO-2569-0002', supplierId: null, supplierName: 'ไทยสแตนเลส', warehouseCode: 'MAIN', lines: [{ ...sus, qty: 300, unitPrice: 118 }] });
    const inspectionId = randomUUID();
    const created = { inspectionId, no: 'QC-2569-0020', stage: 'incoming', itemId: sus.itemId, itemCode: sus.itemCode, itemName: sus.itemName, lotNo: 'H-77', warehouseCode: 'MAIN', qty: 300, sourceType: 'purchase_order', sourceRef: 'PO-2569-0002' };
    await t.deliver('quality.inspection_created', created);
    await t.deliver('quality.inspection_created', created, { id: randomUUID() }); // replay with a new id: still one hold
    expect(await bal(sus.itemId, 'MAIN')).toMatchObject({ onHand: 0 });
    expect(await bal(sus.itemId, 'QC-HOLD')).toMatchObject({ onHand: 300, available: 0 });
    expect((await t.api('GET', '/holds?status=pending')).body.map((h: any) => h.inspection_no)).toEqual(['QC-2569-0020']);
    // MAIN has nothing available, so a user cannot issue the pending lot
    expect((await t.api('POST', '/issues', { warehouseCode: 'MAIN', lines: [{ ...sus, qty: 1 }] })).status).toBe(409);

    await t.deliver('quality.inspection_completed', completed({ inspectionId, no: 'QC-2569-0020', itemId: sus.itemId, itemCode: sus.itemCode, result: 'conditional', qty: 300, acceptedQty: 280, rejectedQty: 20 }));
    expect((await bal(sus.itemId, 'MAIN')).onHand).toBe(280);
    expect((await bal(sus.itemId, 'QC-HOLD')).onHand).toBe(20);
    const h = (await t.api('GET', '/holds')).body.find((x: any) => x.inspection_no === 'QC-2569-0020');
    expect(h).toMatchObject({ held_qty: 300, qty: 20, rejected_qty: 20, status: 'rejected' });

    // final inspections are never received into hold (only incoming)
    await t.deliver('quality.inspection_created', { ...created, inspectionId: randomUUID(), no: 'QC-2569-0021', stage: 'final' });
    expect((await bal(sus.itemId, 'MAIN')).onHand).toBe(280);
    await t.api('PUT', '/settings', { receiveIntoHoldWhenInspected: false });
  });

  it('keeps holds per tenant', async () => {
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('GET', '/holds', undefined, { token: other })).body).toEqual([]);
    const mine = (await t.api('GET', '/holds')).body.find((x: any) => x.inspection_no === 'QC-2569-0030');
    expect((await t.api('GET', `/holds/${mine.id}`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('GET', '/balances', undefined, { token: other })).body).toEqual([]);
  });
});

describe('negative stock is never silent', () => {
  it('records event-driven issues below zero as anomalies and shows them on the dashboard', async () => {
    await t.api('POST', '/warehouses', { code: 'SPARE', name: 'คลังอะไหล่' });
    await t.api('POST', '/receipts', { warehouseCode: 'SPARE', lines: [{ ...seal, qty: 6 }] });
    // the technician closed the job against MAIN (wrong warehouse): recorded, but surfaced
    await t.deliver('maintenance.parts_used', { workOrderId: randomUUID(), workOrderNo: 'WO-2569-0009', machineCode: 'PRESS-02', warehouseCode: 'MAIN', parts: [{ ...seal, qty: 2 }] });
    expect((await bal(seal.itemId, 'MAIN')).onHand).toBe(-2);
    const list = (await t.api('GET', '/anomalies?open=true')).body;
    const a = list.find((x: any) => x.item_code === 'SP-SEAL');
    expect(a).toMatchObject({ warehouse_code: 'MAIN', qty_delta: -2, on_hand_before: 0, on_hand_after: -2, on_hand_now: -2, ref_type: 'work_order', ref_id: 'WO-2569-0009', source: 'event', ref_th: 'ใบสั่งซ่อม (อะไหล่)' });
    const sum = (await t.api('GET', '/summary')).body;
    expect(sum.negative).toBeGreaterThanOrEqual(1);
    expect(sum.negativeRows.find((r: any) => r.itemCode === 'SP-SEAL')).toMatchObject({ warehouseCode: 'MAIN', onHand: -2, shortQty: 2, label: 'SP-SEAL @ MAIN' });
    expect(sum.openAnomalies).toBeGreaterThanOrEqual(1);
    expect(sum.onHold).toBeGreaterThanOrEqual(1); // RM-SUS304 still has 20 in QC-HOLD
  });

  it('records issues allowed by settings too, and blocks direct issues by default', async () => {
    const res = await t.api('POST', '/issues', { warehouseCode: 'SPARE', lines: [{ ...seal, qty: 10 }] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('สต็อกไม่พอ: SP-SEAL ที่คลัง SPARE คงเหลือ 6 ต้องการจ่าย 10 (ขาด 4 · ซีล) — ตรวจว่าเลือกคลังถูกต้อง หรือรับของเข้าก่อน');
    const tr = await t.api('POST', '/transfers', { fromWarehouseCode: 'SPARE', toWarehouseCode: 'MAIN', lines: [{ ...seal, qty: 7 }] });
    expect(tr.status).toBe(409);
    expect((await bal(seal.itemId, 'SPARE')).onHand).toBe(6); // transaction rolled back
    await t.api('PUT', '/settings', { allowNegative: true });
    await t.api('POST', '/issues', { warehouseCode: 'SPARE', lines: [{ ...seal, qty: 7 }] });
    await t.api('PUT', '/settings', { allowNegative: false });
    const a = (await t.api('GET', '/anomalies')).body.find((x: any) => x.warehouse_code === 'SPARE');
    expect(a).toMatchObject({ source: 'user', on_hand_after: -1 });
  });

  it('acknowledges an anomaly with a note (perm inventory.settings.write) and keeps tenants apart', async () => {
    const a = (await t.api('GET', '/anomalies?open=true')).body[0];
    expect((await t.api('POST', `/anomalies/${a.id}/acknowledge`, { note: 'x' }, { token: t.token(['inventory.stock.read', 'inventory.move.write']) })).status).toBe(403);
    expect((await t.api('POST', `/anomalies/${a.id}/acknowledge`, {})).status).toBe(400);
    expect((await t.api('POST', `/anomalies/${a.id}/acknowledge`, { note: 'เลือกคลังผิด โอนกลับแล้ว' })).body).toMatchObject({ acknowledged_note: 'เลือกคลังผิด โอนกลับแล้ว' });
    expect((await t.api('POST', `/anomalies/${a.id}/acknowledge`, { note: 'again' })).status).toBe(409);
    expect((await t.api('GET', '/anomalies?open=true')).body.find((x: any) => x.id === a.id)).toBeUndefined();
    expect((await t.api('GET', '/anomalies?open=false')).body.find((x: any) => x.id === a.id)).toBeDefined();
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('GET', '/anomalies', undefined, { token: other })).body).toEqual([]);
    expect((await t.api('POST', `/anomalies/${a.id}/acknowledge`, { note: 'x' }, { token: other })).status).toBe(404);
  });
});
