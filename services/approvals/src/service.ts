import { auth, badRequest, conflict, forbidden, hasPerm, loadManifest, nextDocNo, one, parse, requirePerm, s, z, type AuthContext, type Client, type Kernel, type ServiceDefinition } from '@erp/kernel';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- input schemas ---------------- */

const Approver = z.object({ userId: s.uuid, userName: z.string().trim().max(200).optional() });
const Approvers = z.array(Approver).max(10).refine((xs) => new Set(xs.map((x) => x.userId)).size === xs.length, 'approver listed twice');
const text = (max: number) => z.string().trim().max(max);
const Note = z.object({ note: text(2000).min(1) });
const OptionalNote = z.object({ note: text(2000).optional() }).default({});

const TypeInput = z.object({
  code: s.code,
  name: s.name,
  description: text(2000).optional(),
  amountNote: text(500).optional(),
  approvers: Approvers.default([]),
  /** true (default) = requesters cannot pick or change approvers; the chain comes from the type */
  lockApprovers: z.boolean().default(true),
  active: z.boolean().default(true),
});
const TypeUpdate = z.object({
  name: s.name.optional(),
  description: text(2000).nullable().optional(),
  amountNote: text(500).nullable().optional(),
  lockApprovers: z.boolean().optional(),
  active: z.boolean().optional(),
});
const ApproversInput = z.object({ approvers: Approvers });

const RequestInput = z.object({
  typeId: s.uuid,
  title: s.name,
  detail: text(5000).optional(),
  amount: s.money.nullable().optional(),
  neededBy: s.isoDate.nullable().optional(),
  /** ignored when the token carries the user's name (the token is the source of truth for "requested by") */
  requesterName: text(200).optional(),
  department: text(200).optional(),
  /** omit to copy the type's default approver chain (only allowed when the type is not `lockApprovers`, or for approvals admins) */
  approvers: Approvers.optional(),
  /** true = send for approval straight away */
  submit: z.boolean().default(false),
});
const RequestUpdate = z.object({
  title: s.name.optional(),
  detail: text(5000).nullable().optional(),
  amount: s.money.nullable().optional(),
  neededBy: s.isoDate.nullable().optional(),
  requesterName: text(200).nullable().optional(),
  department: text(200).nullable().optional(),
});
const DelegationInput = z.object({
  toUserId: s.uuid,
  toUserName: text(200).optional(),
  startsOn: s.isoDate,
  endsOn: s.isoDate,
  note: text(1000).optional(),
  /** approvals admins only: set up a delegation for another approver */
  fromUserId: s.uuid.optional(),
  fromUserName: text(200).optional(),
});
const IdParam = z.object({ id: s.uuid });
const flag = z.enum(['true', 'false', '1', '0']).optional().transform((v) => (v === undefined ? undefined : v === 'true' || v === '1'));
const ListQuery = s.listQuery.extend({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  status: z.string().optional(),
  typeId: s.uuid.optional(),
  mine: flag,
});

/* ---------------- helpers ---------------- */

const ACTION_TH: Record<string, string> = {
  created: 'สร้างคำขอ', edited: 'แก้ไขคำขอ', approvers_changed: 'เปลี่ยนผู้อนุมัติ', submitted: 'ส่งขออนุมัติ', approved: 'อนุมัติ',
  rejected: 'ไม่อนุมัติ', returned: 'ส่งกลับแก้ไข', cancelled: 'ยกเลิก', commented: 'แสดงความเห็น',
};
const STEP_TH: Record<string, string> = { waiting: 'รอ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', returned: 'ส่งกลับแก้ไข' };

const isAdmin = (a: AuthContext) => hasPerm(a, 'approvals.request.admin');

/** Today in Thailand (delegation ranges are calendar dates). */
const TODAY = `(now() at time zone 'Asia/Bangkok')::date`;
/** SQL predicate on a delegations row `alias`: in force today. */
const inForce = (alias: string) => `${alias}.cancelled_at is null and ${TODAY} between ${alias}.starts_on and ${alias}.ends_on`;
/** SQL predicate: user `$p` may act for approver `col` today because of a delegation. */
const delegatedTo = (col: string, p: string) => `exists (select 1 from delegations dg where dg.from_user_id = ${col} and dg.to_user_id = ${p} and ${inForce('dg')})`;

/**
 * SQL predicate: the caller raised the request, is one of its approvers, currently stands in for one of its approvers,
 * or acted on it as a delegate before (admins see everything).
 */
const VISIBLE = `(r.requester_id = $1 or $2::boolean
  or exists (select 1 from request_steps vs where vs.request_id = r.id and (vs.approver_id = $1 or ${delegatedTo('vs.approver_id', '$1')}))
  or exists (select 1 from request_history vh where vh.request_id = r.id and vh.actor_id = $1 and vh.on_behalf_of_id is not null))`;

const SELECT_REQ = `select r.*, cs.approver_id as current_approver_id, cs.approver_name as current_approver_name,
    (select dc.to_user_name from delegations dc where dc.from_user_id = cs.approver_id and ${inForce('dc')} order by dc.created_at desc limit 1) as current_delegate_name
  from requests r left join request_steps cs on cs.request_id = r.id and cs.step_no = r.current_step`;

/** The delegation (if any) that lets `userId` act for `approverId` today. */
async function delegationFor(c: Client, approverId: string | null, userId: string) {
  if (!approverId || approverId === userId) return null;
  return (await c.query(`select * from delegations d where d.from_user_id = $1 and d.to_user_id = $2 and ${inForce('d')} order by created_at desc limit 1`, [approverId, userId])).rows[0] ?? null;
}

async function loadType(c: Client, id: string) {
  return one(c, 'select * from request_types where id = $1', [id], 'Request type');
}

async function loadRequest(c: Client, id: string, a: AuthContext, lock = false) {
  if (lock) await c.query('select id from requests where id = $1 for update', [id]);
  const r = await one(c, `${SELECT_REQ} where r.id = $3 and ${VISIBLE}`, [a.userId, isAdmin(a), id], 'Request');
  r.steps = (await c.query('select * from request_steps where request_id = $1 order by step_no', [id])).rows
    .map((st: any) => ({
      ...st,
      status_label: st.status === 'waiting' && st.step_no === r.current_step ? 'รอพิจารณา' : STEP_TH[st.status],
      acted_by_label: st.acted_by_name ? (st.on_behalf_of_name ? `${st.acted_by_name} (แทน ${st.on_behalf_of_name})` : st.acted_by_name) : null,
    }));
  r.history = (await c.query('select * from request_history where request_id = $1 order by at, id', [id])).rows
    .map((h: any) => ({ ...h, action_label: `${ACTION_TH[h.action] ?? h.action}${h.on_behalf_of_name || h.on_behalf_of_id ? ` (แทน ${h.on_behalf_of_name ?? 'ผู้อนุมัติ'})` : ''}` }));
  r.lock_approvers = (await c.query('select lock_approvers from request_types where id = $1', [r.type_id])).rows[0]?.lock_approvers ?? true;
  r.step_text = r.current_step > 0 ? `ขั้นที่ ${r.current_step}/${r.step_count}` : `${r.step_count} ขั้น`;
  r.approvers = r.steps.map((st: any) => ({ userId: st.approver_id, userName: st.approver_name }));
  const mine = r.requester_id === a.userId || isAdmin(a);
  const open = ['draft', 'returned'].includes(r.status);
  r.is_requester = r.requester_id === a.userId;
  const deleg = r.status === 'pending' ? await delegationFor(c, r.current_approver_id, a.userId) : null;
  r.acting_for_name = deleg ? (r.current_approver_name ?? deleg.from_user_name ?? null) : null;
  // nobody approves their own request (segregation of duties) — not even an approvals admin or a delegate
  r.can_act = r.status === 'pending' && (r.current_approver_id === a.userId || !!deleg || isAdmin(a)) && r.requester_id !== a.userId;
  r.can_edit = open && mine;
  r.can_change_approvers = open && mine && (!r.lock_approvers || isAdmin(a));
  r.can_submit = open && mine;
  r.can_cancel = ['draft', 'pending', 'returned'].includes(r.status) && mine;
  return r;
}

/** Display name of the caller for the audit trail: the token's name, else the snapshots on the request (old tokens carry no names). */
function actorName(r: any, a: AuthContext): string | null {
  if (a.userName) return a.userName;
  const st = r.steps?.find((x: any) => x.approver_id === a.userId);
  if (st?.approver_name) return st.approver_name;
  if (r.requester_id === a.userId) return r.requester_name ?? null;
  return null;
}

async function history(c: Client, r: any, a: AuthContext, action: string, note?: string | null, stepNo?: number | null, onBehalf?: { id: string; name: string | null } | null) {
  await c.query(
    'insert into request_history (request_id, actor_id, actor_name, action, step_no, note, on_behalf_of_id, on_behalf_of_name) values ($1,$2,$3,$4,$5,$6,$7,$8)',
    [r.id, a.userId, actorName(r, a), action, stepNo ?? null, note ?? null, onBehalf?.id ?? null, onBehalf?.name ?? null],
  );
}

async function replaceSteps(c: Client, requestId: string, approvers: { userId: string; userName?: string | null }[]) {
  await c.query('delete from request_steps where request_id = $1', [requestId]);
  for (const [i, ap] of approvers.entries()) {
    await c.query('insert into request_steps (request_id, step_no, approver_id, approver_name) values ($1,$2,$3,$4)', [requestId, i + 1, ap.userId, ap.userName ?? null]);
  }
  await c.query('update requests set step_count = $2, updated_at = now() where id = $1', [requestId, approvers.length]);
}

function requireOwner(r: any, a: AuthContext) {
  if (r.requester_id !== a.userId && !isAdmin(a)) throw forbidden('Only the requester (or an approvals admin) can do this');
}

/** Tell whoever is next on the chain (automation turns this into a LINE / in-app alert). */
async function emitReachedApprover(k: Kernel, c: Client, r: any, stepNo: number) {
  const st = (await c.query('select approver_id, approver_name, (select count(*)::int from request_steps where request_id = $1) as n from request_steps where request_id = $1 and step_no = $2', [r.id, stepNo])).rows[0];
  if (!st) return;
  // whoever stands in for the approver today is told too
  const d = (await c.query(`select to_user_id, to_user_name from delegations d where d.from_user_id = $1 and ${inForce('d')} order by created_at desc limit 1`, [st.approver_id])).rows[0];
  await k.emit(c, 'approvals.request_submitted', {
    requestId: r.id, no: r.no, title: r.title, typeName: r.type_name, requesterName: r.requester_name ?? null, amount: r.amount ?? null,
    nextApproverId: st.approver_id, nextApproverName: st.approver_name ?? null, step: stepNo, stepCount: st.n,
    requesterId: r.requester_id, ...(d ? { delegateId: d.to_user_id, delegateName: d.to_user_name ?? null } : {}),
  });
}

async function submit(k: Kernel, c: Client, r: any, a: AuthContext) {
  if (!['draft', 'returned'].includes(r.status)) throw conflict(`Cannot submit a ${r.status} request`);
  if (r.step_count < 1) throw badRequest('Add at least one approver before submitting');
  await c.query(`update request_steps set status = 'waiting', acted_by = null, acted_at = null, note = null where request_id = $1`, [r.id]);
  await c.query(`update requests set status = 'pending', current_step = 1, submitted_at = now(), decided_at = null, decided_by = null, last_note = null, updated_at = now() where id = $1`, [r.id]);
  await history(c, r, a, 'submitted');
  await emitReachedApprover(k, c, r, 1);
}

/** Approve / reject / return the current step. Only that step's approver, their delegate for today, or an approvals admin may act. */
async function decide(k: Kernel, c: Client, id: string, a: AuthContext, action: 'approved' | 'rejected' | 'returned', note: string | undefined) {
  const r = await loadRequest(c, id, a, true);
  if (r.status !== 'pending') throw conflict(`Cannot ${action === 'approved' ? 'approve' : action === 'rejected' ? 'reject' : 'return'} a ${r.status} request`);
  const own = r.current_approver_id === a.userId;
  const deleg = own ? null : await delegationFor(c, r.current_approver_id, a.userId);
  if (!own && !deleg && !isAdmin(a)) throw forbidden(`Step ${r.current_step} is waiting for ${r.current_approver_name ?? 'another approver'}`);
  if (action === 'approved' && r.requester_id === a.userId) throw forbidden('อนุมัติคำขอของตนเองไม่ได้ — ให้ผู้อนุมัติคนอื่นหรือผู้ดูแลระบบอนุมัติแทน');
  const step = r.current_step;
  // a delegate or an admin acts on behalf of the step's approver; the trail says so ("แทน …")
  const onBehalf = own ? null : { id: r.current_approver_id as string, name: (r.current_approver_name ?? deleg?.from_user_name ?? null) as string | null };
  await c.query(
    `update request_steps set status = $3, acted_by = $4, acted_at = now(), note = $5, acted_by_name = $6, on_behalf_of_name = $7 where request_id = $1 and step_no = $2`,
    [id, step, action, a.userId, note ?? null, actorName(r, a), onBehalf ? (onBehalf.name ?? 'ผู้อนุมัติ') : null]);
  if (action === 'approved' && step < r.step_count) {
    await c.query('update requests set current_step = current_step + 1, updated_at = now() where id = $1', [id]);
  } else if (action === 'returned') {
    await c.query(`update requests set status = 'returned', current_step = 0, last_note = $2, updated_at = now() where id = $1`, [id, note ?? null]);
  } else {
    await c.query(`update requests set status = $2, current_step = 0, decided_at = now(), decided_by = $3, last_note = coalesce($4, last_note), updated_at = now() where id = $1`, [id, action, a.userId, note ?? null]);
  }
  await history(c, r, a, action, note, step, onBehalf);
  if (action === 'approved' && step < r.step_count) await emitReachedApprover(k, c, r, step + 1);
  else {
    await k.emit(c, 'approvals.request_decided', {
      requestId: r.id, no: r.no, title: r.title, decision: action, requesterId: r.requester_id, requesterName: r.requester_name ?? null,
      byName: actorName(r, a), note: note ?? null,
    });
  }
  return loadRequest(c, id, a);
}

/* ---------------- routes ---------------- */

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  // supporting documents on requests; visibility follows the request's own rule
  attachments: {
    read: 'approvals.request.read',
    write: 'approvals.request.write',
    entities: { request: { table: 'requests', access: (c, a, id) => loadRequest(c, id, a) } },
  },
  routes(app, k) {
    /* ----- request types ----- */

    app.get('/types', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.read');
      const q = parse(s.listQuery.extend({ limit: z.coerce.number().int().min(1).max(500).default(200), active: flag }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select t.*, jsonb_array_length(t.approvers) as step_count,
                (select string_agg(x->>'userName', ' → ' order by o) from jsonb_array_elements(t.approvers) with ordinality as e(x, o)) as chain
         from request_types t
         where ($1::boolean is null or active = $1) and ($2::text is null or code ilike $2 or name ilike $2)
         order by code limit $3 offset $4`,
        [q.active ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    app.get('/types/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const t = await loadType(c, id);
        t.step_count = t.approvers.length;
        t.request_count = (await c.query('select count(*)::int as n from requests where type_id = $1', [id])).rows[0].n;
        return t;
      });
    });

    app.post('/types', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'approvals.type.write');
      const b = parse(TypeInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `insert into request_types (code, name, description, amount_note, approvers, active, created_by, lock_approvers) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [b.code, b.name, b.description ?? null, b.amountNote ?? null, JSON.stringify(b.approvers), b.active, a.userId, b.lockApprovers])).rows[0]);
    });

    app.put('/types/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.type.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(TypeUpdate, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await loadType(c, id);
        return (await c.query(
          `update request_types set name = coalesce($2, name),
             description = case when $3::boolean then $4 else description end,
             amount_note = case when $5::boolean then $6 else amount_note end,
             active = coalesce($7, active), lock_approvers = coalesce($8, lock_approvers), updated_at = now()
           where id = $1 returning *`,
          [id, b.name ?? null, b.description !== undefined, b.description ?? null, b.amountNote !== undefined, b.amountNote ?? null, b.active ?? null, b.lockApprovers ?? null])).rows[0];
      });
    });

    /** Replace the default approver chain (used by new requests only). */
    app.put('/types/:id/approvers', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.type.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ApproversInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await loadType(c, id);
        return (await c.query('update request_types set approvers = $2, updated_at = now() where id = $1 returning *', [id, JSON.stringify(b.approvers)])).rows[0];
      });
    });

    /** Delete an unused type (409 once requests reference it — deactivate it instead). */
    app.delete('/types/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.type.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const t = await loadType(c, id);
        const used = (await c.query('select count(*)::int as n from requests where type_id = $1', [id])).rows[0].n;
        if (used > 0) throw conflict(`Type ${t.code} is used by ${used} request(s); deactivate it instead`);
        await c.query('delete from request_types where id = $1', [id]);
        return { deleted: true, id };
      });
    });

    /* ----- requests ----- */

    app.post('/requests', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.write');
      const b = parse(RequestInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const type = await loadType(c, b.typeId);
        if (!type.active) throw conflict(`Request type ${type.code} is inactive`);
        // an empty list (e.g. a form with no approver lines filled) means "use the type's default chain"
        const custom = !!b.approvers?.length && JSON.stringify(b.approvers.map((x) => x.userId)) !== JSON.stringify(type.approvers.map((x: any) => x.userId));
        if (custom && type.lock_approvers && !isAdmin(a)) throw forbidden(`ประเภทคำขอ "${type.name}" กำหนดสายอนุมัติไว้แล้ว ผู้ขอเลือกผู้อนุมัติเองไม่ได้`);
        const approvers = custom ? b.approvers! : type.approvers;
        const no = await nextDocNo(c, 'APV');
        const row = (await c.query(
          `insert into requests (no, type_id, type_code, type_name, title, detail, amount, needed_by, requester_id, requester_name, department)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
          [no, type.id, type.code, type.name, b.title, b.detail ?? null, b.amount ?? null, b.neededBy ?? null, a.userId, a.userName ?? b.requesterName ?? null, b.department ?? null],
        )).rows[0];
        await replaceSteps(c, row.id, approvers);
        await history(c, row, a, 'created');
        if (b.submit) await submit(k, c, { ...row, step_count: approvers.length }, a);
        return loadRequest(c, row.id, a);
      });
    });

    const listRequests = (forceMine: boolean) => async (req: any) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.read');
      const q = parse(ListQuery, req.query);
      const mine = forceMine || q.mine === true;
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${SELECT_REQ} where ${VISIBLE}
           and ($3::boolean = false or r.requester_id = $1)
           and ($4::text is null or r.status = $4)
           and ($5::uuid is null or r.type_id = $5)
           and ($6::text is null or r.no ilike $6 or r.title ilike $6 or r.requester_name ilike $6 or r.type_name ilike $6)
         order by r.created_at desc limit $7 offset $8`,
        [a.userId, isAdmin(a), mine, q.status ?? null, q.typeId ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    };
    /** Everything the caller may see (all requests for approvals admins). `?mine=1` = only my own. */
    app.get('/requests', listRequests(false));
    /** Requests I raised. */
    app.get('/my-requests', listRequests(true));

    /** Waiting for me: pending requests whose current step is mine. */
    app.get('/inbox', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.read');
      const q = parse(ListQuery, req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${SELECT_REQ} where r.status = 'pending' and (cs.approver_id = $1 or ${delegatedTo('cs.approver_id', '$1')})
           and ($2::text is null or r.no ilike $2 or r.title ilike $2 or r.requester_name ilike $2)
         order by r.submitted_at limit $3 offset $4`,
        [a.userId, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows.map((r) => ({
        ...r, can_act: r.requester_id !== a.userId,
        // set when I see it only because the approver delegated to me
        acting_for_name: r.current_approver_id === a.userId ? null : r.current_approver_name,
      })));
    });

    /** Dashboard: my queue, the organisation's pipeline, decisions per month, speed of decisions. */
    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.read');
      const p = [a.userId, isAdmin(a)];
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select count(*) filter (where r.status = 'pending' and exists (select 1 from request_steps cs where cs.request_id = r.id and cs.step_no = r.current_step and (cs.approver_id = $1 or ${delegatedTo('cs.approver_id', '$1')})))::int as waiting_for_me,
                  count(*) filter (where r.status = 'pending')::int as pending_total,
                  count(*) filter (where r.status = 'returned')::int as returned_total,
                  count(*) filter (where r.status = 'approved' and date_trunc('month', r.decided_at) = date_trunc('month', now()))::int as approved_month,
                  count(*) filter (where r.status = 'rejected' and date_trunc('month', r.decided_at) = date_trunc('month', now()))::int as rejected_month,
                  coalesce(sum(r.amount) filter (where r.status = 'approved' and date_trunc('month', r.decided_at) = date_trunc('month', now())), 0) as approved_amount_month,
                  round(avg(extract(epoch from r.decided_at - r.submitted_at) / 3600) filter (where r.status in ('approved', 'rejected') and r.decided_at > now() - interval '180 days')::numeric, 1) as avg_hours
           from requests r where ${VISIBLE}`, p)).rows[0];
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month,
                  count(r.id) filter (where date_trunc('month', r.submitted_at) = m)::int as submitted,
                  count(r.id) filter (where r.status = 'approved' and date_trunc('month', r.decided_at) = m)::int as approved,
                  count(r.id) filter (where r.status = 'rejected' and date_trunc('month', r.decided_at) = m)::int as rejected,
                  coalesce(sum(r.amount) filter (where r.status = 'approved' and date_trunc('month', r.decided_at) = m), 0) as approved_amount
           from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m
           left join requests r on (date_trunc('month', r.submitted_at) = m or date_trunc('month', r.decided_at) = m) and ${VISIBLE}
           group by m order by m`, p)).rows;
        const rows = (await c.query(
          `${SELECT_REQ} where ${VISIBLE} and r.status in ('pending', 'returned', 'approved', 'rejected')
           order by r.updated_at desc limit 30`, p)).rows
          .map((r) => ({ id: r.id, no: r.no, title: r.title, type_name: r.type_name, requester_name: r.requester_name, amount: r.amount, status: r.status, current_approver_name: r.current_approver_name }));
        return {
          waitingForMe: n.waiting_for_me, pendingTotal: n.pending_total, returnedTotal: n.returned_total,
          approvedThisMonth: n.approved_month, rejectedThisMonth: n.rejected_month, approvedAmountThisMonth: n.approved_amount_month,
          avgHoursToDecide: n.avg_hours ?? 0, months, rows,
        };
      });
    });

    app.get('/requests/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadRequest(c, id, a));
    });

    /** Edit the content while draft / returned. */
    app.put('/requests/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(RequestUpdate, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const r = await loadRequest(c, id, a, true);
        requireOwner(r, a);
        if (!['draft', 'returned'].includes(r.status)) throw conflict(`Cannot edit a ${r.status} request`);
        const set = (v: unknown) => v !== undefined;
        // the requester's own name comes from the token; a typed name only counts for an admin fixing someone else's request
        if (r.requester_id === a.userId && a.userName) b.requesterName = a.userName;
        await c.query(
          `update requests set title = coalesce($2, title),
             detail = case when $3 then $4 else detail end,
             amount = case when $5 then $6::numeric else amount end,
             needed_by = case when $7 then $8::date else needed_by end,
             requester_name = case when $9 then $10 else requester_name end,
             department = case when $11 then $12 else department end,
             updated_at = now()
           where id = $1`,
          [id, b.title ?? null, set(b.detail), b.detail ?? null, set(b.amount), b.amount ?? null, set(b.neededBy), b.neededBy ?? null,
            set(b.requesterName), b.requesterName ?? null, set(b.department), b.department ?? null]);
        await history(c, r, a, 'edited');
        return loadRequest(c, id, a);
      });
    });

    /** Replace the approver chain of one request (draft / returned only). */
    app.put('/requests/:id/approvers', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ApproversInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const r = await loadRequest(c, id, a, true);
        requireOwner(r, a);
        if (r.lock_approvers && !isAdmin(a)) throw forbidden(`ประเภทคำขอ "${r.type_name}" กำหนดสายอนุมัติไว้แล้ว ผู้ขอเปลี่ยนผู้อนุมัติเองไม่ได้`);
        if (!['draft', 'returned'].includes(r.status)) throw conflict(`Cannot change approvers of a ${r.status} request`);
        await replaceSteps(c, id, b.approvers);
        await history(c, r, a, 'approvers_changed', b.approvers.map((x) => x.userName ?? x.userId).join(' → '));
        return loadRequest(c, id, a);
      });
    });

    app.post('/requests/:id/submit', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const r = await loadRequest(c, id, a, true);
        requireOwner(r, a);
        await submit(k, c, r, a);
        return loadRequest(c, id, a);
      });
    });

    app.post('/requests/:id/approve', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.approve');
      const { id } = parse(IdParam, req.params);
      const b = parse(OptionalNote, req.body ?? {});
      return k.db.tx(a.tenantId, (c) => decide(k, c, id, a, 'approved', b.note));
    });

    app.post('/requests/:id/reject', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.approve');
      const { id } = parse(IdParam, req.params);
      const b = parse(Note, req.body ?? {});
      return k.db.tx(a.tenantId, (c) => decide(k, c, id, a, 'rejected', b.note));
    });

    app.post('/requests/:id/return', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.approve');
      const { id } = parse(IdParam, req.params);
      const b = parse(Note, req.body ?? {});
      return k.db.tx(a.tenantId, (c) => decide(k, c, id, a, 'returned', b.note));
    });

    app.post('/requests/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(OptionalNote, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const r = await loadRequest(c, id, a, true);
        requireOwner(r, a);
        if (!['draft', 'pending', 'returned'].includes(r.status)) throw conflict(`Cannot cancel a ${r.status} request`);
        await c.query(`update requests set status = 'cancelled', current_step = 0, last_note = coalesce($2, last_note), updated_at = now() where id = $1`, [id, b.note ?? null]);
        await history(c, r, a, 'cancelled', b.note);
        return loadRequest(c, id, a);
      });
    });

    /** Anyone who can see the request may comment, at any status. */
    app.post('/requests/:id/comment', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.read');
      const { id } = parse(IdParam, req.params);
      const b = parse(Note, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const r = await loadRequest(c, id, a);
        await history(c, r, a, 'commented', b.note, r.current_step || null);
        return loadRequest(c, id, a);
      });
    });

    /* ----- delegation (ผู้รับมอบอำนาจ) ----- */

    const DELEG_SELECT = `select d.*, (${inForce('d')}) as active_now,
        case when d.cancelled_at is not null then 'cancelled' when d.ends_on < ${TODAY} then 'ended' when d.starts_on > ${TODAY} then 'scheduled' else 'active' end as status
      from delegations d`;
    const withFlags = (a: AuthContext) => (d: any) => ({ ...d, can_cancel: !d.cancelled_at && d.status !== 'ended' && (d.from_user_id === a.userId || isAdmin(a)) });

    /** Delegations I gave or received (approvals admins: all). `?status=active|scheduled|ended|cancelled`. */
    app.get('/delegations', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.read');
      const q = parse(z.object({ status: z.enum(['active', 'scheduled', 'ended', 'cancelled']).optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from (${DELEG_SELECT} where d.from_user_id = $1 or d.to_user_id = $1 or $2::boolean) x
         where ($3::text is null or x.status = $3) order by x.starts_on desc, x.created_at desc limit 200`,
        [a.userId, isAdmin(a), q.status ?? null])).rows.map(withFlags(a)));
    });

    /** Hand my approvals to someone else for a date range (e.g. while I am on leave). Admins may set it up for any approver. */
    app.post('/delegations', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.approve');
      const b = parse(DelegationInput, req.body);
      const fromId = b.fromUserId ?? a.userId;
      if (fromId !== a.userId && !isAdmin(a)) throw forbidden('มอบอำนาจแทนผู้อนุมัติคนอื่นได้เฉพาะผู้ดูแลงานอนุมัติ');
      if (b.toUserId === fromId) throw badRequest('มอบอำนาจให้ตนเองไม่ได้', { fieldErrors: { toUserId: ['เลือกผู้รับมอบอำนาจคนอื่น'] } });
      if (b.endsOn < b.startsOn) throw badRequest('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม', { fieldErrors: { endsOn: ['ต้องไม่ก่อนวันที่เริ่ม'] } });
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const today = (await c.query(`select to_char(${TODAY}, 'YYYY-MM-DD') as d`)).rows[0].d;
        if (b.endsOn < today) throw badRequest('ช่วงมอบอำนาจสิ้นสุดไปแล้ว', { fieldErrors: { endsOn: ['ต้องไม่ก่อนวันนี้'] } });
        const clash = (await c.query(
          `select to_user_name, starts_on, ends_on from delegations where from_user_id = $1 and cancelled_at is null and starts_on <= $3 and ends_on >= $2 limit 1`,
          [fromId, b.startsOn, b.endsOn])).rows[0];
        if (clash) throw conflict(`มีการมอบอำนาจให้ ${clash.to_user_name ?? 'ผู้อื่น'} ในช่วงวันที่นี้อยู่แล้ว — ยกเลิกรายการเดิมก่อน`);
        const fromName = fromId === a.userId ? (a.userName ?? b.fromUserName ?? null) : (b.fromUserName ?? null);
        const row = (await c.query(
          `insert into delegations (from_user_id, from_user_name, to_user_id, to_user_name, starts_on, ends_on, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [fromId, fromName, b.toUserId, b.toUserName ?? null, b.startsOn, b.endsOn, b.note ?? null, a.userId])).rows[0];
        return withFlags(a)((await c.query(`${DELEG_SELECT} where d.id = $1`, [row.id])).rows[0]);
      });
    });

    /** End a delegation early (the approver who gave it, or an admin). */
    app.post('/delegations/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'approvals.request.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const d = await one(c, `${DELEG_SELECT} where d.id = $1 and (d.from_user_id = $2 or d.to_user_id = $2 or $3::boolean)`, [id, a.userId, isAdmin(a)], 'Delegation');
        if (d.from_user_id !== a.userId && !isAdmin(a)) throw forbidden('ยกเลิกได้เฉพาะผู้มอบอำนาจหรือผู้ดูแลงานอนุมัติ');
        if (d.cancelled_at) throw conflict('รายการนี้ถูกยกเลิกแล้ว');
        await c.query('update delegations set cancelled_at = now() where id = $1', [id]);
        return withFlags(a)((await c.query(`${DELEG_SELECT} where d.id = $1`, [id])).rows[0]);
      });
    });
  },
};
