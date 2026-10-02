import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition, evaluate, sampleSizeFor, verdict } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const steel = { itemId: randomUUID(), itemCode: 'RM-STEEL', itemName: 'เหล็กแผ่น 2mm' };
const bolt = { itemId: randomUUID(), itemCode: 'RM-BOLT', itemName: 'สกรู M8' };
const bracket = { itemId: randomUUID(), itemCode: 'FG-BRACKET', itemName: 'ขายึด' };

const steelCheckpoints = [
  { name: 'ความหนา', method: 'เวอร์เนียร์', type: 'measure', unit: 'mm', target: 2, min: 1.9, max: 2.1, critical: true },
  { name: 'สนิม', type: 'visual' },
  { name: 'ใบรับรองวัสดุ (Mill cert)', type: 'pass_fail' },
];

const resultsOf = async (id: string) => (await t.api('GET', `/inspections/${id}/results`)).body as any[];
const byName = (rows: any[], name: string) => rows.find((r) => r.name === name);

describe('quality — pure rules', () => {
  it('computes sample size, checkpoint pass/fail and the overall verdict', () => {
    expect(sampleSizeFor('fixed', 5, 100)).toBe(5);
    expect(sampleSizeFor('fixed', 5, 3)).toBe(3);
    expect(sampleSizeFor('percent', 10, 55)).toBe(6);
    expect(sampleSizeFor('percent', 1, 10)).toBe(1);
    const cp = { type: 'measure', min_value: 1.9, max_value: 2.1, name: 'x' };
    expect(evaluate(cp, { value: 2 }).passed).toBe(true);
    expect(evaluate(cp, { value: 2.2 }).passed).toBe(false);
    expect(evaluate(cp, { value: 2, passed: false }).passed).toBe(false);
    expect(() => evaluate({ ...cp, type: 'visual' }, {})).toThrow();
    expect(verdict([{ passed: true, critical: true }])).toBe('pass');
    expect(verdict([{ passed: false, critical: false }, { passed: true, critical: true }])).toBe('conditional');
    expect(verdict([{ passed: false, critical: true }])).toBe('fail');
  });
});

describe('quality — inspection plans', () => {
  let plan: any;

  it('creates a plan with checkpoints and blocks a second active plan for the same item + stage', async () => {
    const r = await t.api('POST', '/plans', { ...steel, stage: 'incoming', samplingMode: 'percent', samplingValue: 10, checkpoints: steelCheckpoints });
    expect(r.status).toBe(201);
    plan = r.body;
    expect(plan).toMatchObject({ name: 'ตรวจรับเข้า RM-STEEL', stage_th: 'ตรวจรับเข้า', active: true, sampling_th: '10% ของล็อต' });
    expect(plan.checkpoints.map((c: any) => [c.seq, c.name, c.critical])).toEqual([[1, 'ความหนา', true], [2, 'สนิม', false], [3, 'ใบรับรองวัสดุ (Mill cert)', false]]);
    expect(plan.checkpoints[0].spec).toBe('เป้า 2 / 1.9–2.1 mm');
    const dup = await t.api('POST', '/plans', { ...steel, stage: 'incoming', samplingValue: 3, checkpoints: [{ name: 'x' }] });
    expect(dup.status).toBe(409);
    // a different stage for the same item is fine
    expect((await t.api('POST', '/plans', { ...steel, stage: 'final', samplingValue: 2, checkpoints: [{ name: 'บรรจุภัณฑ์', type: 'visual' }] })).status).toBe(201);
  });

  it('validates checkpoints and sampling (400)', async () => {
    const noLimits = await t.api('POST', '/plans', { ...bolt, stage: 'incoming', samplingValue: 5, checkpoints: [{ name: 'เส้นผ่าน', type: 'measure' }] });
    expect(noLimits.status).toBe(400);
    expect((await t.api('POST', '/plans', { ...bolt, stage: 'incoming', samplingValue: 5, checkpoints: [{ name: 'x', type: 'measure', min: 5, max: 1 }] })).status).toBe(400);
    expect((await t.api('POST', '/plans', { ...bolt, stage: 'incoming', samplingMode: 'percent', samplingValue: 150, checkpoints: [{ name: 'x' }] })).status).toBe(400);
    expect((await t.api('POST', '/plans', { ...bolt, stage: 'incoming', samplingValue: 5, checkpoints: [] })).status).toBe(400);
    expect((await t.api('POST', '/plans', { ...bolt, stage: 'later', samplingValue: 5, checkpoints: [{ name: 'x' }] })).status).toBe(400);
  });

  it('edits a plan, adds / removes checkpoints, deactivates and reactivates', async () => {
    const bp = (await t.api('POST', '/plans', { ...bolt, stage: 'incoming', samplingValue: 5, checkpoints: [{ name: 'เกลียว' }, { name: 'ผิว', type: 'visual' }] })).body;
    const edited = await t.api('PATCH', `/plans/${bp.id}`, { name: 'IQC สกรู', samplingMode: 'percent', samplingValue: 2 });
    expect(edited.body).toMatchObject({ name: 'IQC สกรู', sampling_mode: 'percent', sampling_value: 2 });
    expect((await t.api('PATCH', `/plans/${bp.id}`, { samplingValue: 300 })).status).toBe(400);
    const added = await t.api('POST', `/plans/${bp.id}/checkpoints`, { name: 'ความยาว', type: 'measure', unit: 'mm', min: 19.8, max: 20.2 });
    expect(added.status).toBe(201);
    expect(added.body.checkpoints.map((c: any) => c.seq)).toEqual([1, 2, 3]);
    const removed = await t.api('POST', `/plans/${bp.id}/checkpoints/remove`, { seq: 1 });
    expect(removed.body.checkpoints.map((c: any) => [c.seq, c.name])).toEqual([[1, 'ผิว'], [2, 'ความยาว']]);
    expect((await t.api('POST', `/plans/${bp.id}/checkpoints/remove`, { seq: 9 })).status).toBe(400);

    expect((await t.api('POST', `/plans/${bp.id}/deactivate`)).body.active).toBe(false);
    expect((await t.api('POST', `/plans/${bp.id}/deactivate`)).status).toBe(409);
    const replacement = await t.api('POST', '/plans', { ...bolt, stage: 'incoming', samplingValue: 3, checkpoints: [{ name: 'เกลียว' }] });
    expect(replacement.status).toBe(201);
    expect((await t.api('POST', `/plans/${bp.id}/activate`)).status).toBe(409); // another active plan exists
    await t.api('POST', `/plans/${replacement.body.id}/deactivate`);
    expect((await t.api('POST', `/plans/${bp.id}/activate`)).body.active).toBe(true);

    const list = await t.api('GET', '/plans?q=RM-BOLT&active=true');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ id: bp.id, checkpoint_count: 2 });
    expect((await t.api('GET', '/plans?stage=final')).body.map((p: any) => p.item_code)).toEqual(['RM-STEEL']);
  });
});

describe('quality — incoming inspection from goods received', () => {
  let insp: any;
  const evId = randomUUID();
  const received = {
    poId: randomUUID(), poNo: 'PO-2569-0007', supplierId: randomUUID(), supplierName: 'สยามสตีล', warehouseCode: 'RM',
    lines: [{ ...steel, qty: 55, unitPrice: 30 }, { itemId: randomUUID(), itemCode: 'RM-PAINT', qty: 10, unitPrice: 100 }],
  };

  it('creates one pending inspection per received line that has an active incoming plan (idempotent)', async () => {
    const r = await t.deliver('purchasing.goods_received', received, { id: evId });
    expect(r.body.status).toBe('handled');
    expect((await t.deliver('purchasing.goods_received', received, { id: evId })).body.status).toBe('duplicate');
    const queue = (await t.api('GET', '/inspections/queue')).body;
    expect(queue).toHaveLength(1); // RM-PAINT has no plan -> skipped
    insp = queue[0];
    expect(insp).toMatchObject({
      stage: 'incoming', status: 'pending', status_th: 'รอตรวจ', item_code: 'RM-STEEL', source_type: 'purchase_order', source_ref: 'PO-2569-0007',
      supplier_name: 'สยามสตีล', qty: 55, sample_size: 6, open_points: 3,
    });
    expect(insp.no).toMatch(/^QC-\d{4}-0001$/);
  });

  it('never throws for events without a plan or with odd data', async () => {
    const r = await t.deliver('purchasing.goods_received', { ...received, lines: [{ itemId: randomUUID(), itemCode: 'NOPLAN', qty: 1, unitPrice: 1 }] });
    expect(r.body.status).toBe('handled');
    expect((await t.api('GET', '/inspections/queue')).body).toHaveLength(1);
  });

  it('records results: measured value out of spec fails, pass/fail marks, state moves to in_progress', async () => {
    const rows = await resultsOf(insp.id);
    expect(rows.map((r) => r.passed_th)).toEqual(['ยังไม่บันทึก', 'ยังไม่บันทึก', 'ยังไม่บันทึก']);
    // a visual checkpoint needs pass/fail, a measure needs a value
    expect((await t.api('POST', `/inspection-results/${byName(rows, 'สนิม').id}`, {})).status).toBe(400);
    expect((await t.api('POST', `/inspection-results/${byName(rows, 'ความหนา').id}/pass`)).status).toBe(400);

    const started = await t.api('POST', `/inspections/${insp.id}/start`, { inspectorName: 'สมหญิง QC' });
    expect(started.body).toMatchObject({ status: 'in_progress', inspector_name: 'สมหญิง QC' });

    const m = await t.api('POST', `/inspection-results/${byName(rows, 'ความหนา').id}`, { value: 2.05 });
    expect(m.body.results[0]).toMatchObject({ value: 2.05, passed: true });
    await t.api('POST', `/inspection-results/${byName(rows, 'สนิม').id}/fail`, { note: 'สนิมที่ขอบ 2 แผ่น' });

    // cannot close while a checkpoint is unrecorded
    const early = await t.api('POST', `/inspections/${insp.id}/complete`, {});
    expect(early.status).toBe(409);
    expect(early.body.error.message).toContain('ใบรับรองวัสดุ');

    await t.api('POST', `/inspection-results/${byName(rows, 'ใบรับรองวัสดุ (Mill cert)').id}/pass`);
    const done = await t.api('POST', `/inspections/${insp.id}/complete`, { rejectedQty: 2 });
    expect(done.body).toMatchObject({ status: 'completed', result: 'conditional', result_th: 'ผ่านแบบมีเงื่อนไข', accepted_qty: 53, rejected_qty: 2, failed_points: 1 });

    // state machine: closed inspections are read-only
    expect((await t.api('POST', `/inspections/${insp.id}/complete`, {})).status).toBe(409);
    expect((await t.api('POST', `/inspections/${insp.id}/start`)).status).toBe(409);
    expect((await t.api('POST', `/inspections/${insp.id}/cancel`)).status).toBe(409);
    expect((await t.api('POST', `/inspection-results/${byName(rows, 'สนิม').id}/pass`)).status).toBe(409);
  });

  it('raises an NCR prefilled from the inspection, only once', async () => {
    const ncr = await t.api('POST', `/inspections/${insp.id}/ncr`, {});
    expect(ncr.status).toBe(201);
    expect(ncr.body).toMatchObject({
      inspection_no: insp.no, item_code: 'RM-STEEL', supplier_name: 'สยามสตีล', source_ref: 'PO-2569-0007', stage: 'incoming',
      severity: 'minor', qty_affected: 2, status: 'open', status_th: 'เปิด',
    });
    expect(ncr.body.no).toMatch(/^NCR-\d{4}-0001$/);
    expect(ncr.body.description).toContain('สนิม');
    expect(ncr.body.failedCheckpoints).toHaveLength(1);
    expect((await t.api('POST', `/inspections/${insp.id}/ncr`, {})).status).toBe(409);
    expect((await t.api('GET', `/inspections/${insp.id}`)).body).toMatchObject({ ncr_no: ncr.body.no });
  });
});

describe('quality — final inspection from production and a critical failure', () => {
  it('queues a final inspection when production completes an item with a final plan; a critical fail rejects the lot', async () => {
    await t.api('POST', '/plans', {
      ...bracket, stage: 'final', samplingValue: 3,
      checkpoints: [{ name: 'ระยะรู', type: 'measure', unit: 'mm', min: 9.9, max: 10.1, critical: true }, { name: 'สีถลอก', type: 'visual' }],
    });
    const r = await t.deliver('production.completed', { orderId: randomUUID(), orderNo: 'MO-2569-0003', item: bracket, qty: 40, warehouseCode: 'FG', components: [] });
    expect(r.body.status).toBe('handled');
    // an item without a final plan is skipped
    await t.deliver('production.completed', { orderId: randomUUID(), orderNo: 'MO-2569-0004', item: { itemId: randomUUID(), itemCode: 'FG-OTHER' }, qty: 5, warehouseCode: 'FG', components: [] });
    const finals = (await t.api('GET', '/inspections?stage=final')).body;
    expect(finals).toHaveLength(1);
    const f = finals[0];
    expect(f).toMatchObject({ source_type: 'production_order', source_ref: 'MO-2569-0003', qty: 40, sample_size: 3, status: 'pending' });

    const rows = await resultsOf(f.id);
    const bulk = await t.api('POST', `/inspections/${f.id}/results`, { results: [
      { resultId: byName(rows, 'ระยะรู').id, value: 10.4, note: 'รูเยื้อง' },
      { resultId: byName(rows, 'สีถลอก').id, passed: true },
    ] });
    expect(bulk.body).toMatchObject({ status: 'in_progress', failed_points: 1, recorded_points: 2 });
    expect((await t.api('POST', `/inspections/${f.id}/complete`, { acceptedQty: 30, rejectedQty: 30 })).status).toBe(400);
    const done = await t.api('POST', `/inspections/${f.id}/complete`, {});
    expect(done.body).toMatchObject({ result: 'fail', accepted_qty: 0, rejected_qty: 40 });
    const ncr = await t.api('POST', `/inspections/${f.id}/ncr`, { disposition: 'rework' });
    expect(ncr.body).toMatchObject({ severity: 'major', disposition: 'rework', qty_affected: 40 });
    expect(ncr.body.description).toContain('วัดได้ 10.4 mm');
  });

  it('creates manual inspections only when a plan exists, cancels pending ones and passes clean lots', async () => {
    const noPlan = await t.api('POST', '/inspections', { stage: 'in_process', ...bracket, qty: 10 });
    expect(noPlan.status).toBe(409);
    expect((await t.api('POST', '/inspections', { stage: 'incoming', ...steel, qty: 0 })).status).toBe(400);
    const m = await t.api('POST', '/inspections', { stage: 'incoming', ...steel, qty: 20, lotNo: 'LOT-2401', sampleSize: 2, supplierName: 'โลหะไทย' });
    expect(m.status).toBe(201);
    expect(m.body).toMatchObject({ source_type: 'manual', lot_no: 'LOT-2401', sample_size: 2, total_points: 3 });
    const results = m.body.results;
    await t.api('POST', `/inspections/${m.body.id}/results`, { results: [
      { resultId: results[0].id, value: 2 }, { resultId: results[1].id, passed: true }, { resultId: results[2].id, passed: true },
    ] });
    const done = await t.api('POST', `/inspections/${m.body.id}/complete`, {});
    expect(done.body).toMatchObject({ result: 'pass', accepted_qty: 20, rejected_qty: 0 });
    expect((await t.api('POST', `/inspections/${m.body.id}/ncr`, {})).status).toBe(409); // passed lots get no NCR

    const c = await t.api('POST', '/inspections', { stage: 'incoming', ...steel, qty: 5 });
    const cancelled = await t.api('POST', `/inspections/${c.body.id}/cancel`, { reason: 'ส่งผิดล็อต' });
    expect(cancelled.body).toMatchObject({ status: 'cancelled', note: 'ยกเลิก: ส่งผิดล็อต' });
    expect((await t.api('POST', `/inspection-results/${c.body.results[0].id}`, { value: 2 })).status).toBe(409);

    expect((await t.api('GET', '/inspections?q=LOT-2401')).body).toHaveLength(1);
    expect((await t.api('GET', '/inspections?status=completed&result=pass')).body).toHaveLength(1);
    expect((await t.api('GET', '/inspections?status=pending,in_progress')).body).toHaveLength(0);
  });
});

describe('quality — NCR and corrective actions', () => {
  let ncr: any;

  it('runs open → investigating → action → closed with root cause, disposition and verified CAs', async () => {
    const r = await t.api('POST', '/ncrs', { description: 'ลูกค้าร้องเรียน ขายึดบิดงอ', ...bracket, qtyAffected: 12, severity: 'critical', sourceRef: 'SO-2569-0010' });
    expect(r.status).toBe(201);
    ncr = r.body;
    expect(ncr).toMatchObject({ status: 'open', severity_th: 'วิกฤต', item_code: 'FG-BRACKET' });
    expect((await t.api('POST', `/ncrs/${ncr.id}/close`, {})).status).toBe(409); // must investigate first

    const inv = await t.api('POST', `/ncrs/${ncr.id}/investigate`, { whyAnalysis: '1) งอ เพราะแพ็คแน่น 2) …' });
    expect(inv.body).toMatchObject({ status: 'investigating', status_th: 'กำลังสอบสวน' });
    expect((await t.api('POST', `/ncrs/${ncr.id}/investigate`, {})).status).toBe(409);

    const ca = await t.api('POST', `/ncrs/${ncr.id}/actions`, { action: 'เปลี่ยนกล่องเป็นแบบมีช่องกั้น', ownerName: 'หัวหน้าแพ็ค', dueOn: '2020-01-31' });
    expect(ca.status).toBe(201);
    expect(ca.body.status).toBe('action');
    expect(ca.body.actions[0]).toMatchObject({ status: 'open', overdue: true });
    expect(ca.body.actions[0].no).toMatch(/^CA-\d{4}-0001$/);

    // close needs root cause + disposition, and no open CA
    const missing = await t.api('POST', `/ncrs/${ncr.id}/close`, {});
    expect(missing.status).toBe(409);
    expect(missing.body.error.message).toContain('สาเหตุราก');
    const edited = await t.api('PATCH', `/ncrs/${ncr.id}`, { rootCause: 'ไม่มีมาตรฐานการบรรจุ', disposition: 'rework' });
    expect(edited.body).toMatchObject({ root_cause: 'ไม่มีมาตรฐานการบรรจุ', disposition_th: 'แก้ไขงาน (Rework)' });
    const blocked = await t.api('POST', `/ncrs/${ncr.id}/close`, {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain('การแก้ไขค้าง');

    const overdue = await t.api('GET', '/corrective-actions?overdue=true');
    expect(overdue.body).toHaveLength(1);
    const caId = overdue.body[0].id;
    expect((await t.api('POST', `/corrective-actions/${caId}/verify`, {})).status).toBe(409);
    expect((await t.api('POST', `/corrective-actions/${caId}/done`, { note: 'ใช้กล่องใหม่แล้ว' })).body).toMatchObject({ status: 'done', overdue: false });
    expect((await t.api('POST', `/corrective-actions/${caId}/done`, {})).status).toBe(409);
    expect((await t.api('POST', `/corrective-actions/${caId}/verify`, { note: 'ไม่พบซ้ำ 1 เดือน' })).body.status).toBe('verified');

    const closed = await t.api('POST', `/ncrs/${ncr.id}/close`, {});
    expect(closed.body).toMatchObject({ status: 'closed', status_th: 'ปิดแล้ว' });
    expect(closed.body.closed_at).toBeTruthy();
    expect((await t.api('PATCH', `/ncrs/${ncr.id}`, { description: 'x' })).status).toBe(409);
    expect((await t.api('POST', `/ncrs/${ncr.id}/actions`, { action: 'x' })).status).toBe(409);
    expect((await t.api('POST', `/ncrs/${ncr.id}/close`, {})).status).toBe(409);
  });

  it('closes a minor NCR straight from investigation when root cause + disposition are given', async () => {
    const n = (await t.api('POST', '/ncrs', { description: 'ฉลากพิมพ์ไม่ชัด', severity: 'minor' })).body;
    await t.api('POST', `/ncrs/${n.id}/investigate`, {});
    const closed = await t.api('POST', `/ncrs/${n.id}/close`, { rootCause: 'หัวพิมพ์สกปรก', disposition: 'use_as_is' });
    expect(closed.body).toMatchObject({ status: 'closed', root_cause: 'หัวพิมพ์สกปรก', disposition: 'use_as_is' });
  });

  it('validates NCR input and lists / searches', async () => {
    expect((await t.api('POST', '/ncrs', { severity: 'minor' })).status).toBe(400);
    expect((await t.api('POST', '/ncrs', { description: 'x', severity: 'huge' })).status).toBe(400);
    expect((await t.api('POST', '/ncrs', { description: 'x', itemId: randomUUID() })).status).toBe(400);
    expect((await t.api('POST', `/ncrs/${ncr.id}/actions`, {})).status).toBe(400);
    expect((await t.api('GET', '/ncrs?q=บิดงอ')).body.map((n: any) => n.no)).toEqual([ncr.no]);
    expect((await t.api('GET', '/ncrs?open=true')).body.every((n: any) => n.status !== 'closed')).toBe(true);
    expect((await t.api('GET', '/ncrs?severity=critical')).body).toHaveLength(1);
    expect((await t.api('GET', `/ncrs/${randomUUID()}`)).status).toBe(404);
  });
});

describe('quality — reports and dashboard', () => {
  it('summarises pass rate, open NCRs, overdue actions, defects and supplier quality', async () => {
    const sum = (await t.api('GET', '/summary')).body;
    expect(sum).toMatchObject({ pendingInspections: 0, inspectedMonth: 3, failedMonth: 1, passRateMonth: 33.3, openNcr: 2, overdueActions: 0 });
    expect(sum.months).toHaveLength(6);
    expect(sum.months[5]).toMatchObject({ inspections: 3, passed: 1, pass_rate: 33.3 });
    expect(sum.rows.map((r: any) => r.status)).toEqual(['open', 'open']);
    expect(sum.defects.map((d: any) => d.label).sort()).toEqual(['ระยะรู', 'สนิม']);

    const pass = (await t.api('GET', '/reports/pass-rate?months=3')).body;
    expect(pass).toHaveLength(3);
    expect(pass[0]).toMatchObject({ inspections: 3, passed: 1, conditional: 1, failed: 1, rejected_qty: 42 });

    const byItem = (await t.api('GET', '/reports/defects?by=item')).body;
    expect(byItem.map((d: any) => d.label).sort()).toEqual(['FG-BRACKET ขายึด', 'RM-STEEL เหล็กแผ่น 2mm']);
    const byCp = (await t.api('GET', '/reports/defects?stage=final')).body;
    expect(byCp).toEqual([expect.objectContaining({ label: 'ระยะรู', fails: 1, checks: 1, fail_rate: 100 })]);

    const sup = (await t.api('GET', '/reports/suppliers')).body;
    expect(sup.map((s: any) => [s.supplier, s.pass_rate])).toEqual([['สยามสตีล', 0], ['โลหะไทย', 100]]);

    const sev = (await t.api('GET', '/reports/ncr-severity')).body;
    expect(sev.map((s: any) => [s.severity, s.open, s.closed])).toEqual([['critical', 0, 1], ['major', 1, 0], ['minor', 1, 1]]);
  });
});

describe('quality — permissions and tenant isolation', () => {
  it('requires permissions', async () => {
    const reader = t.token(['quality.inspection.read', 'quality.plan.read', 'quality.ncr.read']);
    expect((await t.api('POST', '/plans', { ...bolt, stage: 'final', samplingValue: 1, checkpoints: [{ name: 'x' }] }, { token: reader })).status).toBe(403);
    expect((await t.api('POST', '/inspections', { stage: 'incoming', ...steel, qty: 1 }, { token: reader })).status).toBe(403);
    expect((await t.api('POST', '/ncrs', { description: 'x' }, { token: reader })).status).toBe(403);
    expect((await t.api('GET', '/inspections', undefined, { token: reader })).status).toBe(200);
    const inspector = t.token(['quality.inspection.record', 'quality.ncr.write']);
    expect((await t.api('GET', '/inspections', undefined, { token: inspector })).status).toBe(403);
    const n = (await t.api('POST', '/ncrs', { description: 'perm test' }, { token: inspector })).body;
    await t.api('POST', `/ncrs/${n.id}/investigate`, {}, { token: inspector });
    expect((await t.api('POST', `/ncrs/${n.id}/close`, { rootCause: 'x', disposition: 'scrap' }, { token: inspector })).status).toBe(403);
    expect((await t.api('GET', '/summary', undefined, { token: t.token(['quality.ncr.read']) })).status).toBe(403);
  });

  it('isolates tenants', async () => {
    const other = t.token(['*'], t.otherTenantId);
    for (const path of ['/plans', '/inspections', '/inspections/queue', '/ncrs', '/corrective-actions', '/reports/suppliers']) {
      expect((await t.api('GET', path, undefined, { token: other })).body, path).toHaveLength(0);
    }
    const mine = (await t.api('GET', '/inspections')).body[0];
    expect((await t.api('GET', `/inspections/${mine.id}`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('GET', '/summary', undefined, { token: other })).body).toMatchObject({ pendingInspections: 0, openNcr: 0, inspectedMonth: 0 });
    // the other tenant has no plan, so the same goods receipt creates nothing there
    await t.deliver('purchasing.goods_received', {
      poId: randomUUID(), poNo: 'PO-X', supplierId: null, supplierName: 'X', warehouseCode: 'RM', lines: [{ ...steel, qty: 5, unitPrice: 1 }],
    }, { tenantId: t.otherTenantId });
    expect((await t.api('GET', '/inspections', undefined, { token: other })).body).toHaveLength(0);
    // a plan with the same item in the other tenant is allowed (uniqueness is per tenant)
    expect((await t.api('POST', '/plans', { ...steel, stage: 'incoming', samplingValue: 1, checkpoints: [{ name: 'x' }] }, { token: other })).status).toBe(201);
  });
});

describe('quality — events (for Automation alerts)', () => {
  it('publishes inspection_completed with the verdict and ncr_raised with the severity', async () => {
    const done = (await t.published('quality.inspection_completed')).map((e) => e.data);
    expect(done.find((d: any) => d.itemCode === 'RM-STEEL' && d.result === 'conditional')).toMatchObject({ stage: 'incoming', itemName: 'เหล็กแผ่น 2mm', rejectedQty: 2 });
    expect(done.find((d: any) => d.itemCode === 'FG-BRACKET')).toMatchObject({ stage: 'final', result: 'fail', rejectedQty: 40, lotNo: null });
    expect(done.every((d: any) => /^QC-\d{4}-\d{4}$/.test(d.no))).toBe(true);
    const ncrs = (await t.published('quality.ncr_raised')).map((e) => e.data);
    expect(ncrs[0]).toMatchObject({ severity: 'minor', itemCode: 'RM-STEEL' });
    expect(ncrs[0].no).toMatch(/^NCR-\d{4}-0001$/);
    expect(ncrs[0].description).toContain('สนิม');
    expect(ncrs.find((d: any) => d.severity === 'critical')).toMatchObject({ itemCode: 'FG-BRACKET', description: 'ลูกค้าร้องเรียน ขายึดบิดงอ' });
    const before = ncrs.length;
    expect((await t.api('POST', '/ncrs', { description: '' })).status).toBe(400);
    expect((await t.published('quality.ncr_raised')).length).toBe(before);
  });
});
