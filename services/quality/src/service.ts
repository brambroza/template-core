import {
  auth, badRequest, conflict, loadManifest, nextDocNo, one, parse, requirePerm, s, z,
  type Client, type EventHandlers, type ServiceDefinition,
} from '@erp/kernel';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- Thai labels (returned as *_th fields so screens show Thai text) ---------------- */

export const TH = {
  stage: { incoming: 'ตรวจรับเข้า', in_process: 'ระหว่างผลิต', final: 'ก่อนส่งมอบ' } as Record<string, string>,
  status: { pending: 'รอตรวจ', in_progress: 'กำลังตรวจ', completed: 'ตรวจเสร็จ', cancelled: 'ยกเลิก' } as Record<string, string>,
  result: { pass: 'ผ่าน', fail: 'ไม่ผ่าน', conditional: 'ผ่านแบบมีเงื่อนไข' } as Record<string, string>,
  type: { measure: 'วัดค่า', pass_fail: 'ผ่าน/ไม่ผ่าน', visual: 'ตรวจด้วยสายตา' } as Record<string, string>,
  sampling: { fixed: 'จำนวนคงที่', percent: '% ของล็อต' } as Record<string, string>,
  source: { manual: 'สร้างเอง', purchase_order: 'รับของจากใบสั่งซื้อ', production_order: 'ผลิตเสร็จ' } as Record<string, string>,
  ncrStatus: { open: 'เปิด', investigating: 'กำลังสอบสวน', action: 'กำลังแก้ไข', closed: 'ปิดแล้ว' } as Record<string, string>,
  severity: { minor: 'เล็กน้อย', major: 'สำคัญ', critical: 'วิกฤต' } as Record<string, string>,
  disposition: { rework: 'แก้ไขงาน (Rework)', scrap: 'ทำลาย (Scrap)', use_as_is: 'ใช้ได้ตามสภาพ', return_to_supplier: 'ส่งคืนผู้ขาย' } as Record<string, string>,
  caStatus: { open: 'รอดำเนินการ', done: 'ทำแล้ว รอทวนสอบ', verified: 'ทวนสอบแล้ว' } as Record<string, string>,
};

const thPlan = (p: any) => ({ ...p, stage_th: TH.stage[p.stage], sampling_th: p.sampling_mode === 'percent' ? `${p.sampling_value}% ของล็อต` : `${p.sampling_value} ชิ้น`, active_th: p.active ? 'ใช้งาน' : 'ปิดใช้' });
const thCheckpoint = (r: any) => ({
  ...r,
  type_th: TH.type[r.type],
  spec: r.type === 'measure' ? specText(r) : '',
  critical_th: r.critical ? 'วิกฤต' : '',
  passed_th: r.passed === true ? 'ผ่าน' : r.passed === false ? 'ไม่ผ่าน' : 'ยังไม่บันทึก',
});
const thInspection = (i: any) => ({
  ...i, stage_th: TH.stage[i.stage], status_th: TH.status[i.status], result_th: i.result ? TH.result[i.result] : '', source_th: TH.source[i.source_type],
});
const thNcr = (n: any) => ({
  ...n, status_th: TH.ncrStatus[n.status], severity_th: TH.severity[n.severity], disposition_th: n.disposition ? TH.disposition[n.disposition] : '',
  stage_th: n.stage ? TH.stage[n.stage] : '', title: `${n.item_code ?? ''} ${n.description ?? ''}`.trim(),
});
const thCa = (a: any) => ({ ...a, status_th: TH.caStatus[a.status], overdue: a.status === 'open' && !!a.due_on && a.due_on < today(), overdue_th: a.status === 'open' && !!a.due_on && a.due_on < today() ? 'เลยกำหนด' : '' });

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function specText(r: { unit?: string | null; target?: number | null; min_value?: number | null; max_value?: number | null }) {
  const u = r.unit ? ` ${r.unit}` : '';
  const range = r.min_value != null && r.max_value != null ? `${r.min_value}–${r.max_value}` : r.min_value != null ? `≥ ${r.min_value}` : r.max_value != null ? `≤ ${r.max_value}` : '';
  return [r.target != null ? `เป้า ${r.target}` : '', range].filter(Boolean).join(' / ') + (range || r.target != null ? u : '');
}

/* ---------------- input schemas ---------------- */

const Stage = z.enum(['incoming', 'in_process', 'final']);
const Severity = z.enum(['minor', 'major', 'critical']);
const Disposition = z.enum(['rework', 'scrap', 'use_as_is', 'return_to_supplier']);
const optText = (max = 2000) => z.string().trim().max(max).optional();
const optNum = z.number().finite().optional();

const CheckpointInput = z.object({
  name: s.name,
  method: optText(200),
  type: z.enum(['measure', 'pass_fail', 'visual']).default('pass_fail'),
  unit: optText(30),
  target: optNum,
  min: optNum,
  max: optNum,
  critical: z.boolean().default(false),
}).superRefine((cp, ctx) => {
  if (cp.type === 'measure' && cp.min === undefined && cp.max === undefined) ctx.addIssue({ code: 'custom', path: ['min'], message: 'จุดตรวจแบบวัดค่าต้องมีค่าต่ำสุดหรือสูงสุด' });
  if (cp.min !== undefined && cp.max !== undefined && cp.min > cp.max) ctx.addIssue({ code: 'custom', path: ['max'], message: 'ค่าสูงสุดต้องไม่น้อยกว่าค่าต่ำสุด' });
});
type CheckpointInput = z.infer<typeof CheckpointInput>;

const Sampling = {
  samplingMode: z.enum(['fixed', 'percent']).default('fixed'),
  samplingValue: z.number().finite().positive(),
};
const samplingOk = (b: { samplingMode?: string; samplingValue?: number }, ctx: z.RefinementCtx) => {
  if (b.samplingMode === 'percent' && (b.samplingValue ?? 0) > 100) ctx.addIssue({ code: 'custom', path: ['samplingValue'], message: 'เปอร์เซ็นต์ต้องไม่เกิน 100' });
};

const PlanInput = z.object({
  itemId: s.uuid, itemCode: s.code, itemName: z.string().max(200).optional(),
  stage: Stage,
  name: z.string().trim().max(200).optional(),
  ...Sampling,
  note: optText(),
  checkpoints: z.array(CheckpointInput).min(1),
}).superRefine(samplingOk);

const PlanPatch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  samplingMode: z.enum(['fixed', 'percent']).optional(),
  samplingValue: z.number().finite().positive().optional(),
  note: z.string().max(2000).nullable().optional(),
});

const InspectionInput = z.object({
  stage: Stage,
  itemId: s.uuid, itemCode: s.code, itemName: z.string().max(200).optional(),
  planId: s.uuid.optional(),
  lotNo: optText(100),
  sourceRef: optText(100),
  qty: s.positiveQty,
  sampleSize: s.positiveQty.optional(),
  supplierId: s.uuid.optional(), supplierName: optText(200),
  inspectorId: s.uuid.optional(), inspectorName: optText(200),
  note: optText(),
});

const ResultInput = z.object({ value: optNum, passed: z.boolean().optional(), note: optText(1000) });
const BulkResults = z.object({ results: z.array(ResultInput.extend({ resultId: s.uuid })).min(1) });
const StartInput = z.object({ inspectorId: s.uuid.optional(), inspectorName: optText(200) });
const CompleteInput = z.object({ acceptedQty: z.number().finite().min(0).optional(), rejectedQty: z.number().finite().min(0).optional(), note: optText() });

const NcrInput = z.object({
  description: z.string().trim().min(1).max(4000),
  itemId: s.uuid.optional(), itemCode: s.code.optional(), itemName: z.string().max(200).optional(),
  stage: Stage.optional(),
  lotNo: optText(100), sourceRef: optText(100),
  supplierId: s.uuid.optional(), supplierName: optText(200),
  qtyAffected: z.number().finite().min(0).optional(),
  severity: Severity.default('minor'),
  disposition: Disposition.optional(),
});
const NcrFromInspection = z.object({
  description: z.string().trim().min(1).max(4000).optional(),
  qtyAffected: z.number().finite().min(0).optional(),
  severity: Severity.optional(),
  disposition: Disposition.optional(),
});
const NcrPatch = z.object({
  description: z.string().trim().min(1).max(4000).optional(),
  qtyAffected: z.number().finite().min(0).nullable().optional(),
  severity: Severity.optional(),
  disposition: Disposition.nullable().optional(),
  whyAnalysis: z.string().max(4000).nullable().optional(),
  rootCause: z.string().max(2000).nullable().optional(),
});
const AnalysisInput = z.object({ whyAnalysis: optText(4000), rootCause: optText(), disposition: Disposition.optional() });
const CaInput = z.object({ action: z.string().trim().min(1).max(2000), ownerId: s.uuid.optional(), ownerName: optText(200), dueOn: s.isoDate.optional() });
const NoteInput = z.object({ note: optText() });

const IdParam = z.object({ id: s.uuid });
const listBase = { q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) };
const like = (q?: string) => (q ? `%${q}%` : null);

/* ---------------- domain helpers ---------------- */

/** Fixed qty (never more than the lot) or % of the lot rounded up, at least 1 (or the whole lot when smaller). */
export function sampleSizeFor(mode: string, value: number, qty: number): number {
  const n = mode === 'percent' ? Math.max(1, Math.ceil((qty * value) / 100)) : value;
  return Math.min(qty, n);
}

/** A checkpoint fails when its value is outside min/max or when the inspector marks it failed. */
export function evaluate(cp: { type: string; min_value: number | null; max_value: number | null; name: string }, input: { value?: number; passed?: boolean }): { value: number | null; passed: boolean } {
  if (cp.type === 'measure') {
    if (input.value === undefined) {
      if (input.passed === false) return { value: null, passed: false };
      throw badRequest('Validation failed', { fieldErrors: { value: [`กรอกค่าที่วัดได้ของ "${cp.name}"`] }, formErrors: [] });
    }
    // judge the value that is stored and shown (numeric(18,4)), so 2.05004 → 2.0500 is in a 1.95–2.05 spec and 0.1 + 0.2 equals 0.3
    const value = Math.round((input.value + Math.sign(input.value) * Number.EPSILON) * 10000) / 10000;
    const inSpec = (cp.min_value == null || value >= Number(cp.min_value)) && (cp.max_value == null || value <= Number(cp.max_value));
    return { value, passed: inSpec && input.passed !== false };
  }
  if (input.passed === undefined) throw badRequest('Validation failed', { fieldErrors: { passed: [`เลือกผล ผ่าน/ไม่ผ่าน ของ "${cp.name}"`] }, formErrors: [] });
  return { value: input.value ?? null, passed: input.passed };
}

/** pass = nothing failed, fail = a critical checkpoint failed, conditional = only non-critical checkpoints failed. */
export function verdict(results: { passed: boolean | null; critical: boolean }[]): 'pass' | 'fail' | 'conditional' {
  const fails = results.filter((r) => r.passed === false);
  if (!fails.length) return 'pass';
  return fails.some((r) => r.critical) ? 'fail' : 'conditional';
}

async function loadPlan(c: Client, id: string, lock = false) {
  const p = await one(c, `select * from inspection_plans where id = $1 ${lock ? 'for update' : ''}`, [id], 'Inspection plan');
  const checkpoints = (await c.query('select * from plan_checkpoints where plan_id = $1 order by seq', [id])).rows.map(thCheckpoint);
  return { ...thPlan(p), checkpoints };
}

async function insertCheckpoints(c: Client, planId: string, cps: CheckpointInput[], startSeq = 1) {
  let seq = startSeq;
  for (const cp of cps) {
    await c.query(
      `insert into plan_checkpoints (plan_id, seq, name, method, type, unit, target, min_value, max_value, critical) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [planId, seq++, cp.name, cp.method ?? null, cp.type, cp.unit ?? null, cp.target ?? null, cp.min ?? null, cp.max ?? null, cp.critical]);
  }
}

async function activePlan(c: Client, itemId: string, stage: string) {
  return (await c.query('select * from inspection_plans where active and item_id = $1 and stage = $2', [itemId, stage])).rows[0] as any | undefined;
}

interface NewInspection {
  stage: string; plan: any; itemId: string; itemCode: string; itemName?: string | null; lotNo?: string | null;
  sourceType: string; sourceRef?: string | null; sourceId?: string | null; supplierId?: string | null; supplierName?: string | null;
  warehouseCode?: string | null; qty: number; sampleSize?: number; inspectorId?: string | null; inspectorName?: string | null;
  note?: string | null; eventId?: string | null; line?: number | null; userId?: string | null;
}

/** Creates the inspection and snapshots the plan's checkpoints as result rows (later plan edits never change it). */
async function createInspection(c: Client, n: NewInspection) {
  const no = await nextDocNo(c, 'QC');
  const sample = n.sampleSize !== undefined ? Math.min(n.sampleSize, n.qty) : sampleSizeFor(n.plan.sampling_mode, n.plan.sampling_value, n.qty);
  const row = (await c.query(
    `insert into inspections (no, stage, plan_id, plan_name, item_id, item_code, item_name, lot_no, source_type, source_ref, source_id,
       supplier_id, supplier_name, warehouse_code, qty, sample_size, inspector_id, inspector_name, note, source_event_id, source_line, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning id`,
    [no, n.stage, n.plan.id, n.plan.name, n.itemId, n.itemCode, n.itemName ?? null, n.lotNo ?? null, n.sourceType, n.sourceRef ?? null, n.sourceId ?? null,
      n.supplierId ?? null, n.supplierName ?? null, n.warehouseCode ?? null, n.qty, sample, n.inspectorId ?? null, n.inspectorName ?? null, n.note ?? null,
      n.eventId ?? null, n.line ?? null, n.userId ?? null])).rows[0];
  await c.query(
    `insert into inspection_results (inspection_id, checkpoint_id, seq, name, method, type, unit, target, min_value, max_value, critical)
     select $1, id, seq, name, method, type, unit, target, min_value, max_value, critical from plan_checkpoints where plan_id = $2 order by seq`,
    [row.id, n.plan.id]);
  return row.id as string;
}

async function loadInspection(c: Client, id: string, lock = false) {
  const i = await one(c, `select * from inspections where id = $1 ${lock ? 'for update' : ''}`, [id], 'Inspection');
  const results = (await c.query('select * from inspection_results where inspection_id = $1 order by seq', [id])).rows.map(thCheckpoint);
  const ncr = (await c.query('select id, no, status, severity from ncrs where inspection_id = $1', [id])).rows[0] ?? null;
  return {
    ...thInspection(i), results, ncr, ncr_id: ncr?.id ?? null, ncr_no: ncr?.no ?? null,
    recorded_points: results.filter((r: any) => r.passed !== null).length,
    failed_points: results.filter((r: any) => r.passed === false).length,
    total_points: results.length,
  };
}

/** Records one checkpoint result; moves a pending inspection to in_progress. */
async function recordResult(c: Client, resultId: string, input: z.infer<typeof ResultInput>, userId: string, inspectionId?: string) {
  const r = await one(c, 'select * from inspection_results where id = $1 for update', [resultId], 'Inspection result');
  if (inspectionId && r.inspection_id !== inspectionId) throw badRequest(`Result ${resultId} does not belong to this inspection`);
  const ins = await one(c, 'select id, no, status from inspections where id = $1 for update', [r.inspection_id], 'Inspection');
  if (!['pending', 'in_progress'].includes(ins.status)) throw conflict(`บันทึกผลไม่ได้: งานตรวจ ${ins.no} สถานะ ${TH.status[ins.status]}`);
  const e = evaluate(r, input);
  await c.query('update inspection_results set value = $2, passed = $3, note = $4, recorded_by = $5, recorded_at = now() where id = $1',
    [resultId, e.value, e.passed, input.note ?? null, userId]);
  await c.query(`update inspections set status = 'in_progress', started_at = coalesce(started_at, now()), inspector_id = coalesce(inspector_id, $2) where id = $1 and status = 'pending'`, [ins.id, userId]);
  return r.inspection_id as string;
}

async function loadNcr(c: Client, id: string, lock = false) {
  const n = await one(c, `select * from ncrs where id = $1 ${lock ? 'for update' : ''}`, [id], 'NCR');
  const actions = (await c.query('select * from corrective_actions where ncr_id = $1 order by created_at', [id])).rows.map(thCa);
  const failed = n.inspection_id
    ? (await c.query('select * from inspection_results where inspection_id = $1 and passed = false order by seq', [n.inspection_id])).rows.map(thCheckpoint)
    : [];
  return { ...thNcr(n), actions, failedCheckpoints: failed, open_actions: actions.filter((a: any) => a.status === 'open').length };
}

async function loadCa(c: Client, id: string, lock = false) {
  const a = await one(c, `select ca.*, n.no as ncr_no, n.status as ncr_status, n.item_code, n.description as ncr_description
    from corrective_actions ca join ncrs n on n.id = ca.ncr_id where ca.id = $1 ${lock ? 'for update of ca' : ''}`, [id], 'Corrective action');
  return { ...thCa(a), ncr_status_th: TH.ncrStatus[a.ncr_status] };
}

/* ---------------- event handlers (purchasing / production are optional partners) ---------------- */

export const handlers: EventHandlers = {
  /** One PENDING incoming inspection per received line whose item has an active incoming plan. */
  'purchasing.goods_received': async (e, { client, event }) => {
    for (const [line, l] of e.lines.entries()) {
      if (!(l.qty > 0)) continue;
      const plan = await activePlan(client, l.itemId, 'incoming');
      if (!plan) continue;
      const dup = await client.query('select 1 from inspections where source_event_id = $1 and source_line = $2', [event.id, line]);
      if (dup.rowCount) continue;
      await createInspection(client, {
        stage: 'incoming', plan, itemId: l.itemId, itemCode: l.itemCode, itemName: l.itemName, sourceType: 'purchase_order',
        sourceRef: e.poNo, sourceId: e.poId, supplierId: e.supplierId, supplierName: e.supplierName, warehouseCode: e.warehouseCode,
        qty: l.qty, eventId: event.id, line,
      });
    }
  },
  /** A PENDING final inspection when the finished item has an active final plan. */
  'production.completed': async (e, { client, event }) => {
    if (!(e.qty > 0)) return;
    const plan = await activePlan(client, e.item.itemId, 'final');
    if (!plan) return;
    const dup = await client.query('select 1 from inspections where source_event_id = $1 and source_line = 0', [event.id]);
    if (dup.rowCount) return;
    await createInspection(client, {
      stage: 'final', plan, itemId: e.item.itemId, itemCode: e.item.itemCode, itemName: e.item.itemName, sourceType: 'production_order',
      sourceRef: e.orderNo, sourceId: e.orderId, warehouseCode: e.warehouseCode, qty: e.qty, eventId: event.id, line: 0,
    });
  },
};

/* ---------------- routes ---------------- */

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  handlers,
  routes(app, k) {
    /* ----- inspection plans ----- */

    app.post('/plans', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'quality.plan.write');
      const b = parse(PlanInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        if (await activePlan(c, b.itemId, b.stage)) throw conflict(`สินค้า ${b.itemCode} มีแผน${TH.stage[b.stage]}ที่ใช้งานอยู่แล้ว — ปิดใช้แผนเดิมก่อน`);
        const name = b.name || `${TH.stage[b.stage]} ${b.itemCode}`;
        const p = (await c.query(
          `insert into inspection_plans (name, item_id, item_code, item_name, stage, sampling_mode, sampling_value, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
          [name, b.itemId, b.itemCode, b.itemName ?? null, b.stage, b.samplingMode, b.samplingValue, b.note ?? null, a.userId])).rows[0];
        await insertCheckpoints(c, p.id, b.checkpoints);
        return loadPlan(c, p.id);
      });
    });

    app.get('/plans', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.plan.read');
      const q = parse(z.object({ ...listBase, stage: Stage.optional(), itemId: s.uuid.optional(), active: z.enum(['true', 'false']).optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select p.*, (select count(*) from plan_checkpoints x where x.plan_id = p.id)::int as checkpoint_count,
                (select count(*) from plan_checkpoints x where x.plan_id = p.id and x.critical)::int as critical_count
         from inspection_plans p
         where ($1::text is null or p.item_code ilike $1 or p.item_name ilike $1 or p.name ilike $1)
           and ($2::text is null or p.stage = $2) and ($3::uuid is null or p.item_id = $3) and ($4::boolean is null or p.active = $4)
         order by p.active desc, p.item_code, p.stage limit $5`,
        [like(q.q), q.stage ?? null, q.itemId ?? null, q.active === undefined ? null : q.active === 'true', q.limit])).rows.map(thPlan));
    });

    app.get('/plans/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.plan.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadPlan(c, id));
    });

    app.patch('/plans/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.plan.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(PlanPatch, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const p = await loadPlan(c, id, true);
        const mode = b.samplingMode ?? p.sampling_mode;
        const value = b.samplingValue ?? p.sampling_value;
        if (mode === 'percent' && value > 100) throw badRequest('Validation failed', { fieldErrors: { samplingValue: ['เปอร์เซ็นต์ต้องไม่เกิน 100'] }, formErrors: [] });
        await c.query('update inspection_plans set name = $2, sampling_mode = $3, sampling_value = $4, note = $5 where id = $1',
          [id, b.name ?? p.name, mode, value, b.note === undefined ? p.note : b.note]);
        return loadPlan(c, id);
      });
    });

    app.post('/plans/:id/checkpoints', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'quality.plan.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(CheckpointInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await loadPlan(c, id, true);
        const next = (await c.query('select coalesce(max(seq), 0) + 1 as n from plan_checkpoints where plan_id = $1', [id])).rows[0].n;
        await insertCheckpoints(c, id, [b], next);
        return loadPlan(c, id);
      });
    });

    /** Remove a checkpoint by its sequence number (#); the rest are renumbered. Past inspections keep their snapshot. */
    app.post('/plans/:id/checkpoints/remove', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.plan.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ seq: z.number().int().positive() }), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const p = await loadPlan(c, id, true);
        if (!p.checkpoints.some((x: any) => x.seq === b.seq)) throw badRequest('Validation failed', { fieldErrors: { seq: [`ไม่มีจุดตรวจลำดับที่ ${b.seq}`] }, formErrors: [] });
        if (p.checkpoints.length === 1) throw conflict('แผนการตรวจต้องมีจุดตรวจอย่างน้อย 1 จุด');
        await c.query('delete from plan_checkpoints where plan_id = $1 and seq = $2', [id, b.seq]);
        await c.query('update plan_checkpoints set seq = seq - 1 where plan_id = $1 and seq > $2', [id, b.seq]);
        return loadPlan(c, id);
      });
    });

    app.post('/plans/:id/deactivate', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.plan.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const p = await loadPlan(c, id, true);
        if (!p.active) throw conflict('แผนนี้ปิดใช้อยู่แล้ว');
        await c.query('update inspection_plans set active = false where id = $1', [id]);
        return loadPlan(c, id);
      });
    });

    app.post('/plans/:id/activate', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.plan.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const p = await loadPlan(c, id, true);
        if (p.active) throw conflict('แผนนี้ใช้งานอยู่แล้ว');
        const other = await activePlan(c, p.item_id, p.stage);
        if (other) throw conflict(`สินค้า ${p.item_code} มีแผน${TH.stage[p.stage]}ที่ใช้งานอยู่แล้ว (${other.name})`);
        await c.query('update inspection_plans set active = true where id = $1', [id]);
        return loadPlan(c, id);
      });
    });

    /* ----- inspections ----- */

    app.post('/inspections', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.record');
      const b = parse(InspectionInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const plan = b.planId
          ? await one(c, 'select * from inspection_plans where id = $1', [b.planId], 'Inspection plan')
          : await activePlan(c, b.itemId, b.stage);
        if (!plan) throw conflict(`ยังไม่มีแผน${TH.stage[b.stage]}ที่ใช้งานสำหรับสินค้า ${b.itemCode} — สร้างแผนการตรวจก่อน`);
        if (plan.item_id !== b.itemId || plan.stage !== b.stage) throw badRequest('Validation failed', { fieldErrors: { planId: ['แผนการตรวจไม่ตรงกับสินค้าหรือขั้นตอนที่เลือก'] }, formErrors: [] });
        const id = await createInspection(c, {
          stage: b.stage, plan, itemId: b.itemId, itemCode: b.itemCode, itemName: b.itemName, lotNo: b.lotNo, sourceType: 'manual', sourceRef: b.sourceRef,
          supplierId: b.supplierId, supplierName: b.supplierName, qty: b.qty, sampleSize: b.sampleSize,
          inspectorId: b.inspectorId, inspectorName: b.inspectorName, note: b.note, userId: a.userId,
        });
        return loadInspection(c, id);
      });
    });

    app.get('/inspections', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.read');
      const q = parse(z.object({
        ...listBase, status: z.string().max(100).optional(), stage: Stage.optional(), result: z.enum(['pass', 'fail', 'conditional']).optional(),
        itemId: s.uuid.optional(), from: s.isoDate.optional(), to: s.isoDate.optional(),
      }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select i.*,
                (select count(*) from inspection_results r where r.inspection_id = i.id and r.passed = false)::int as failed_points,
                (select count(*) from inspection_results r where r.inspection_id = i.id and r.passed is null)::int as open_points
         from inspections i
         where ($1::text is null or i.no ilike $1 or i.item_code ilike $1 or i.item_name ilike $1 or i.lot_no ilike $1 or i.source_ref ilike $1 or i.supplier_name ilike $1)
           and ($2::text is null or i.status = any(string_to_array($2, ',')))
           and ($3::text is null or i.stage = $3) and ($4::text is null or i.result = $4) and ($5::uuid is null or i.item_id = $5)
           and ($6::date is null or i.created_at >= $6::date) and ($7::date is null or i.created_at < $7::date + 1)
         order by i.created_at desc limit $8`,
        [like(q.q), q.status ?? null, q.stage ?? null, q.result ?? null, q.itemId ?? null, q.from ?? null, q.to ?? null, q.limit])).rows.map(thInspection));
    });

    /** Work queue for inspectors (pending + in progress, oldest first) — the mobile home of QC staff. */
    app.get('/inspections/queue', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.read');
      const q = parse(z.object({ ...listBase, stage: Stage.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select i.*, (select count(*) from inspection_results r where r.inspection_id = i.id and r.passed is null)::int as open_points
         from inspections i where i.status in ('pending', 'in_progress')
           and ($1::text is null or i.no ilike $1 or i.item_code ilike $1 or i.item_name ilike $1 or i.lot_no ilike $1 or i.source_ref ilike $1)
           and ($2::text is null or i.stage = $2)
         order by i.created_at limit $3`,
        [like(q.q), q.stage ?? null, q.limit])).rows.map(thInspection));
    });

    app.get('/inspections/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadInspection(c, id));
    });

    app.get('/inspections/:id/results', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const i = await one(c, 'select no, status from inspections where id = $1', [id], 'Inspection');
        return (await c.query('select * from inspection_results where inspection_id = $1 order by seq', [id])).rows
          .map((r: any) => ({ ...thCheckpoint(r), inspection_no: i.no, inspection_status: i.status }));
      });
    });

    /** Open the inspection for recording (pending → in_progress) and set the inspector. Allowed again while in progress (re-assign). */
    app.post('/inspections/:id/start', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.record');
      const { id } = parse(IdParam, req.params);
      const b = parse(StartInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const i = await loadInspection(c, id, true);
        if (!['pending', 'in_progress'].includes(i.status)) throw conflict(`เริ่มตรวจไม่ได้: งานตรวจ ${i.no} สถานะ ${i.status_th}`);
        await c.query(
          `update inspections set status = 'in_progress', started_at = coalesce(started_at, now()),
             inspector_id = coalesce($2, inspector_id, $4), inspector_name = coalesce($3, inspector_name) where id = $1`,
          [id, b.inspectorId ?? null, b.inspectorName ?? null, a.userId]);
        return loadInspection(c, id);
      });
    });

    app.post('/inspections/:id/results', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.record');
      const { id } = parse(IdParam, req.params);
      const b = parse(BulkResults, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from inspections where id = $1', [id], 'Inspection');
        for (const r of b.results) await recordResult(c, r.resultId, r, a.userId, id);
        return loadInspection(c, id);
      });
    });

    app.post('/inspection-results/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.record');
      const { id } = parse(IdParam, req.params);
      const b = parse(ResultInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => loadInspection(c, await recordResult(c, id, b, a.userId)));
    });

    app.post('/inspection-results/:id/pass', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.record');
      const { id } = parse(IdParam, req.params);
      const b = parse(NoteInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const r = await one(c, 'select type, name from inspection_results where id = $1', [id], 'Inspection result');
        if (r.type === 'measure') throw badRequest('Validation failed', { fieldErrors: { value: [`"${r.name}" เป็นจุดตรวจแบบวัดค่า — กรอกค่าที่วัดได้`] }, formErrors: [] });
        return loadInspection(c, await recordResult(c, id, { passed: true, note: b.note }, a.userId));
      });
    });

    app.post('/inspection-results/:id/fail', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.record');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ note: optText(1000), value: optNum }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => loadInspection(c, await recordResult(c, id, { passed: false, value: b.value, note: b.note }, a.userId)));
    });

    app.post('/inspections/:id/complete', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.record');
      const { id } = parse(IdParam, req.params);
      const b = parse(CompleteInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const i = await loadInspection(c, id, true);
        if (!['pending', 'in_progress'].includes(i.status)) throw conflict(`ปิดงานตรวจไม่ได้: ${i.no} สถานะ ${i.status_th}`);
        const missing = i.results.filter((r: any) => r.passed === null);
        if (missing.length) throw conflict(`ยังบันทึกผลไม่ครบ ${missing.length} จุด: ${missing.map((r: any) => r.name).join(', ')}`);
        const result = verdict(i.results);
        const qty = Number(i.qty);
        let accepted = b.acceptedQty;
        let rejected = b.rejectedQty;
        if (accepted === undefined && rejected === undefined) {
          accepted = result === 'fail' ? 0 : qty;
          rejected = qty - accepted;
        } else if (accepted === undefined) accepted = qty - rejected!;
        else if (rejected === undefined) rejected = qty - accepted;
        if (accepted < 0 || rejected! < 0 || Math.abs(accepted + rejected! - qty) > 1e-9) {
          throw badRequest('Validation failed', { fieldErrors: { acceptedQty: [`จำนวนรับ + จำนวนปฏิเสธ ต้องเท่ากับจำนวนล็อต (${qty})`] }, formErrors: [] });
        }
        await c.query(
          `update inspections set status = 'completed', result = $2, accepted_qty = $3, rejected_qty = $4, completed_at = now(),
             started_at = coalesce(started_at, now()), inspector_id = coalesce(inspector_id, $5), note = coalesce($6, note) where id = $1`,
          [id, result, accepted, rejected, a.userId, b.note ?? null]);
        await k.emit(c, 'quality.inspection_completed', {
          inspectionId: i.id, no: i.no, stage: i.stage, itemCode: i.item_code, itemName: i.item_name ?? null, lotNo: i.lot_no ?? null, result, rejectedQty: Number(rejected),
        });
        return loadInspection(c, id);
      });
    });

    app.post('/inspections/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.record');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ reason: optText() }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const i = await loadInspection(c, id, true);
        if (!['pending', 'in_progress'].includes(i.status)) throw conflict(`ยกเลิกไม่ได้: ${i.no} สถานะ ${i.status_th}`);
        await c.query(`update inspections set status = 'cancelled', note = coalesce($2, note) where id = $1`, [id, b.reason ? `ยกเลิก: ${b.reason}` : null]);
        return loadInspection(c, id);
      });
    });

    /** Raise an NCR prefilled from a failed / conditional inspection (one NCR per inspection). */
    app.post('/inspections/:id/ncr', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(NcrFromInspection, req.body ?? {});
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const i = await loadInspection(c, id, true);
        if (i.status !== 'completed' || !['fail', 'conditional'].includes(i.result)) throw conflict(`ออก NCR ได้เฉพาะงานตรวจที่ตรวจเสร็จและไม่ผ่าน (${i.no}: ${i.status_th}${i.result_th ? ` / ${i.result_th}` : ''})`);
        if (i.ncr) throw conflict(`งานตรวจ ${i.no} มี NCR แล้ว (${i.ncr.no})`);
        const fails = i.results.filter((r: any) => r.passed === false);
        const description = b.description ?? `${i.no} ${TH.stage[i.stage]} ${i.item_code}${i.lot_no ? ` ล็อต ${i.lot_no}` : ''} ไม่ผ่าน: ` +
          fails.map((r: any) => `${r.name}${r.value != null ? ` (วัดได้ ${r.value}${r.unit ? ` ${r.unit}` : ''}${r.spec ? `, สเปก ${r.spec}` : ''})` : ''}${r.note ? ` — ${r.note}` : ''}`).join('; ');
        const severity = b.severity ?? (i.result === 'fail' ? 'major' : 'minor');
        const qtyAffected = b.qtyAffected ?? (Number(i.rejected_qty) > 0 ? Number(i.rejected_qty) : Number(i.qty));
        const no = await nextDocNo(c, 'NCR');
        const n = (await c.query(
          `insert into ncrs (no, inspection_id, inspection_no, stage, item_id, item_code, item_name, lot_no, source_ref, supplier_id, supplier_name,
             description, qty_affected, severity, disposition, raised_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id`,
          [no, i.id, i.no, i.stage, i.item_id, i.item_code, i.item_name, i.lot_no, i.source_ref, i.supplier_id, i.supplier_name,
            description, qtyAffected, severity, b.disposition ?? null, a.userId])).rows[0];
        await k.emit(c, 'quality.ncr_raised', { ncrId: n.id, no, severity, itemCode: i.item_code ?? null, description });
        return loadNcr(c, n.id);
      });
    });

    /* ----- NCR ----- */

    app.post('/ncrs', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.write');
      const b = parse(NcrInput, req.body);
      if (b.itemId && !b.itemCode) throw badRequest('Validation failed', { fieldErrors: { itemCode: ['ต้องระบุรหัสสินค้า'] }, formErrors: [] });
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const no = await nextDocNo(c, 'NCR');
        const n = (await c.query(
          `insert into ncrs (no, stage, item_id, item_code, item_name, lot_no, source_ref, supplier_id, supplier_name, description, qty_affected, severity, disposition, raised_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
          [no, b.stage ?? null, b.itemId ?? null, b.itemCode ?? null, b.itemName ?? null, b.lotNo ?? null, b.sourceRef ?? null, b.supplierId ?? null,
            b.supplierName ?? null, b.description, b.qtyAffected ?? null, b.severity, b.disposition ?? null, a.userId])).rows[0];
        await k.emit(c, 'quality.ncr_raised', { ncrId: n.id, no, severity: b.severity, itemCode: b.itemCode ?? null, description: b.description });
        return loadNcr(c, n.id);
      });
    });

    app.get('/ncrs', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.read');
      const q = parse(z.object({ ...listBase, status: z.string().max(100).optional(), severity: Severity.optional(), open: z.enum(['true', 'false']).optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select n.*, (select count(*) from corrective_actions x where x.ncr_id = n.id and x.status = 'open')::int as open_actions
         from ncrs n
         where ($1::text is null or n.no ilike $1 or n.item_code ilike $1 or n.item_name ilike $1 or n.description ilike $1 or n.lot_no ilike $1 or n.supplier_name ilike $1 or n.inspection_no ilike $1)
           and ($2::text is null or n.status = any(string_to_array($2, ','))) and ($3::text is null or n.severity = $3)
           and ($4::boolean is null or (n.status <> 'closed') = $4)
         order by n.created_at desc limit $5`,
        [like(q.q), q.status ?? null, q.severity ?? null, q.open === undefined ? null : q.open === 'true', q.limit])).rows.map(thNcr));
    });

    app.get('/ncrs/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadNcr(c, id));
    });

    app.patch('/ncrs/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(NcrPatch, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const n = await loadNcr(c, id, true);
        if (n.status === 'closed') throw conflict(`แก้ไขไม่ได้: ${n.no} ปิดแล้ว`);
        const pick = <T>(v: T | undefined, cur: T) => (v === undefined ? cur : v);
        await c.query(
          'update ncrs set description = $2, qty_affected = $3, severity = $4, disposition = $5, why_analysis = $6, root_cause = $7 where id = $1',
          [id, pick(b.description, n.description), pick(b.qtyAffected, n.qty_affected), pick(b.severity, n.severity), pick(b.disposition, n.disposition),
            pick(b.whyAnalysis, n.why_analysis), pick(b.rootCause, n.root_cause)]);
        return loadNcr(c, id);
      });
    });

    /** open → investigating; optionally records the 5-Why analysis / root cause / disposition. */
    app.post('/ncrs/:id/investigate', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(AnalysisInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const n = await loadNcr(c, id, true);
        if (n.status !== 'open') throw conflict(`เริ่มสอบสวนไม่ได้: ${n.no} สถานะ ${n.status_th}`);
        await c.query(`update ncrs set status = 'investigating', why_analysis = coalesce($2, why_analysis), root_cause = coalesce($3, root_cause), disposition = coalesce($4, disposition) where id = $1`,
          [id, b.whyAnalysis ?? null, b.rootCause ?? null, b.disposition ?? null]);
        return loadNcr(c, id);
      });
    });

    /** Add a corrective action (CA-…); an NCR that is open/investigating moves to "action". */
    app.post('/ncrs/:id/actions', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(CaInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const n = await loadNcr(c, id, true);
        if (n.status === 'closed') throw conflict(`เพิ่มการแก้ไขไม่ได้: ${n.no} ปิดแล้ว`);
        const no = await nextDocNo(c, 'CA');
        await c.query('insert into corrective_actions (no, ncr_id, action, owner_id, owner_name, due_on, created_by) values ($1,$2,$3,$4,$5,$6,$7)',
          [no, id, b.action, b.ownerId ?? null, b.ownerName ?? null, b.dueOn ?? null, a.userId]);
        await c.query(`update ncrs set status = 'action' where id = $1 and status in ('open', 'investigating')`, [id]);
        return loadNcr(c, id);
      });
    });

    /** Close requires a root cause and a disposition, and no corrective action still open. */
    app.post('/ncrs/:id/close', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.close');
      const { id } = parse(IdParam, req.params);
      const b = parse(AnalysisInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const n = await loadNcr(c, id, true);
        if (!['investigating', 'action'].includes(n.status)) throw conflict(`ปิด NCR ไม่ได้: ${n.no} สถานะ ${n.status_th} (ต้องสอบสวนก่อน)`);
        const rootCause = b.rootCause ?? n.root_cause;
        const disposition = b.disposition ?? n.disposition;
        const missing = [!rootCause && 'สาเหตุราก (root cause)', !disposition && 'การจัดการของเสีย (disposition)'].filter(Boolean);
        if (missing.length) throw conflict(`ปิด ${n.no} ไม่ได้: ยังไม่ระบุ${missing.join(' และ ')}`);
        if (n.open_actions) throw conflict(`ปิด ${n.no} ไม่ได้: ยังมีการแก้ไขค้าง ${n.open_actions} รายการ`);
        await c.query(`update ncrs set status = 'closed', root_cause = $2, disposition = $3, why_analysis = coalesce($4, why_analysis), closed_at = now(), closed_by = $5 where id = $1`,
          [id, rootCause, disposition, b.whyAnalysis ?? null, a.userId]);
        return loadNcr(c, id);
      });
    });

    /* ----- corrective actions ----- */

    app.get('/corrective-actions', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.read');
      const q = parse(z.object({ ...listBase, status: z.enum(['open', 'done', 'verified']).optional(), overdue: z.enum(['true', 'false']).optional(), ncrId: s.uuid.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select ca.*, n.no as ncr_no, n.item_code, n.severity from corrective_actions ca join ncrs n on n.id = ca.ncr_id
         where ($1::text is null or ca.no ilike $1 or ca.action ilike $1 or ca.owner_name ilike $1 or n.no ilike $1)
           and ($2::text is null or ca.status = $2) and ($3::uuid is null or ca.ncr_id = $3)
           and ($4::boolean is null or (ca.status = 'open' and ca.due_on < current_date) = $4)
         order by (ca.status = 'open') desc, ca.due_on nulls last, ca.created_at limit $5`,
        [like(q.q), q.status ?? null, q.ncrId ?? null, q.overdue === undefined ? null : q.overdue === 'true', q.limit])).rows
        .map((r: any) => ({ ...thCa(r), severity_th: TH.severity[r.severity] })));
    });

    app.get('/corrective-actions/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadCa(c, id));
    });

    app.post('/corrective-actions/:id/done', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(NoteInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const ca = await loadCa(c, id, true);
        if (ca.status !== 'open') throw conflict(`${ca.no} สถานะ ${ca.status_th} — บันทึกว่าทำแล้วไม่ได้`);
        await c.query(`update corrective_actions set status = 'done', done_note = $2, done_at = now() where id = $1`, [id, b.note ?? null]);
        return loadCa(c, id);
      });
    });

    app.post('/corrective-actions/:id/verify', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.close');
      const { id } = parse(IdParam, req.params);
      const b = parse(NoteInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const ca = await loadCa(c, id, true);
        if (ca.status !== 'done') throw conflict(`ทวนสอบ ${ca.no} ไม่ได้: สถานะ ${ca.status_th}`);
        await c.query(`update corrective_actions set status = 'verified', verified_note = $2, verified_at = now(), verified_by = $3 where id = $1`, [id, b.note ?? null, a.userId]);
        return loadCa(c, id);
      });
    });

    /* ----- reports & dashboard ----- */

    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.read');
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select count(*) filter (where status in ('pending', 'in_progress'))::int as pending,
                  count(*) filter (where status = 'completed' and date_trunc('month', completed_at) = date_trunc('month', now()))::int as done_month,
                  count(*) filter (where status = 'completed' and result = 'pass' and date_trunc('month', completed_at) = date_trunc('month', now()))::int as pass_month,
                  count(*) filter (where status = 'completed' and result = 'fail' and date_trunc('month', completed_at) = date_trunc('month', now()))::int as fail_month
           from inspections`)).rows[0];
        const ncr = (await c.query(`select count(*) filter (where status <> 'closed')::int as open, count(*) filter (where status <> 'closed' and severity = 'critical')::int as critical from ncrs`)).rows[0];
        const overdue = (await c.query(`select count(*)::int as n from corrective_actions where status = 'open' and due_on < current_date`)).rows[0].n;
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month, count(i.id)::int as inspections, count(i.id) filter (where i.result = 'pass')::int as passed,
                  coalesce(round(100.0 * count(i.id) filter (where i.result = 'pass') / nullif(count(i.id), 0), 1), 0)::float as pass_rate
           from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m
           left join inspections i on i.status = 'completed' and date_trunc('month', i.completed_at) = m
           group by m order by m`)).rows;
        const rows = (await c.query(`select id, no, status, severity, item_code, description, created_at from ncrs where status <> 'closed' order by created_at desc limit 24`)).rows.map(thNcr);
        const defects = (await c.query(
          `select r.name as label, count(*)::int as fails from inspection_results r join inspections i on i.id = r.inspection_id
           where r.passed = false and i.status = 'completed' and i.completed_at >= now() - interval '90 days'
           group by r.name order by fails desc, r.name limit 8`)).rows;
        return {
          pendingInspections: n.pending, inspectedMonth: n.done_month, failedMonth: n.fail_month,
          passRateMonth: n.done_month ? Math.round((1000 * n.pass_month) / n.done_month) / 10 : 0,
          openNcr: ncr.open, criticalNcr: ncr.critical, overdueActions: overdue, months, rows, defects,
        };
      });
    });

    /** Pass rate by month (completed inspections). */
    app.get('/reports/pass-rate', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.read');
      const q = parse(z.object({ months: z.coerce.number().int().min(1).max(36).default(12), stage: Stage.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select to_char(m, 'YYYY-MM') as month, count(i.id)::int as inspections,
                count(i.id) filter (where i.result = 'pass')::int as passed,
                count(i.id) filter (where i.result = 'conditional')::int as conditional,
                count(i.id) filter (where i.result = 'fail')::int as failed,
                coalesce(round(100.0 * count(i.id) filter (where i.result = 'pass') / nullif(count(i.id), 0), 1), 0)::float as pass_rate,
                coalesce(sum(i.rejected_qty), 0) as rejected_qty
         from generate_series(date_trunc('month', current_date) - make_interval(months => $1::int - 1), date_trunc('month', current_date), interval '1 month') m
         left join inspections i on i.status = 'completed' and date_trunc('month', i.completed_at) = m and ($2::text is null or i.stage = $2)
         group by m order by m desc`, [q.months, q.stage ?? null])).rows);
    });

    /** Defects (failed checkpoints) grouped by checkpoint or by item. */
    app.get('/reports/defects', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.read');
      const q = parse(z.object({ by: z.enum(['checkpoint', 'item']).default('checkpoint'), stage: Stage.optional(), from: s.isoDate.optional(), to: s.isoDate.optional() }), req.query);
      const key = q.by === 'item' ? `i.item_code || coalesce(' ' || i.item_name, '')` : 'r.name';
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select ${key} as label, count(*) filter (where r.passed = false)::int as fails, count(*)::int as checks,
                count(distinct i.id) filter (where r.passed = false)::int as inspections_failed,
                round(100.0 * count(*) filter (where r.passed = false) / nullif(count(*), 0), 1)::float as fail_rate
         from inspection_results r join inspections i on i.id = r.inspection_id
         where i.status = 'completed' and ($1::text is null or i.stage = $1)
           and ($2::date is null or i.completed_at >= $2::date) and ($3::date is null or i.completed_at < $3::date + 1)
         group by 1 having count(*) filter (where r.passed = false) > 0 order by fails desc, label limit 50`,
        [q.stage ?? null, q.from ?? null, q.to ?? null])).rows);
    });

    /** Supplier quality: incoming inspections per supplier (falls back to the PO / source reference). */
    app.get('/reports/suppliers', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.inspection.read');
      const q = parse(z.object({ from: s.isoDate.optional(), to: s.isoDate.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select coalesce(i.supplier_name, i.source_ref, 'ไม่ระบุผู้ขาย') as supplier, count(*)::int as inspections,
                count(*) filter (where i.result = 'pass')::int as passed,
                count(*) filter (where i.result = 'conditional')::int as conditional,
                count(*) filter (where i.result = 'fail')::int as failed,
                round(100.0 * count(*) filter (where i.result = 'pass') / count(*), 1)::float as pass_rate,
                coalesce(sum(i.qty), 0) as received_qty, coalesce(sum(i.rejected_qty), 0) as rejected_qty
         from inspections i
         where i.stage = 'incoming' and i.status = 'completed'
           and ($1::date is null or i.completed_at >= $1::date) and ($2::date is null or i.completed_at < $2::date + 1)
         group by 1 order by pass_rate, inspections desc`, [q.from ?? null, q.to ?? null])).rows);
    });

    /** NCR count by severity (open and total). */
    app.get('/reports/ncr-severity', async (req) => {
      const a = auth(req);
      requirePerm(a, 'quality.ncr.read');
      return k.db.tx(a.tenantId, async (c) => {
        const rows = (await c.query(
          `select v.severity, count(n.id) filter (where n.status <> 'closed')::int as open, count(n.id) filter (where n.status = 'closed')::int as closed, count(n.id)::int as total
           from (values ('critical', 1), ('major', 2), ('minor', 3)) v(severity, ord) left join ncrs n on n.severity = v.severity
           group by v.severity, v.ord order by v.ord`)).rows;
        return rows.map((r: any) => ({ ...r, severity_th: TH.severity[r.severity] }));
      });
    });
  },
};
