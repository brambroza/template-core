import { auth, badRequest, conflict, forbidden, hasPerm, loadManifest, nextDocNo, one, parse, requirePerm, s, z, type AuthContext, type Client, type Kernel, type ServiceDefinition } from '@erp/kernel';
import { bahtText, round } from '@erp/thai';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- input schemas ---------------- */

const text = (max: number) => z.string().trim().max(max);
const PayMethod = z.enum(['transfer', 'cash', 'cheque']);

const CategoryInput = z.object({
  code: s.code,
  name: s.name,
  monthlyLimit: s.money.nullable().optional(),
  requiresReceipt: z.boolean().default(false),
  note: text(500).optional(),
  active: z.boolean().default(true),
});
const CategoryUpdate = z.object({
  name: s.name.optional(),
  monthlyLimit: s.money.nullable().optional(),
  requiresReceipt: z.boolean().optional(),
  note: text(500).nullable().optional(),
  active: z.boolean().optional(),
});

const ClaimLine = z.object({
  expenseDate: s.isoDate,
  categoryId: s.uuid,
  description: text(500).optional(),
  amount: s.money,
  vat: s.money.default(0),
  receiptNo: text(100).optional(),
});
const ClaimLines = z.array(ClaimLine).min(1).max(100);
const ClaimInput = z.object({
  /** only used when the token carries no name: the claimant is always the logged-in user */
  claimantName: text(200).optional(),
  department: text(200).optional(),
  purpose: s.name,
  claimDate: s.isoDate.optional(),
  lines: ClaimLines,
  /** true = submit for approval straight away */
  submit: z.boolean().default(false),
});
const ClaimUpdate = z.object({
  claimantName: text(200).nullable().optional(),
  department: text(200).nullable().optional(),
  purpose: s.name.optional(),
  claimDate: s.isoDate.optional(),
});
const LinesInput = z.object({ lines: ClaimLines });
const Note = z.object({ note: text(2000).min(1) });
const OptionalNote = z.object({ note: text(2000).optional() }).default({});
const PayInput = z.object({ paidDate: s.isoDate.optional(), method: PayMethod, reference: text(200).optional() });

const AdvanceInput = z.object({
  requesterName: text(200).optional(),
  department: text(200).optional(),
  purpose: s.name,
  amount: z.number().finite().positive(),
  neededBy: s.isoDate.optional(),
});
const ClearInput = z.object({ claimId: s.uuid });

const IdParam = z.object({ id: s.uuid });
const flag = z.enum(['true', 'false', '1', '0']).optional().transform((v) => (v === undefined ? undefined : v === 'true' || v === '1'));
const month = z.string().regex(/^\d{4}-\d{2}$/, 'expected YYYY-MM');
const ListQuery = s.listQuery.extend({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  status: z.string().optional(),
  mine: flag,
  from: s.isoDate.optional(),
  to: s.isoDate.optional(),
});

/* ---------------- helpers ---------------- */

const STATUS_TH: Record<string, string> = {
  draft: 'ร่าง', submitted: 'รออนุมัติ', approved: 'อนุมัติแล้ว รอจ่าย', paid: 'จ่ายแล้ว', rejected: 'ไม่อนุมัติ', returned: 'ส่งกลับแก้ไข', cancelled: 'ยกเลิก',
  requested: 'ขอเบิก', cleared: 'เคลียร์แล้ว',
};
const METHOD_TH: Record<string, string> = { transfer: 'โอนเงิน', cash: 'เงินสด', cheque: 'เช็ค' };
/** Today in Thailand (Asia/Bangkok, UTC+7) as YYYY-MM-DD. */
const bangkokToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Approvers and payers see everybody's claims; everyone else only their own. */
const seesAll = (a: AuthContext) => hasPerm(a, 'expense.claim.approve') || hasPerm(a, 'expense.claim.pay');

function decorate(r: any) {
  r.status_label = STATUS_TH[r.status] ?? r.status;
  if (r.pay_method !== undefined) r.pay_method_label = r.pay_method ? METHOD_TH[r.pay_method] : null;
  return r;
}

async function loadClaim(c: Client, id: string, a: AuthContext, lock = false) {
  const cl = await one(c, `select * from claims where id = $1 and (claimant_id = $2 or $3::boolean) ${lock ? 'for update' : ''}`, [id, a.userId, seesAll(a)], 'Claim');
  cl.lines = (await c.query('select * from claim_lines where claim_id = $1 order by line_no', [id])).rows;
  cl.net_payable = round(cl.total - cl.advance_amount);
  cl.total_text = bahtText(cl.total);
  cl.is_mine = cl.claimant_id === a.userId;
  return decorate(cl);
}

/** Segregation of duties: nobody approves their own claim or advance. */
function refuseSelfApproval(owner: string, a: AuthContext, what: string) {
  if (owner === a.userId) throw forbidden(`อนุมัติ${what}ของตนเองไม่ได้ — ให้ผู้อนุมัติคนอื่นอนุมัติ`);
}

function requireOwner(row: { claimant_id?: string; requester_id?: string }, a: AuthContext) {
  const owner = row.claimant_id ?? row.requester_id;
  if (owner !== a.userId && !hasPerm(a, 'expense.claim.approve')) throw forbidden('Only the claimant (or an approver) can change this');
}

/** Write lines (category snapshot from this module's own table) and the claim totals. */
async function writeLines(c: Client, claimId: string, lines: z.infer<typeof ClaimLines>) {
  const ids = [...new Set(lines.map((l) => l.categoryId))];
  const cats = new Map((await c.query('select * from expense_categories where id = any($1::uuid[])', [ids])).rows.map((x) => [x.id, x]));
  await c.query('delete from claim_lines where claim_id = $1', [claimId]);
  let net = 0;
  let vat = 0;
  for (const [i, l] of lines.entries()) {
    const cat = cats.get(l.categoryId);
    if (!cat) throw badRequest(`Line ${i + 1}: unknown expense category`);
    if (!cat.active) throw badRequest(`Line ${i + 1}: category ${cat.code} is inactive`);
    if (l.expenseDate > bangkokToday()) {
      throw badRequest(`รายการที่ ${i + 1}: วันที่ใช้จ่าย ${l.expenseDate} อยู่ในอนาคต`, { fieldErrors: { expenseDate: ['วันที่ใช้จ่ายต้องไม่เกินวันนี้'] } });
    }
    const amount = round(l.amount);
    const v = round(l.vat);
    if (v > amount) throw badRequest(`รายการที่ ${i + 1}: VAT (${fmt(v)}) มากกว่าจำนวนเงิน (${fmt(amount)})`, { fieldErrors: { vat: ['VAT ต้องไม่มากกว่าจำนวนเงิน'] } });
    net += amount;
    vat += v;
    await c.query(
      `insert into claim_lines (claim_id, line_no, expense_date, category_id, category_code, category_name, receipt_required, description, amount, vat, total, receipt_no)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [claimId, i + 1, l.expenseDate, cat.id, cat.code, cat.name, cat.requires_receipt, l.description ?? null, amount, v, round(amount + v), l.receiptNo || null],
    );
  }
  await c.query('update claims set net = $2, vat = $3, total = $4, updated_at = now() where id = $1', [claimId, round(net), round(vat), round(net + vat)]);
}

/**
 * Monthly limits never block a claim: they produce warnings (stored on the claim, returned to the caller).
 * Usage = this claimant's lines in that category and calendar month on every live claim (incl. this one).
 */
async function refreshWarnings(c: Client, claimId: string) {
  const claim = (await c.query('select claimant_id from claims where id = $1', [claimId])).rows[0];
  const over = (await c.query(
    `with here as (select distinct category_id, date_trunc('month', expense_date) as m from claim_lines where claim_id = $1)
     select cat.code, cat.name, cat.monthly_limit, to_char(here.m, 'YYYY-MM') as month, sum(l.total) as used
     from here
     join expense_categories cat on cat.id = here.category_id and cat.monthly_limit is not null
     join claim_lines l on l.category_id = here.category_id and date_trunc('month', l.expense_date) = here.m
     join claims cl on cl.id = l.claim_id and cl.claimant_id = $2 and cl.status not in ('rejected', 'cancelled')
     group by cat.code, cat.name, cat.monthly_limit, here.m
     having sum(l.total) > cat.monthly_limit
     order by cat.code, here.m`, [claimId, claim.claimant_id])).rows;
  const missing = (await c.query(
    `select line_no, category_name from claim_lines where claim_id = $1 and receipt_required and coalesce(receipt_no, '') = '' order by line_no`, [claimId])).rows;
  const warnings = [
    ...over.map((o) => ({
      kind: 'limit', categoryCode: o.code, month: o.month, limit: o.monthly_limit, used: o.used,
      message: `${o.name} เดือน ${o.month} รวม ${fmt(o.used)} บาท เกินวงเงิน ${fmt(o.monthly_limit)} บาท/คน/เดือน`,
    })),
    ...missing.map((m) => ({ kind: 'receipt', lineNo: m.line_no, message: `รายการที่ ${m.line_no} (${m.category_name}) ต้องแนบเลขที่ใบเสร็จ` })),
  ];
  await c.query('update claims set warnings = $2, over_limit = $3 where id = $1', [claimId, JSON.stringify(warnings), over.length > 0]);
}

async function submitClaim(k: Kernel, c: Client, id: string, a: AuthContext) {
  const cl = await loadClaim(c, id, a, true);
  requireOwner(cl, a);
  if (!['draft', 'returned'].includes(cl.status)) throw conflict(`Cannot submit a ${cl.status} claim`);
  const missing = cl.lines.filter((l: any) => l.receipt_required && !l.receipt_no);
  if (missing.length) throw badRequest(`Receipt number required on line(s) ${missing.map((l: any) => l.line_no).join(', ')}`);
  if (!(Number(cl.total) > 0)) throw badRequest('ยอดเบิกรวมเป็น 0 บาท ส่งขออนุมัติไม่ได้', { fieldErrors: { lines: ['กรอกจำนวนเงินอย่างน้อยหนึ่งรายการ'] } });
  await c.query(`update claims set status = 'submitted', submitted_at = now(), updated_at = now() where id = $1`, [id]);
  await refreshWarnings(c, id);
  const row = (await c.query('select id, no, claimant_id, claimant_name, total, over_limit from claims where id = $1', [id])).rows[0];
  await k.emit(c, 'expense.claim_submitted', { claimId: row.id, no: row.no, claimantName: row.claimant_name ?? null, total: row.total, overLimit: row.over_limit, claimantId: row.claimant_id });
}

async function loadAdvance(c: Client, id: string, a: AuthContext, lock = false) {
  const adv = await one(c, `select * from advances where id = $1 and (requester_id = $2 or $3::boolean) ${lock ? 'for update' : ''}`, [id, a.userId, seesAll(a)], 'Advance');
  adv.settle_text = adv.settle_amount === null ? null
    : adv.settle_amount > 0 ? `บริษัทจ่ายเพิ่มให้พนักงาน ${fmt(adv.settle_amount)} บาท`
      : adv.settle_amount < 0 ? `พนักงานคืนเงินบริษัท ${fmt(-adv.settle_amount)} บาท` : 'ใช้พอดีกับเงินทดรอง';
  adv.amount_text = bahtText(adv.amount);
  return decorate(adv);
}

/* ---------------- routes ---------------- */

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  // receipts and other evidence on claims and advances; visibility follows the claim's own rule (staff: own records only)
  attachments: {
    read: 'expense.claim.read',
    write: 'expense.claim.write',
    entities: {
      claim: { table: 'claims', access: (c, a, id) => loadClaim(c, id, a) },
      advance: { table: 'advances', access: (c, a, id) => loadAdvance(c, id, a) },
    },
  },
  routes(app, k) {
    /* ----- categories ----- */

    app.get('/categories', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      const q = parse(s.listQuery.extend({ limit: z.coerce.number().int().min(1).max(500).default(200), active: flag }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from expense_categories where ($1::boolean is null or active = $1) and ($2::text is null or code ilike $2 or name ilike $2)
         order by code limit $3 offset $4`, [q.active ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    app.get('/categories/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const cat = await one(c, 'select * from expense_categories where id = $1', [id], 'Category');
        cat.used_this_month = (await c.query(
          `select coalesce(sum(l.total), 0) as v from claim_lines l join claims cl on cl.id = l.claim_id
           where l.category_id = $1 and cl.status in ('submitted', 'approved', 'paid') and date_trunc('month', l.expense_date) = date_trunc('month', current_date)
             and (cl.claimant_id = $2 or $3::boolean)`, [id, a.userId, seesAll(a)])).rows[0].v; // staff: only their own spend
        return cat;
      });
    });

    app.post('/categories', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'expense.category.write');
      const b = parse(CategoryInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `insert into expense_categories (code, name, monthly_limit, requires_receipt, note, active) values ($1,$2,$3,$4,$5,$6) returning *`,
        [b.code, b.name, b.monthlyLimit ?? null, b.requiresReceipt, b.note ?? null, b.active])).rows[0]);
    });

    app.put('/categories/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.category.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(CategoryUpdate, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from expense_categories where id = $1', [id], 'Category');
        return (await c.query(
          `update expense_categories set name = coalesce($2, name),
             monthly_limit = case when $3 then $4::numeric else monthly_limit end,
             requires_receipt = coalesce($5, requires_receipt),
             note = case when $6 then $7 else note end,
             active = coalesce($8, active), updated_at = now()
           where id = $1 returning *`,
          [id, b.name ?? null, b.monthlyLimit !== undefined, b.monthlyLimit ?? null, b.requiresReceipt ?? null, b.note !== undefined, b.note ?? null, b.active ?? null])).rows[0];
      });
    });

    /* ----- claims ----- */

    app.post('/claims', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.write');
      const b = parse(ClaimInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const no = await nextDocNo(c, 'EXP', b.claimDate ? new Date(b.claimDate) : new Date());
        const row = (await c.query(
          `insert into claims (no, claimant_id, claimant_name, department, purpose, claim_date, created_by)
           values ($1,$2,$3,$4,$5,coalesce($6::date, current_date),$2) returning id`,
          [no, a.userId, a.userName ?? b.claimantName ?? null, b.department ?? null, b.purpose, b.claimDate ?? null])).rows[0];
        await writeLines(c, row.id, b.lines);
        if (b.submit) await submitClaim(k, c, row.id, a);
        else await refreshWarnings(c, row.id);
        return loadClaim(c, row.id, a);
      });
    });

    const listClaims = (forceMine: boolean) => async (req: any) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      const q = parse(ListQuery, req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from claims
         where (claimant_id = $1 or $2::boolean) and ($3::boolean = false or claimant_id = $1)
           and ($4::text is null or status = $4)
           and ($5::text is null or no ilike $5 or purpose ilike $5 or claimant_name ilike $5 or department ilike $5)
           and ($6::date is null or claim_date >= $6) and ($7::date is null or claim_date <= $7)
         order by created_at desc limit $8 offset $9`,
        [a.userId, seesAll(a), forceMine || q.mine === true, q.status ?? null, q.q ? `%${q.q}%` : null, q.from ?? null, q.to ?? null, q.limit, q.offset])).rows.map(decorate));
    };
    /** Approvers / payers see every claim, others their own. `?mine=1` = only mine. */
    app.get('/claims', listClaims(false));
    app.get('/my-claims', listClaims(true));

    app.get('/claims/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadClaim(c, id, a));
    });

    app.put('/claims/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ClaimUpdate, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const cl = await loadClaim(c, id, a, true);
        requireOwner(cl, a);
        if (!['draft', 'returned'].includes(cl.status)) throw conflict(`Cannot edit a ${cl.status} claim`);
        // the claimant's own name comes from the token; a typed name only counts for someone fixing another person's claim
        if (cl.claimant_id === a.userId && a.userName) b.claimantName = a.userName;
        await c.query(
          `update claims set purpose = coalesce($2, purpose), claim_date = coalesce($3::date, claim_date),
             claimant_name = case when $4 then $5 else claimant_name end,
             department = case when $6 then $7 else department end, updated_at = now()
           where id = $1`,
          [id, b.purpose ?? null, b.claimDate ?? null, b.claimantName !== undefined, b.claimantName ?? null, b.department !== undefined, b.department ?? null]);
        return loadClaim(c, id, a);
      });
    });

    /** Replace all lines (draft / returned). */
    app.put('/claims/:id/lines', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(LinesInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const cl = await loadClaim(c, id, a, true);
        requireOwner(cl, a);
        if (!['draft', 'returned'].includes(cl.status)) throw conflict(`Cannot change lines of a ${cl.status} claim`);
        await writeLines(c, id, b.lines);
        await refreshWarnings(c, id);
        return loadClaim(c, id, a);
      });
    });

    app.post('/claims/:id/submit', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        await submitClaim(k, c, id, a);
        return loadClaim(c, id, a);
      });
    });

    app.post('/claims/:id/approve', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.approve');
      const { id } = parse(IdParam, req.params);
      const b = parse(OptionalNote, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const cl = await loadClaim(c, id, a, true);
        if (cl.status !== 'submitted') throw conflict(`Cannot approve a ${cl.status} claim`);
        refuseSelfApproval(cl.claimant_id, a, 'ใบเบิก');
        await c.query(`update claims set status = 'approved', approved_by = $2, approved_by_name = $4, approved_at = now(), last_note = coalesce($3, last_note), updated_at = now() where id = $1`, [id, a.userId, b.note ?? null, a.userName ?? null]);
        return loadClaim(c, id, a);
      });
    });

    for (const [path, status] of [['reject', 'rejected'], ['return', 'returned']] as const) {
      app.post(`/claims/:id/${path}`, async (req) => {
        const a = auth(req);
        requirePerm(a, 'expense.claim.approve');
        const { id } = parse(IdParam, req.params);
        const b = parse(Note, req.body ?? {});
        return k.db.tx(a.tenantId, async (c) => {
          const cl = await loadClaim(c, id, a, true);
          if (cl.status !== 'submitted') throw conflict(`Cannot ${path} a ${cl.status} claim`);
          await c.query(`update claims set status = $2, last_note = $3, rejected_at = case when $2 = 'rejected' then now() else rejected_at end, updated_at = now() where id = $1`, [id, status, b.note]);
          if (status === 'rejected') await refreshWarnings(c, id);
          return loadClaim(c, id, a);
        });
      });
    }

    app.post('/claims/:id/pay', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.pay');
      const { id } = parse(IdParam, req.params);
      const b = parse(PayInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const cl = await loadClaim(c, id, a, true);
        if (cl.status !== 'approved') throw conflict(`Cannot pay a ${cl.status} claim`);
        await c.query(
          `update claims set status = 'paid', paid_date = coalesce($2::date, current_date), pay_method = $3, pay_reference = $4, paid_by = $5, paid_by_name = $6, updated_at = now() where id = $1`,
          [id, b.paidDate ?? null, b.method, b.reference ?? null, a.userId, a.userName ?? null]);
        await k.emit(c, 'expense.claim_paid', { claimId: cl.id, no: cl.no, claimantName: cl.claimant_name ?? null, total: cl.total, claimantId: cl.claimant_id });
        return loadClaim(c, id, a);
      });
    });

    app.post('/claims/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(OptionalNote, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const cl = await loadClaim(c, id, a, true);
        requireOwner(cl, a);
        if (!['draft', 'returned'].includes(cl.status)) throw conflict(`Cannot cancel a ${cl.status} claim`);
        await c.query(`update claims set status = 'cancelled', last_note = coalesce($2, last_note), updated_at = now() where id = $1`, [id, b.note ?? null]);
        await refreshWarnings(c, id);
        return loadClaim(c, id, a);
      });
    });

    /* ----- cash advances (เงินทดรองจ่าย) ----- */

    app.post('/advances', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.write');
      const b = parse(AdvanceInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const no = await nextDocNo(c, 'ADV');
        const row = (await c.query(
          `insert into advances (no, requester_id, requester_name, department, purpose, amount, needed_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
          [no, a.userId, a.userName ?? b.requesterName ?? null, b.department ?? null, b.purpose, round(b.amount), b.neededBy ?? null])).rows[0];
        return loadAdvance(c, row.id, a);
      });
    });

    app.get('/advances', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      const q = parse(ListQuery, req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from advances
         where (requester_id = $1 or $2::boolean) and ($3::boolean = false or requester_id = $1)
           and ($4::text is null or status = $4)
           and ($5::text is null or no ilike $5 or purpose ilike $5 or requester_name ilike $5)
         order by created_at desc limit $6 offset $7`,
        [a.userId, seesAll(a), q.mine === true, q.status ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows.map(decorate));
    });

    app.get('/advances/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadAdvance(c, id, a));
    });

    app.post('/advances/:id/approve', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.approve');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const adv = await loadAdvance(c, id, a, true);
        if (adv.status !== 'requested') throw conflict(`Cannot approve a ${adv.status} advance`);
        refuseSelfApproval(adv.requester_id, a, 'เงินทดรองจ่าย');
        await c.query(`update advances set status = 'approved', approved_by = $2, approved_by_name = $3, approved_at = now(), updated_at = now() where id = $1`, [id, a.userId, a.userName ?? null]);
        return loadAdvance(c, id, a);
      });
    });

    app.post('/advances/:id/reject', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.approve');
      const { id } = parse(IdParam, req.params);
      const b = parse(Note, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const adv = await loadAdvance(c, id, a, true);
        if (adv.status !== 'requested') throw conflict(`Cannot reject a ${adv.status} advance`);
        await c.query(`update advances set status = 'rejected', last_note = $2, updated_at = now() where id = $1`, [id, b.note]);
        return loadAdvance(c, id, a);
      });
    });

    app.post('/advances/:id/pay', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.pay');
      const { id } = parse(IdParam, req.params);
      const b = parse(PayInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const adv = await loadAdvance(c, id, a, true);
        if (adv.status !== 'approved') throw conflict(`Cannot pay a ${adv.status} advance`);
        await c.query(`update advances set status = 'paid', paid_date = coalesce($2::date, current_date), pay_method = $3, pay_reference = $4, paid_by = $5, paid_by_name = $6, updated_at = now() where id = $1`,
          [id, b.paidDate ?? null, b.method, b.reference ?? null, a.userId, a.userName ?? null]);
        return loadAdvance(c, id, a);
      });
    });

    app.post('/advances/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const adv = await loadAdvance(c, id, a, true);
        requireOwner(adv, a);
        if (!['requested', 'approved'].includes(adv.status)) throw conflict(`Cannot cancel a ${adv.status} advance`);
        await c.query(`update advances set status = 'cancelled', updated_at = now() where id = $1`, [id]);
        return loadAdvance(c, id, a);
      });
    });

    /**
     * Clear a paid advance against the employee's approved, not yet paid claim (its net payable becomes total − advance).
     * settle = claim total - advance: > 0 the company still owes the employee, < 0 the employee returns cash.
     */
    app.post('/advances/:id/clear', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.pay');
      const { id } = parse(IdParam, req.params);
      const b = parse(ClearInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const adv = await loadAdvance(c, id, a, true);
        if (adv.status !== 'paid') throw conflict(`Cannot clear a ${adv.status} advance`);
        const cl = await loadClaim(c, b.claimId, a, true);
        if (cl.claimant_id !== adv.requester_id) throw conflict(`Claim ${cl.no} belongs to another employee`);
        // a claim that was already paid in full cannot absorb the advance any more (the employee would keep the advance)
        if (cl.status === 'paid') throw conflict(`ใบเบิก ${cl.no} จ่ายเงินเต็มจำนวนไปแล้ว — เคลียร์เงินทดรองได้เฉพาะใบเบิกที่อนุมัติแล้วและยังไม่จ่าย (พนักงานต้องคืนเงินทดรอง ${fmt(adv.amount)} บาท)`);
        if (cl.status !== 'approved') throw conflict(`Claim ${cl.no} is ${cl.status}; only approved claims can clear an advance`);
        if (cl.advance_id) throw conflict(`Claim ${cl.no} already clears advance ${cl.advance_no}`);
        const settle = round(cl.total - adv.amount);
        await c.query(`update advances set status = 'cleared', claim_id = $2, claim_no = $3, claim_total = $4, settle_amount = $5, cleared_at = now(), updated_at = now() where id = $1`,
          [id, cl.id, cl.no, cl.total, settle]);
        await c.query('update claims set advance_id = $2, advance_no = $3, advance_amount = $4, updated_at = now() where id = $1', [cl.id, adv.id, adv.no, adv.amount]);
        return loadAdvance(c, id, a);
      });
    });

    /* ----- reports ----- */

    /** Spend per category in one month (default: this month) — submitted, approved and paid claims. */
    app.get('/reports/by-category', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      const q = parse(z.object({ month: month.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select cat.id, cat.code, cat.name, cat.monthly_limit, cat.active, coalesce(x.total, 0) as total, coalesce(x.claims, 0) as claims, coalesce(x.people, 0) as people
         from expense_categories cat
         left join (
           select l.category_id, sum(l.total) as total, count(distinct cl.id)::int as claims, count(distinct cl.claimant_id)::int as people
           from claim_lines l join claims cl on cl.id = l.claim_id
           where cl.status in ('submitted', 'approved', 'paid') and (cl.claimant_id = $2 or $3::boolean)
             and date_trunc('month', l.expense_date) = coalesce(to_date($1, 'YYYY-MM'), date_trunc('month', current_date))
           group by l.category_id
         ) x on x.category_id = cat.id
         where cat.active or x.total is not null
         order by total desc, cat.code`, [q.month ?? null, a.userId, seesAll(a)])).rows);
    });

    /** What finance still owes: approved claims not yet paid, advances paid out but not cleared. */
    app.get('/reports/outstanding', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      return k.db.tx(a.tenantId, async (c) => {
        const items = (await c.query(
          `select *, total - advance_amount as net_payable, (current_date - approved_at::date) as days_waiting from claims
           where status = 'approved' and (claimant_id = $1 or $2::boolean) order by approved_at`, [a.userId, seesAll(a)])).rows.map(decorate);
        const advances = (await c.query(
          `select *, (current_date - paid_date) as days_open from advances where status = 'paid' and (requester_id = $1 or $2::boolean) order by paid_date`,
          [a.userId, seesAll(a)])).rows.map(decorate);
        return {
          items, advances,
          toPayTotal: round(items.reduce((t, x) => t + Number(x.net_payable), 0)),
          advanceTotal: round(advances.reduce((t, x) => t + Number(x.amount), 0)),
        };
      });
    });

    /** Dashboard: work queues, money this month, spend per category, 6-month trend, recent claims. */
    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      const p = [a.userId, seesAll(a)];
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select count(*) filter (where status = 'submitted')::int as to_approve,
                  count(*) filter (where status = 'submitted' and over_limit)::int as over_limit,
                  count(*) filter (where status = 'approved')::int as to_pay,
                  coalesce(sum(total - advance_amount) filter (where status = 'approved'), 0) as to_pay_amount,
                  coalesce(sum(total) filter (where status = 'paid' and date_trunc('month', paid_date) = date_trunc('month', current_date)), 0) as paid_month,
                  coalesce(sum(total) filter (where status in ('submitted', 'approved', 'paid') and date_trunc('month', claim_date) = date_trunc('month', current_date)), 0) as claimed_month,
                  count(*) filter (where status in ('draft', 'returned') and claimant_id = $1)::int as my_open
           from claims where (claimant_id = $1 or $2::boolean)`, p)).rows[0];
        const adv = (await c.query(
          `select count(*) filter (where status = 'requested')::int as to_approve, coalesce(sum(amount) filter (where status = 'paid'), 0) as outstanding
           from advances where (requester_id = $1 or $2::boolean)`, p)).rows[0];
        const byCategory = (await c.query(
          `select l.category_code as code, l.category_name as name, sum(l.total) as total, max(cat.monthly_limit) as monthly_limit
           from claim_lines l join claims cl on cl.id = l.claim_id join expense_categories cat on cat.id = l.category_id
           where cl.status in ('submitted', 'approved', 'paid') and date_trunc('month', l.expense_date) = date_trunc('month', current_date) and (cl.claimant_id = $1 or $2::boolean)
           group by l.category_code, l.category_name order by total desc`, p)).rows;
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month, coalesce(sum(cl.total), 0) as total, count(cl.id)::int as claims
           from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m
           left join claims cl on date_trunc('month', cl.claim_date) = m and cl.status in ('submitted', 'approved', 'paid') and (cl.claimant_id = $1 or $2::boolean)
           group by m order by m`, p)).rows;
        const rows = (await c.query(
          `select id, no, purpose, claimant_name, total, status, over_limit from claims
           where status in ('submitted', 'returned', 'approved', 'paid') and (claimant_id = $1 or $2::boolean) order by updated_at desc limit 30`, p)).rows;
        return {
          toApprove: n.to_approve, overLimit: n.over_limit, toPay: n.to_pay, toPayAmount: n.to_pay_amount,
          paidThisMonth: n.paid_month, claimedThisMonth: n.claimed_month, myOpen: n.my_open,
          advancesToApprove: adv.to_approve, advancesOutstanding: adv.outstanding,
          byCategory, months, rows,
        };
      });
    });
  },
};
