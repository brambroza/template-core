import { auth, badRequest, conflict, hasPerm, loadManifest, nextDocNo, one, parse, requirePerm, s, z, type AuthContext, type Client, type Kernel, type ServiceDefinition } from '@erp/kernel';
import { round } from '@erp/thai';
import { fileURLToPath } from 'node:url';
import { addDays, addMonths, billingSchedule, pmDueDates, renewalPeriod, todayBkk, type BillingPlan } from './schedule.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- input schemas ---------------- */

/** '' and null from a form mean "not given" */
const opt = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), schema.optional());
const text = (max = 200) => opt(z.string().trim().max(max));
const flag = z.enum(['1', 'true', '0', 'false']).optional().transform((v) => v === '1' || v === 'true');
const ListQuery = s.listQuery.extend({ limit: z.coerce.number().int().min(1).max(500).default(200) });
const IdParam = z.object({ id: s.uuid });
const hours = z.coerce.number().finite().positive().max(8760);

const PLANS = ['one_time', 'monthly', 'quarterly', 'yearly'] as const;

const ItemInput = z.object({ asset: s.name, serialNo: text(100), location: text(200), note: text(500) });

/** A checklist template: an array, or one item per line from a textarea (leading "-", "•", "1." are dropped). */
const splitLines = (v: string) => v.split(/\r?\n/).map((x) => x.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean);
const Checklist = z.preprocess((v) => (typeof v === 'string' ? splitLines(v) : v), z.array(z.string().trim().min(1).max(300)).max(100).optional());

const ContractBase = z.object({
  customerId: opt(s.uuid),
  customerCode: text(50),
  customerName: s.name,
  contactName: text(),
  contactPhone: text(100),
  title: s.name,
  startDate: s.isoDate,
  endDate: s.isoDate,
  value: z.coerce.number().finite().min(0).max(1e12),
  billingPlan: z.enum(PLANS).default('yearly'),
  slaResponseHours: hours.default(4),
  slaResolveHours: hours.default(24),
  coverage: z.enum(['8x5', '24x7']).default('8x5'),
  pmEveryMonths: z.coerce.number().int().min(0).max(60).default(3),
  firstPmDate: opt(s.isoDate),
  checklist: Checklist,
  /** the same checklist as text from the form's textarea (one item per line); wins over `checklist` */
  checklistText: z.string().max(30000).optional(),
  technicianId: opt(s.uuid),
  technicianName: text(),
  note: text(2000),
  items: z.array(ItemInput).max(500).optional(),
});
const checkContract = (v: Omit<z.infer<typeof ContractBase>, 'customerName'>, ctx: z.RefinementCtx) => {
  if (v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มสัญญา' });
  if (v.slaResolveHours < v.slaResponseHours) ctx.addIssue({ code: 'custom', path: ['slaResolveHours'], message: 'เวลาแก้ไขเสร็จต้องไม่น้อยกว่าเวลาตอบรับ' });
  if (v.firstPmDate && (v.firstPmDate < v.startDate || v.firstPmDate > v.endDate)) ctx.addIssue({ code: 'custom', path: ['firstPmDate'], message: 'วัน PM ครั้งแรกต้องอยู่ในช่วงสัญญา' });
  const list = v.checklistText !== undefined ? splitLines(v.checklistText) : v.checklist ?? [];
  if (list.length > 100 || list.some((x) => x.length > 300)) ctx.addIssue({ code: 'custom', path: ['checklistText'], message: 'รายการตรวจไม่เกิน 100 รายการ รายการละไม่เกิน 300 ตัวอักษร' });
};
const ContractInput = ContractBase.superRefine(checkContract);
/**
 * Edit of a draft: an edit form loads ids but not the lookup's display names, so a missing customer / technician name keeps the stored
 * snapshot when the id did not change; a missing checklist keeps the stored one; `items` omitted = keep the equipment list.
 */
const ContractEdit = ContractBase.extend({ customerName: s.name.optional() }).superRefine(checkContract);
type ContractInput = z.infer<typeof ContractBase>;
type ContractValues = Omit<ContractInput, 'checklist' | 'checklistText' | 'items'> & { customerName: string; checklist: string[] };

const RenewInput = z.object({
  upliftPct: z.coerce.number().finite().min(-50).max(200).default(0),
  startDate: opt(s.isoDate),
  endDate: opt(s.isoDate),
  value: opt(z.coerce.number().finite().min(0).max(1e12)),
});

const GenerateInput = z.object({ until: s.isoDate, contractId: opt(s.uuid), includePast: z.boolean().default(false) });

const VisitEdit = z.object({ scheduledDate: s.isoDate, technicianId: opt(s.uuid), technicianName: text() });
const CompleteInput = z.object({
  signoffName: z.string().trim().min(1).max(200),
  findings: text(5000),
  doneOn: opt(s.isoDate),
  /** answer every item not yet recorded as "pass" */
  markRemainingPass: z.boolean().default(false),
  results: z.array(z.object({ checkId: s.uuid, result: z.enum(['pass', 'fail']), note: text(1000) })).max(200).default([]),
});

/* ---------------- helpers ---------------- */

/** Today in Thailand, as SQL. */
const TODAY = `((now() at time zone 'Asia/Bangkok')::date)`;

const PLAN_LABEL = `case c.billing_plan when 'one_time' then 'ครั้งเดียว' when 'monthly' then 'รายเดือน' when 'quarterly' then 'รายไตรมาส' else 'รายปี' end`;
const CONTRACT_SELECT = `select c.*,
  (c.end_date - ${TODAY}) as days_left,
  ${PLAN_LABEL} as billing_plan_label,
  case c.coverage when '24x7' then '24 ชม. ทุกวัน (24x7)' else 'เวลาทำการ (8x5)' end as coverage_label,
  case when c.pm_every_months = 0 then 'ไม่มี PM' else 'ทุก ' || c.pm_every_months || ' เดือน' end as pm_label,
  (select count(*)::int from contract_items i where i.contract_id = c.id) as item_count
  from contracts c`;

const VISIT_SELECT = `select v.*,
  (v.status = 'planned' and v.scheduled_date < ${TODAY}) as overdue,
  (v.scheduled_date - ${TODAY}) as days_to,
  (select count(*)::int from visit_checks k where k.visit_id = v.id) as checks_total,
  (select count(*)::int from visit_checks k where k.visit_id = v.id and k.result is not null) as checks_done,
  (select count(*)::int from visit_checks k where k.visit_id = v.id and k.result = 'fail') as checks_failed
  from visits v`;

/** Active contracts whose end date has passed become `expired` (lazily, on every read that cares). */
async function expireLapsed(c: Client) {
  await c.query(`update contracts set status = 'expired', updated_at = now() where status = 'active' and end_date < ${TODAY}`);
}

function itemsText(items: { asset: string; serial_no?: string | null; location?: string | null }[]): string | null {
  if (!items.length) return null;
  return items.map((i) => [i.asset, i.location ? `(${i.location})` : '', i.serial_no ? `SN ${i.serial_no}` : ''].filter(Boolean).join(' ')).join(' · ');
}

async function loadContract(c: Client, id: string, lock = false) {
  if (lock) await one(c, 'select id from contracts where id = $1 for update', [id], 'Contract');
  const ct = await one(c, `${CONTRACT_SELECT} where c.id = $1`, [id], 'Contract');
  ct.items = (await c.query('select * from contract_items where contract_id = $1 order by created_at, asset', [id])).rows;
  ct.items_text = itemsText(ct.items);
  ct.checklist_text = (ct.checklist as string[]).join('\n');
  ct.installments = (await c.query(
    `select *, (not invoiced and due_date < ${TODAY}) as overdue from installments where contract_id = $1 order by seq`, [id])).rows;
  ct.installment_count = ct.installments.length;
  ct.billed_amount = round(ct.installments.filter((i: any) => i.invoiced).reduce((t: number, i: any) => t + i.amount, 0), 2);
  ct.unbilled_amount = round(ct.installments.filter((i: any) => !i.invoiced).reduce((t: number, i: any) => t + i.amount, 0), 2);
  ct.visits = (await c.query(`${VISIT_SELECT} where v.contract_id = $1 order by v.due_date`, [id])).rows;
  ct.next_visit_date = ct.visits.find((v: any) => v.status === 'planned')?.scheduled_date ?? null;
  ct.visits_done = ct.visits.filter((v: any) => v.status === 'done').length;
  return ct;
}

async function loadVisit(c: Client, id: string, lock = false) {
  if (lock) await one(c, 'select id from visits where id = $1 for update', [id], 'Visit');
  const v = await one(c, `${VISIT_SELECT} where v.id = $1`, [id], 'Visit');
  const ct = (await c.query(
    `select c.title, c.coverage, c.sla_response_hours, c.sla_resolve_hours, c.contact_name, c.contact_phone, c.customer_code, c.end_date
     from contracts c where c.id = $1`, [v.contract_id])).rows[0] ?? {};
  v.contract_title = ct.title ?? null;
  v.coverage_label = ct.coverage === '24x7' ? '24 ชม. ทุกวัน (24x7)' : 'เวลาทำการ (8x5)';
  v.sla_text = ct.title ? `ตอบรับ ${ct.sla_response_hours} ชม. · แก้ไขเสร็จ ${ct.sla_resolve_hours} ชม.` : null;
  v.contact_name = ct.contact_name ?? null;
  v.contact_phone = ct.contact_phone ?? null;
  v.customer_code = ct.customer_code ?? null;
  v.contract_end_date = ct.end_date ?? null;
  v.items_text = itemsText((await c.query('select asset, serial_no, location from contract_items where contract_id = $1 order by created_at, asset', [v.contract_id])).rows);
  v.checks = (await c.query(
    `select *, case result when 'pass' then 'ผ่าน' when 'fail' then 'ไม่ผ่าน' else 'ยังไม่ตรวจ' end as result_label
     from visit_checks where visit_id = $1 order by seq`, [id])).rows;
  return v;
}

async function insertItems(c: Client, contractId: string, items: z.infer<typeof ItemInput>[]) {
  for (const i of items) {
    await c.query('insert into contract_items (contract_id, asset, serial_no, location, note) values ($1,$2,$3,$4,$5)',
      [contractId, i.asset, i.serialNo ?? null, i.location ?? null, i.note ?? null]);
  }
}

const checklistOf = (b: { checklist?: string[]; checklistText?: string }) =>
  b.checklistText !== undefined ? splitLines(b.checklistText) : b.checklist;

const contractParams = (b: ContractValues) => [
  b.customerId ?? null, b.customerCode ?? null, b.customerName, b.contactName ?? null, b.contactPhone ?? null, b.title,
  b.startDate, b.endDate, b.value, b.billingPlan, b.slaResponseHours, b.slaResolveHours, b.coverage, b.pmEveryMonths,
  b.firstPmDate ?? null, b.checklist, b.technicianId ?? null, b.technicianName ?? null, b.note ?? null,
];

/**
 * Create PM visits for active contracts with a due date on/before `until` (idempotent per contract + due date).
 * Due dates before the contract was activated are skipped unless `includePast` (past PMs of a migrated contract).
 */
async function generateVisits(c: Client, k: Kernel, a: AuthContext, until: string, contractId?: string, includePast = false) {
  await expireLapsed(c);
  const contracts = (await c.query(
    `select c.*, (c.activated_at at time zone 'Asia/Bangkok')::date::text as activated_on from contracts c
     where c.status = 'active' and c.pm_every_months > 0 and ($1::uuid is null or c.id = $1) order by c.no`, [contractId ?? null])).rows;
  const created: any[] = [];
  for (const ct of contracts) {
    const dates = pmDueDates(ct.first_pm_date ?? ct.start_date, ct.pm_every_months, ct.end_date, until)
      .filter((d) => includePast || !ct.activated_on || d >= ct.activated_on);
    if (!dates.length) continue;
    const have = new Set((await c.query(`select to_char(due_date, 'YYYY-MM-DD') as d from visits where contract_id = $1`, [ct.id])).rows.map((r) => r.d));
    const items = (await c.query('select asset, serial_no, location from contract_items where contract_id = $1 order by created_at, asset', [ct.id])).rows;
    for (const due of dates) {
      if (have.has(due)) continue;
      const no = await nextDocNo(c, 'PMV');
      const v = (await c.query(
        `insert into visits (no, contract_id, contract_no, customer_id, customer_name, due_date, scheduled_date, technician_id, technician_name, created_by)
         values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9) on conflict (tenant_id, contract_id, due_date) do nothing
         returning id, no, contract_no, customer_name, scheduled_date, technician_name`,
        [no, ct.id, ct.no, ct.customer_id, ct.customer_name, due, ct.technician_id, ct.technician_name, a.userId])).rows[0];
      if (!v) continue; // generated concurrently
      for (const [i, item] of (ct.checklist as string[]).entries()) {
        await c.query('insert into visit_checks (visit_id, seq, item) values ($1,$2,$3)', [v.id, i + 1, item]);
      }
      await k.emit(c, 'contracts.visit_due', {
        visitId: v.id, no: v.no, contractId: ct.id, contractNo: ct.no, customerId: ct.customer_id, customerName: ct.customer_name,
        dueDate: due, scheduledDate: due, technicianId: ct.technician_id, technicianName: ct.technician_name,
        itemsText: itemsText(items), coverage: ct.coverage,
      });
      created.push(v);
    }
  }
  return { created: created.length, visits: created, message: created.length ? `สร้างนัด PM ${created.length} รายการ` : 'ไม่มีนัด PM ที่ต้องสร้างเพิ่ม' };
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    /* ================= contracts ================= */

    app.get('/contracts', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.contract.read');
      const q = parse(ListQuery.extend({
        status: text(20), customerId: opt(s.uuid), billingPlan: text(20), expiringDays: opt(z.coerce.number().int().min(0).max(3650)),
      }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        await expireLapsed(c);
        return (await c.query(
          `${CONTRACT_SELECT}
           where ($1::text is null or c.status = $1) and ($2::uuid is null or c.customer_id = $2) and ($3::text is null or c.billing_plan = $3)
             and ($4::int is null or (c.status = 'active' and c.end_date <= ${TODAY} + $4::int))
             and ($5::text is null or c.no ilike $5 or c.title ilike $5 or c.customer_name ilike $5 or c.customer_code ilike $5
                  or exists (select 1 from contract_items i where i.contract_id = c.id and (i.serial_no ilike $5 or i.asset ilike $5 or i.location ilike $5)))
           order by (c.status = 'cancelled'), c.end_date, c.no limit $6 offset $7`,
          [q.status ?? null, q.customerId ?? null, q.billingPlan ?? null, q.expiringDays ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows;
      });
    });

    /** Active contracts ending within `days` (default 60) — not yet renewed unless `all=1`. */
    app.get('/contracts/expiring', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.contract.read');
      const q = parse(z.object({ days: z.coerce.number().int().min(0).max(3650).default(60), all: flag }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        await expireLapsed(c);
        return (await c.query(
          `${CONTRACT_SELECT} where c.status = 'active' and c.end_date <= ${TODAY} + $1::int and ($2 or c.renewed_to_id is null) order by c.end_date, c.no`,
          [q.days, q.all])).rows;
      });
    });

    /** Emit `contracts.contract_expiring` for contracts ending within `days` — safe to call daily: once per contract per month. */
    app.post('/contracts/expiring/notify', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.contract.write');
      const b = parse(z.object({ days: z.coerce.number().int().min(0).max(3650).default(60) }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        await expireLapsed(c);
        const due = (await c.query(`${CONTRACT_SELECT} where c.status = 'active' and c.renewed_to_id is null and c.end_date <= ${TODAY} + $1::int order by c.end_date`, [b.days])).rows;
        const notified: string[] = [];
        for (const ct of due) {
          const fresh = await c.query(
            `insert into expiry_notices (contract_id, month) values ($1, to_char(${TODAY}, 'YYYY-MM')) on conflict (tenant_id, contract_id, month) do nothing returning id`, [ct.id]);
          if (!fresh.rowCount) continue;
          await k.emit(c, 'contracts.contract_expiring', {
            contractId: ct.id, no: ct.no, customerId: ct.customer_id, customerName: ct.customer_name, title: ct.title,
            endDate: ct.end_date, daysLeft: ct.days_left, value: ct.value,
          });
          notified.push(ct.no);
        }
        return { notified: notified.length, contracts: notified, message: notified.length ? `แจ้งเตือนสัญญาใกล้หมด ${notified.length} ฉบับ: ${notified.join(', ')}` : 'ไม่มีสัญญาที่ต้องแจ้งเตือนเพิ่ม (แจ้งแล้วในเดือนนี้)' };
      });
    });

    app.get('/contracts/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.contract.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => { await expireLapsed(c); return loadContract(c, id); });
    });

    app.post('/contracts', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'contracts.contract.write');
      const b = parse(ContractInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const no = await nextDocNo(c, 'MA');
        const row = (await c.query(
          `insert into contracts (no, customer_id, customer_code, customer_name, contact_name, contact_phone, title, start_date, end_date, value, billing_plan,
             sla_response_hours, sla_resolve_hours, coverage, pm_every_months, first_pm_date, checklist, technician_id, technician_name, note, created_by, created_by_name)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning id`,
          [no, ...contractParams({ ...b, checklist: checklistOf(b) ?? [] }), a.userId, a.userName ?? null])).rows[0];
        await insertItems(c, row.id, b.items ?? []);
        return loadContract(c, row.id);
      });
    });

    /** Edit a draft (items are replaced by the given list). */
    app.put('/contracts/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.contract.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ContractEdit, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const ct = await loadContract(c, id, true);
        if (ct.status !== 'draft') throw conflict(`แก้ไขได้เฉพาะสัญญาร่าง (${ct.no} สถานะ ${ct.status})`);
        const sameCustomer = !b.customerId || b.customerId === ct.customer_id;
        if (!b.customerName && !sameCustomer) throw badRequest('Validation failed', { fieldErrors: { customerName: ['ระบุชื่อลูกค้า'] } });
        const sameTech = b.technicianId === (ct.technician_id ?? undefined);
        const v: ContractValues = {
          ...b,
          customerId: b.customerId ?? (b.customerName ? undefined : ct.customer_id ?? undefined),
          customerName: b.customerName ?? ct.customer_name,
          customerCode: b.customerCode ?? (sameCustomer && !b.customerName ? ct.customer_code ?? undefined : undefined),
          technicianName: b.technicianName ?? (sameTech ? ct.technician_name ?? undefined : undefined),
          checklist: checklistOf(b) ?? ct.checklist,
        };
        await c.query(
          `update contracts set customer_id = $2, customer_code = $3, customer_name = $4, contact_name = $5, contact_phone = $6, title = $7, start_date = $8, end_date = $9,
             value = $10, billing_plan = $11, sla_response_hours = $12, sla_resolve_hours = $13, coverage = $14, pm_every_months = $15, first_pm_date = $16,
             checklist = $17, technician_id = $18, technician_name = $19, note = $20, updated_at = now() where id = $1`,
          [id, ...contractParams(v)]);
        if (b.items) {
          await c.query('delete from contract_items where contract_id = $1', [id]);
          await insertItems(c, id, b.items);
        }
        return loadContract(c, id);
      });
    });

    /** draft → active: builds the billing installments from the plan. */
    app.post('/contracts/:id/activate', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.contract.activate');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const ct = await loadContract(c, id, true);
        if (ct.status !== 'draft') throw conflict(`เปิดใช้ได้เฉพาะสัญญาร่าง (${ct.no} สถานะ ${ct.status})`);
        if (ct.end_date < todayBkk()) throw conflict(`สัญญา ${ct.no} สิ้นสุดไปแล้ว (${ct.end_date}) — แก้วันที่ก่อนเปิดใช้`);
        await c.query('delete from installments where contract_id = $1', [id]);
        for (const i of billingSchedule(ct.start_date, ct.end_date, ct.billing_plan as BillingPlan, ct.value)) {
          await c.query('insert into installments (contract_id, seq, due_date, amount) values ($1,$2,$3,$4)', [id, i.seq, i.dueDate, i.amount]);
        }
        await c.query(`update contracts set status = 'active', activated_at = now(), updated_at = now() where id = $1`, [id]);
        return loadContract(c, id);
      });
    });

    /** draft | active → cancelled. Planned visits are cancelled; a cancelled renewal frees its predecessor to be renewed again. */
    app.post('/contracts/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.contract.activate');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ reason: text(1000) }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        await expireLapsed(c);
        const ct = await loadContract(c, id, true);
        if (!['draft', 'active'].includes(ct.status)) throw conflict(`ยกเลิกไม่ได้: ${ct.no} สถานะ ${ct.status}`);
        await c.query(`update contracts set status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() where id = $1`, [id, b.reason ?? null]);
        await c.query(`update visits set status = 'cancelled', missed_reason = 'ยกเลิกสัญญา', updated_at = now() where contract_id = $1 and status = 'planned'`, [id]);
        if (ct.renewal_of) await c.query('update contracts set renewed_to_id = null, renewed_to_no = null, updated_at = now() where id = $1 and renewed_to_id = $2', [ct.renewal_of, id]);
        return loadContract(c, id);
      });
    });

    /** active | expired → a new draft for the next period (same terms, value × (1 + uplift %)), linked both ways. */
    app.post('/contracts/:id/renew', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'contracts.contract.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(RenewInput, req.body ?? {});
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await expireLapsed(c);
        const old = await loadContract(c, id, true);
        if (!['active', 'expired'].includes(old.status)) throw conflict(`ต่ออายุได้เฉพาะสัญญาที่มีผลหรือหมดอายุแล้ว (${old.no} สถานะ ${old.status})`);
        if (old.renewed_to_id) throw conflict(`${old.no} ต่ออายุไปแล้วเป็น ${old.renewed_to_no}`);
        const period = renewalPeriod(old.start_date, old.end_date);
        const startDate = b.startDate ?? period.startDate;
        const endDate = b.endDate ?? (b.startDate ? addDays(addMonths(b.startDate, 12), -1) : period.endDate);
        if (endDate < startDate) throw badRequest('Validation failed', { fieldErrors: { endDate: ['วันสิ้นสุดต้องไม่ก่อนวันเริ่มสัญญา'] } });
        const value = b.value ?? round(old.value * (1 + b.upliftPct / 100), 2);
        const no = await nextDocNo(c, 'MA');
        const row = (await c.query(
          `insert into contracts (no, customer_id, customer_code, customer_name, contact_name, contact_phone, title, start_date, end_date, value, billing_plan,
             sla_response_hours, sla_resolve_hours, coverage, pm_every_months, checklist, technician_id, technician_name, note,
             renewal_of, renewal_of_no, uplift_pct, created_by, created_by_name)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) returning id`,
          [no, old.customer_id, old.customer_code, old.customer_name, old.contact_name, old.contact_phone, old.title, startDate, endDate, value, old.billing_plan,
            old.sla_response_hours, old.sla_resolve_hours, old.coverage, old.pm_every_months, old.checklist, old.technician_id, old.technician_name, old.note,
            old.id, old.no, b.upliftPct, a.userId, a.userName ?? null])).rows[0];
        await c.query(
          `insert into contract_items (contract_id, asset, serial_no, location, note) select $2, asset, serial_no, location, note from contract_items where contract_id = $1`,
          [old.id, row.id]);
        await c.query('update contracts set renewed_to_id = $2, renewed_to_no = $3, updated_at = now() where id = $1', [old.id, row.id, no]);
        return loadContract(c, row.id);
      });
    });

    /** Equipment / site added to a draft or active contract. */
    app.post('/contracts/:id/items', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'contracts.contract.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ItemInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const ct = await loadContract(c, id, true);
        if (!['draft', 'active'].includes(ct.status)) throw conflict(`เพิ่มอุปกรณ์ได้เฉพาะสัญญาร่างหรือที่มีผล (${ct.no} สถานะ ${ct.status})`);
        await insertItems(c, id, [b]);
        return loadContract(c, id);
      });
    });

    app.delete('/contract-items/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.contract.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const it = await one(c, `select i.*, c.status, c.no from contract_items i join contracts c on c.id = i.contract_id where i.id = $1 for update of i`, [id], 'Contract item');
        if (!['draft', 'active'].includes(it.status)) throw conflict(`ลบอุปกรณ์ไม่ได้: ${it.no} สถานะ ${it.status}`);
        await c.query('delete from contract_items where id = $1', [id]);
        return { deleted: id, message: `ลบ "${it.asset}" ออกจาก ${it.no} แล้ว` };
      });
    });

    /** Is this customer / serial covered? One row per covered item of every active contract (contracts without items: one row). */
    app.get('/coverage', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.contract.read');
      const q = parse(ListQuery.extend({ customerId: opt(s.uuid) }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        await expireLapsed(c);
        return (await c.query(
          `select c.id, c.no, c.customer_id, c.customer_code, c.customer_name, c.title, c.start_date, c.end_date, (c.end_date - ${TODAY}) as days_left,
                  c.coverage, case c.coverage when '24x7' then '24x7' else '8x5' end as coverage_label, c.sla_response_hours, c.sla_resolve_hours,
                  i.id as item_id, i.asset, i.serial_no, i.location
           from contracts c left join contract_items i on i.contract_id = c.id
           where c.status = 'active' and ($1::uuid is null or c.customer_id = $1)
             and ($2::text is null or c.no ilike $2 or c.customer_name ilike $2 or c.customer_code ilike $2 or c.title ilike $2
                  or i.serial_no ilike $2 or i.asset ilike $2 or i.location ilike $2)
           order by c.customer_name, c.no, i.asset limit $3 offset $4`,
          [q.customerId ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows;
      });
    });

    /* ================= PM visits ================= */

    app.post('/visits/generate', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.visit.plan');
      const b = parse(GenerateInput, req.body ?? {});
      if (b.until > addMonths(todayBkk(), 36)) throw badRequest('Validation failed', { fieldErrors: { until: ['สร้างล่วงหน้าได้ไม่เกิน 3 ปี'] } });
      return k.db.tx(a.tenantId, (c) => generateVisits(c, k, a, b.until, b.contractId, b.includePast));
    });

    app.post('/contracts/:id/generate-visits', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.visit.plan');
      const { id } = parse(IdParam, req.params);
      const b = parse(GenerateInput.omit({ contractId: true }), req.body ?? {});
      if (b.until > addMonths(todayBkk(), 36)) throw badRequest('Validation failed', { fieldErrors: { until: ['สร้างล่วงหน้าได้ไม่เกิน 3 ปี'] } });
      return k.db.tx(a.tenantId, async (c) => {
        const ct = await loadContract(c, id);
        if (ct.status !== 'active') throw conflict(`สร้างนัด PM ได้เฉพาะสัญญาที่มีผล (${ct.no} สถานะ ${ct.status})`);
        return generateVisits(c, k, a, b.until, id, b.includePast);
      });
    });

    app.get('/visits', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.visit.read');
      const q = parse(ListQuery.extend({
        status: text(20), contractId: opt(s.uuid), technicianId: opt(s.uuid), customerId: opt(s.uuid), overdue: flag,
        from: opt(s.isoDate), to: opt(s.isoDate),
      }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${VISIT_SELECT}
         where ($1::text is null or v.status = $1) and ($2::uuid is null or v.contract_id = $2) and ($3::uuid is null or v.technician_id = $3)
           and ($4::uuid is null or v.customer_id = $4) and (not $5 or (v.status = 'planned' and v.scheduled_date < ${TODAY}))
           and ($6::date is null or v.scheduled_date >= $6) and ($7::date is null or v.scheduled_date <= $7)
           and ($8::text is null or v.no ilike $8 or v.contract_no ilike $8 or v.customer_name ilike $8 or v.technician_name ilike $8)
         order by (v.status <> 'planned'), v.scheduled_date, v.no limit $9 offset $10`,
        [q.status ?? null, q.contractId ?? null, q.technicianId ?? null, q.customerId ?? null, q.overdue, q.from ?? null, q.to ?? null,
          q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    /** PM due today or overdue (every technician) — "PM วันนี้". */
    app.get('/visits/today', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.visit.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${VISIT_SELECT} where v.status = 'planned' and v.scheduled_date <= ${TODAY} order by v.scheduled_date, v.customer_name limit 500`)).rows);
    });

    /** My planned visits up to today + `days` (default 0 = today and overdue) — technician's phone. */
    app.get('/visits/mine', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.visit.read');
      const q = parse(z.object({ days: z.coerce.number().int().min(0).max(90).default(0) }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${VISIT_SELECT} where v.status = 'planned' and v.technician_id = $1 and v.scheduled_date <= ${TODAY} + $2::int order by v.scheduled_date, v.customer_name limit 500`,
        [a.userId, q.days])).rows);
    });

    app.get('/visits/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.visit.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadVisit(c, id));
    });

    app.get('/visits/:id/checks', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.visit.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => (await loadVisit(c, id)).checks.map((k2: any) => ({ ...k2, status: k2.result ?? 'open' })));
    });

    /** Reschedule / assign a planned visit. */
    app.put('/visits/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.visit.plan');
      const { id } = parse(IdParam, req.params);
      const b = parse(VisitEdit, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const v = await loadVisit(c, id, true);
        if (v.status !== 'planned') throw conflict(`แก้นัดได้เฉพาะนัดที่ยังไม่เข้า (${v.no} สถานะ ${v.status})`);
        const name = b.technicianName ?? (b.technicianId && b.technicianId === v.technician_id ? v.technician_name : null);
        await c.query('update visits set scheduled_date = $2, technician_id = $3, technician_name = $4, updated_at = now() where id = $1',
          [id, b.scheduledDate, b.technicianId ?? null, b.technicianId ? name : null]);
        return loadVisit(c, id);
      });
    });

    /** missed → planned again on a new date. */
    app.post('/visits/:id/reschedule', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.visit.plan');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ scheduledDate: s.isoDate }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const v = await loadVisit(c, id, true);
        if (!['planned', 'missed'].includes(v.status)) throw conflict(`เลื่อนนัดไม่ได้: ${v.no} สถานะ ${v.status}`);
        await c.query(`update visits set status = 'planned', scheduled_date = $2, missed_reason = null, updated_at = now() where id = $1`, [id, b.scheduledDate]);
        return loadVisit(c, id);
      });
    });

    /** The technician arrives: takes the visit if unassigned; the app then opens the checklist. */
    app.post('/visits/:id/start', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.visit.work');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const v = await loadVisit(c, id, true);
        if (v.status !== 'planned') throw conflict(`เริ่มงานไม่ได้: ${v.no} สถานะ ${v.status}`);
        await c.query(
          `update visits set started_at = coalesce(started_at, now()), technician_name = case when technician_id is null then $3 else technician_name end,
             technician_id = coalesce(technician_id, $2), updated_at = now() where id = $1`, [id, a.userId, a.userName ?? null]);
        return loadVisit(c, id);
      });
    });

    const recordCheck = (path: string, result: 'pass' | 'fail') =>
      app.post(`/checks/:id/${path}`, async (req) => {
        const a = auth(req);
        requirePerm(a, 'contracts.visit.work');
        const { id } = parse(IdParam, req.params);
        const b = parse(z.object({ note: text(1000) }), req.body ?? {});
        return k.db.tx(a.tenantId, async (c) => {
          const ck = await one(c, `select k.*, v.status, v.no from visit_checks k join visits v on v.id = k.visit_id where k.id = $1 for update of v`, [id], 'Checklist item');
          if (ck.status !== 'planned') throw conflict(`${ck.no} ปิดงานแล้ว (สถานะ ${ck.status})`);
          return (await c.query(
            `update visit_checks set result = $2, note = coalesce($3, note), checked_at = now() where id = $1
             returning *, case result when 'pass' then 'ผ่าน' else 'ไม่ผ่าน' end as result_label, result as status`, [id, result, b.note ?? null])).rows[0];
        });
      });
    recordCheck('pass', 'pass');
    recordCheck('fail', 'fail');

    /** planned → done with the customer's sign-off; every checklist item needs a result. */
    app.post('/visits/:id/complete', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.visit.work');
      const { id } = parse(IdParam, req.params);
      const b = parse(CompleteInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const v = await loadVisit(c, id, true);
        if (v.status !== 'planned') throw conflict(`ปิดงานไม่ได้: ${v.no} สถานะ ${v.status}`);
        const own = new Set(v.checks.map((x: any) => x.id));
        const foreign = b.results.filter((r) => !own.has(r.checkId));
        if (foreign.length) throw badRequest('Validation failed', { fieldErrors: { results: ['รายการตรวจไม่ได้อยู่ในนัดนี้'] } });
        for (const r of b.results) {
          await c.query('update visit_checks set result = $2, note = coalesce($3, note), checked_at = now() where id = $1', [r.checkId, r.result, r.note ?? null]);
        }
        if (b.markRemainingPass) await c.query(`update visit_checks set result = 'pass', checked_at = now() where visit_id = $1 and result is null`, [id]);
        const open = (await c.query('select count(*)::int as n from visit_checks where visit_id = $1 and result is null', [id])).rows[0].n;
        if (open) throw conflict(`ยังไม่ได้บันทึกผลตรวจ ${open} รายการ — บันทึกให้ครบ หรือเลือก "รายการที่เหลือ = ผ่าน"`);
        await c.query(
          `update visits set status = 'done', done_on = coalesce($2::date, ${TODAY}), done_at = now(), signoff_name = $3, findings = $4,
             started_at = coalesce(started_at, now()), completed_by_name = $5,
             technician_name = case when technician_id is null then $5 else technician_name end, technician_id = coalesce(technician_id, $6), updated_at = now()
           where id = $1`,
          [id, b.doneOn ?? null, b.signoffName, b.findings ?? null, a.userName ?? null, a.userId]);
        return loadVisit(c, id);
      });
    });

    /** planned → missed (customer closed, no access…). */
    app.post('/visits/:id/miss', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.visit.plan');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ reason: z.string().trim().min(1).max(1000) }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const v = await loadVisit(c, id, true);
        if (v.status !== 'planned') throw conflict(`บันทึกไม่ได้เข้าไม่ได้: ${v.no} สถานะ ${v.status}`);
        await c.query(`update visits set status = 'missed', missed_reason = $2, updated_at = now() where id = $1`, [id, b.reason]);
        return loadVisit(c, id);
      });
    });

    /* ================= billing schedule ================= */

    /**
     * Installments to invoice. `scope`: `due` (default: not invoiced, due by the end of this month), `open` (all not invoiced), `all`.
     * Cancelled and draft contracts are left out.
     */
    app.get('/billing', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.billing.read');
      const q = parse(ListQuery.extend({ scope: z.enum(['due', 'open', 'all']).default('due'), contractId: opt(s.uuid), overdue: flag }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        await expireLapsed(c);
        return (await c.query(
          `select i.*, (not i.invoiced and i.due_date < ${TODAY}) as overdue, c.no as contract_no, c.title, c.customer_id, c.customer_name, c.status as contract_status,
                  ${PLAN_LABEL} as billing_plan_label, (select count(*)::int from installments x where x.contract_id = i.contract_id) as installment_count,
                  i.seq || '/' || (select count(*) from installments x where x.contract_id = i.contract_id) as period_label
           from installments i join contracts c on c.id = i.contract_id
           where c.status in ('active', 'expired')
             and ($1 = 'all' or not i.invoiced)
             and ($1 <> 'due' or i.due_date < (date_trunc('month', ${TODAY}) + interval '1 month')::date)
             and ($2::uuid is null or i.contract_id = $2) and (not $3 or (not i.invoiced and i.due_date < ${TODAY}))
             and ($4::text is null or c.no ilike $4 or c.customer_name ilike $4 or c.title ilike $4 or i.invoice_no ilike $4)
           order by i.invoiced, i.due_date, c.no limit $5 offset $6`,
          [q.scope, q.contractId ?? null, q.overdue, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows;
      });
    });

    /**
     * Send installments due for invoicing to Sales: `contracts.installment_due` once per installment (→ a draft service sales order there).
     * Due = not invoiced, not sent yet, contract active/expired, due by the end of this month (+ `days` ahead). Safe to call daily.
     */
    app.post('/billing/due/notify', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.billing.write');
      const b = parse(z.object({ days: z.coerce.number().int().min(0).max(366).default(0), contractId: opt(s.uuid) }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        await expireLapsed(c);
        const due = (await c.query(
          `select x.*, to_char(x.due_date, 'YYYY-MM-DD') as due, to_char(x.next_due - 1, 'YYYY-MM-DD') as period_to_next, to_char(x.end_date, 'YYYY-MM-DD') as end_iso
           from (select i.*, c.no as contract_no, c.title, c.customer_id, c.customer_code, c.customer_name, c.billing_plan, c.end_date,
                        lead(i.due_date) over (partition by i.contract_id order by i.seq) as next_due,
                        count(*) over (partition by i.contract_id)::int as installment_count
                 from installments i join contracts c on c.id = i.contract_id where c.status in ('active', 'expired')) x
           where not x.invoiced and x.notified_at is null and ($2::uuid is null or x.contract_id = $2)
             and x.due_date < (date_trunc('month', ${TODAY}) + interval '1 month')::date + $1::int
           order by x.due_date, x.contract_no`, [b.days, b.contractId ?? null])).rows;
        const sent: string[] = [];
        for (const i of due) {
          const fresh = await c.query(`update installments set notified_at = now(), notified_by_name = $2 where id = $1 and notified_at is null returning id`, [i.id, a.userName ?? null]);
          if (!fresh.rowCount) continue;
          await k.emit(c, 'contracts.installment_due', {
            installmentId: i.id, contractId: i.contract_id, contractNo: i.contract_no, title: i.title, customerId: i.customer_id, customerCode: i.customer_code ?? null,
            customerName: i.customer_name, seq: i.seq, count: i.installment_count, dueDate: i.due, amount: Number(i.amount), billingPlan: i.billing_plan,
            periodFrom: i.billing_plan === 'one_time' ? null : i.due, periodTo: i.billing_plan === 'one_time' ? null : i.period_to_next ?? i.end_iso,
          });
          sent.push(`${i.contract_no} งวด ${i.seq}/${i.installment_count}`);
        }
        return { notified: sent.length, installments: sent, message: sent.length ? `ส่งงวดถึงกำหนดให้ฝ่ายขายร่างใบสั่งขาย ${sent.length} งวด: ${sent.join(', ')}` : 'ไม่มีงวดที่ต้องส่งเพิ่ม (ส่งแล้ว หรือวางบิลแล้ว)' };
      });
    });

    /** Record that this installment was invoiced in Sales (the invoice number is text — no call into Sales). */
    app.post('/installments/:id/bill', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.billing.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ invoiceNo: s.code, invoicedOn: opt(s.isoDate) }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const i = await one(c, 'select i.*, c.status, c.no from installments i join contracts c on c.id = i.contract_id where i.id = $1 for update of i', [id], 'Installment');
        if (!['active', 'expired'].includes(i.status)) throw conflict(`${i.no} สถานะ ${i.status} — วางบิลไม่ได้`);
        if (i.invoiced) throw conflict(`งวดที่ ${i.seq} ของ ${i.no} วางบิลแล้ว (${i.invoice_no})`);
        await c.query(`update installments set invoiced = true, invoice_no = $2, invoiced_on = coalesce($3::date, ${TODAY}), invoiced_by_name = $4 where id = $1`,
          [id, b.invoiceNo, b.invoicedOn ?? null, a.userName ?? null]);
        return { ...(await c.query('select * from installments where id = $1', [id])).rows[0], message: `บันทึกวางบิลงวดที่ ${i.seq} ของ ${i.no} เลขที่ ${b.invoiceNo} แล้ว` };
      });
    });

    app.post('/installments/:id/unbill', async (req) => {
      const a = auth(req);
      requirePerm(a, 'contracts.billing.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const i = await one(c, 'select i.*, c.no from installments i join contracts c on c.id = i.contract_id where i.id = $1 for update of i', [id], 'Installment');
        if (!i.invoiced) throw conflict(`งวดที่ ${i.seq} ของ ${i.no} ยังไม่ได้วางบิล`);
        await c.query('update installments set invoiced = false, invoice_no = null, invoiced_on = null, invoiced_by_name = null where id = $1', [id]);
        return { ...(await c.query('select * from installments where id = $1', [id])).rows[0], message: `ยกเลิกการวางบิลงวดที่ ${i.seq} ของ ${i.no} แล้ว` };
      });
    });

    /* ================= dashboard ================= */

    app.get('/summary', async (req) => {
      const a = auth(req);
      if (!hasPerm(a, 'contracts.visit.read')) requirePerm(a, 'contracts.contract.read');
      return k.db.tx(a.tenantId, async (c) => {
        await expireLapsed(c);
        const n = (await c.query(
          `select count(*) filter (where status = 'active')::int as active,
                  coalesce(sum(value) filter (where status = 'active'), 0) as active_value,
                  count(*) filter (where status = 'active' and renewed_to_id is null and end_date <= ${TODAY} + 60)::int as expiring60,
                  count(*) filter (where status = 'draft')::int as drafts
           from contracts`)).rows[0];
        const v = (await c.query(
          `select count(*) filter (where status = 'planned' and scheduled_date between ${TODAY} and ${TODAY} + 6)::int as due_week,
                  count(*) filter (where status = 'planned' and scheduled_date < ${TODAY})::int as overdue,
                  count(*) filter (where status = 'planned' and scheduled_date <= ${TODAY})::int as today,
                  count(*) filter (where status = 'done' and date_trunc('month', done_on) = date_trunc('month', ${TODAY}))::int as done_month
           from visits`)).rows[0];
        const bill = (await c.query(
          `select count(*)::int as n, coalesce(sum(i.amount), 0) as amount from installments i join contracts c on c.id = i.contract_id
           where c.status in ('active', 'expired') and not i.invoiced and i.due_date < (date_trunc('month', ${TODAY}) + interval '1 month')::date`)).rows[0];
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month,
                  (select count(*)::int from visits where status = 'done' and date_trunc('month', done_on) = m) as done,
                  (select count(*)::int from visits where status = 'missed' and date_trunc('month', scheduled_date) = m) as missed
           from generate_series(date_trunc('month', ${TODAY}) - interval '5 months', date_trunc('month', ${TODAY}), interval '1 month') m order by m`)).rows;
        const rows = (await c.query(
          `select id, no, customer_name, title, status, value, end_date, (end_date - ${TODAY}) as days_left from contracts
           where status <> 'cancelled' order by (status = 'expired'), end_date limit 40`)).rows;
        return {
          activeContracts: n.active, activeValue: n.active_value, expiring60: n.expiring60, drafts: n.drafts,
          visitsDueWeek: v.due_week, overdueVisits: v.overdue, visitsToday: v.today, visitsDoneMonth: v.done_month,
          billingDueMonth: bill.amount, billingDueCount: bill.n,
          months, rows,
        };
      });
    });
  },
};
