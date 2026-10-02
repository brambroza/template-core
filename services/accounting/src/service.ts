import { addDaysIso, auth, badRequest, conflict, loadManifest, one, parse, periodLastDate, requirePerm, s, z, type Client, type HandlerContext, type ServiceDefinition } from '@erp/kernel';
import { formatThaiDate } from '@erp/thai';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, CATEGORY_TH, EVENT_TH, ROLE_TH, ROLES, TYPE_CATEGORIES, TYPE_TH, TYPES, type AccountType, type PostedEvent } from './chart.ts';
import { checkLines, createJournal, EFFECTIVE, ensureChart, assertPeriodOpen, periodTh, postEvent, seedChart, todayTh, writeLines } from './ledger.ts';
import { balanceSheet, debitNormal, generalLedger, profitLoss, trialBalance, vatLines, vatReport, whtReceived } from './reports.ts';
import { computePp30, pp30Csv, pp30Year, recordFiling, whtPayable } from './tax.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- input schemas ---------------- */

const text = (max: number) => z.string().trim().max(max);
const amount = z.number().finite().min(0).nullish();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'รูปแบบเดือนต้องเป็น YYYY-MM');
const year = z.string().regex(/^\d{4}$/, 'รูปแบบปีต้องเป็น YYYY (ค.ศ.)');
const flag = z.enum(['true', 'false', '1', '0']).optional().transform((v) => (v === undefined ? undefined : v === 'true' || v === '1'));

const AccountInput = z.object({
  code: z.string().trim().regex(/^[0-9A-Za-z.-]{1,20}$/, 'รหัสบัญชีใช้ตัวเลข/ตัวอักษร ไม่เกิน 20 ตัว'),
  name: s.name,
  nameEn: text(200).optional(),
  type: z.enum(TYPES as [AccountType, ...AccountType[]]),
  category: z.enum(CATEGORIES as [string, ...string[]]).optional(),
  parentId: s.uuid.nullish(),
  isGroup: z.boolean().default(false),
  role: z.enum(ROLES).nullish(),
  active: z.boolean().default(true),
  note: text(500).optional(),
});
const AccountUpdate = z.object({
  code: AccountInput.shape.code.optional(),
  name: s.name.optional(),
  nameEn: text(200).nullish(),
  type: AccountInput.shape.type.optional(),
  category: AccountInput.shape.category,
  parentId: s.uuid.nullish(),
  isGroup: z.boolean().optional(),
  role: z.enum(ROLES).nullish(),
  active: z.boolean().optional(),
  note: text(500).nullish(),
});

const Line = z.object({
  accountId: s.uuid,
  debit: amount,
  credit: amount,
  description: text(500).nullish(),
  partnerId: s.uuid.nullish(),
  partnerName: text(200).nullish(),
  taxBase: amount,
});
const Lines = z.array(Line).min(2, 'สมุดรายวันต้องมีอย่างน้อย 2 บรรทัด').max(500);
const JournalInput = z.object({
  entryDate: s.isoDate.optional(),
  description: text(500).min(1),
  ref: text(100).optional(),
  note: text(2000).optional(),
  lines: Lines,
  /** true = post straight away (period must be open) */
  post: z.boolean().default(false),
});
const JournalUpdate = z.object({ entryDate: s.isoDate.optional(), description: text(500).min(1).optional(), ref: text(100).nullish(), note: text(2000).nullish() });
const ReverseInput = z.object({ entryDate: s.isoDate.optional(), reason: text(500).optional() }).default({});
const RuleUpdate = z.object({ accountId: s.uuid.nullable() });
const MappingInput = z.object({
  categoryCode: z.string().trim().min(1, 'ระบุรหัสหมวดค่าใช้จ่าย').max(50),
  categoryName: text(200).nullish(),
  accountId: s.uuid,
  note: text(500).nullish(),
});
const MappingUpdate = MappingInput.partial();
const NoteInput = z.object({ note: text(500).optional() }).default({});

const IdParam = z.object({ id: s.uuid });
const money2 = z.number().finite().min(0).max(1e13);
/** query-string amounts for the ภ.พ.30 preview (boxes 2, 3, 13, 14) */
const qMoney = z.coerce.number().finite().min(0).max(1e13).optional();
const Pp30Query = z.object({ zeroRated: qMoney, exempt: qMoney, surcharge: qMoney, penalty: qMoney, filedDate: s.isoDate.optional(), channel: z.enum(['efiling', 'paper']).optional() });
const Pp30File = z.object({
  filedDate: s.isoDate,
  channel: z.enum(['efiling', 'paper']),
  receiptNo: text(100).optional(),
  refundOrCarry: z.enum(['carry', 'refund']).default('carry'),
  paidAmount: money2.default(0),
  zeroRated: money2.optional(), exempt: money2.optional(), surcharge: money2.optional(), penalty: money2.optional(),
  amend: z.boolean().default(false),
  reason: text(500).optional(),
});
const BillQuery = s.listQuery.extend({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  kind: z.enum(['goods', 'service', 'expense']).optional(), treatment: z.enum(['posted', 'matched', 'vat_reclassed']).optional(),
  from: s.isoDate.optional(), to: s.isoDate.optional(),
});
const TREATMENT_TH: Record<string, string> = { posted: 'ลงบัญชีค่าใช้จ่าย/บริการ', matched: 'จับคู่กับการรับสินค้า (ไม่ลงซ้ำ)', vat_reclassed: 'ปรับภาษีซื้อของสินค้าที่รับแล้ว' };
const BILL_KIND_TH: Record<string, string> = { goods: 'สินค้า', service: 'บริการ', expense: 'ค่าใช้จ่าย' };
const PeriodParam = z.object({ period: month });

const AccountQuery = z.object({
  q: z.string().optional(), type: z.string().optional(), category: z.string().optional(), role: z.string().optional(),
  active: flag, postable: flag, groups: flag, limit: z.coerce.number().int().min(1).max(1000).default(500),
});
const JournalQuery = s.listQuery.extend({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  status: z.string().optional(), source: z.string().optional(), accountId: s.uuid.optional(),
  from: s.isoDate.optional(), to: s.isoDate.optional(),
});

/* ---------------- helpers ---------------- */

const STATUS_TH: Record<string, string> = { draft: 'ร่าง', posted: 'ผ่านรายการแล้ว', reversed: 'กลับรายการแล้ว', cancelled: 'ยกเลิก' };
const SIDE_TH: Record<string, string> = { debit: 'เดบิต', credit: 'เครดิต', both: 'เดบิต/เครดิต' };
const ERROR_TH: Record<string, string> = { open: 'รอแก้ไข', resolved: 'ลงบัญชีแล้ว', dismissed: 'ไม่ลงบัญชี' };
const byOf = (a: { userId: string; userName?: string }) => ({ id: a.userId, name: a.userName ?? null });

const decorateAccount = (a: any) => ({
  ...a, type_label: TYPE_TH[a.type as AccountType], category_label: CATEGORY_TH[a.category as keyof typeof CATEGORY_TH],
  role_label: a.role ? ROLE_TH[a.role as keyof typeof ROLE_TH] ?? a.role : null, label: `${a.code} ${a.name}`,
});

async function journalDetail(c: Client, id: string) {
  const j = await one(c,
    `select j.*, r.no as reversal_of_no, b.no as reversed_by_no from journal_entries j
     left join journal_entries r on r.id = j.reversal_of left join journal_entries b on b.id = j.reversed_by where j.id = $1`, [id], 'Journal');
  const lines = (await c.query(
    `select l.*, a.code as account_code, a.name as account_name from journal_lines l join accounts a on a.id = l.account_id
     where l.journal_id = $1 order by l.line_no`, [id])).rows;
  return {
    ...j, status_label: STATUS_TH[j.status], source_label: EVENT_TH[j.source_type] ?? j.source_type,
    entry_date_th: formatThaiDate(j.entry_date), period: String(j.entry_date).slice(0, 7), lines,
    // form prefill names
    entryDate: j.entry_date,
  };
}

async function accountUsage(c: Client, id: string) {
  const r = await c.query(
    `select (select count(*) from journal_lines where account_id = $1)::int as lines,
            (select count(*) from accounts where parent_id = $1)::int as children,
            ((select count(*) from posting_rules where account_id = $1) + (select count(*) from category_mappings where account_id = $1))::int as rules`, [id]);
  return r.rows[0] as { lines: number; children: number; rules: number };
}

/** parent must be a group of the same type, and not the account itself or one of its descendants */
async function checkParent(c: Client, parentId: string | null | undefined, type: string, selfId?: string) {
  if (!parentId) return null;
  const p = (await c.query('select id, type, is_group, category from accounts where id = $1', [parentId])).rows[0];
  if (!p) throw badRequest('ไม่พบบัญชีคุม (parent)');
  if (!p.is_group) throw badRequest('บัญชีคุมต้องเป็นบัญชีประเภทหัวข้อ (กลุ่ม)');
  if (p.type !== type) throw badRequest(`บัญชีคุมเป็นหมวด${TYPE_TH[p.type as AccountType]} ไม่ตรงกับหมวดของบัญชีนี้ (${TYPE_TH[type as AccountType]})`);
  if (selfId) {
    const loop = await c.query(
      `with recursive up as (select id, parent_id from accounts where id = $1 union all select a.id, a.parent_id from accounts a join up on a.id = up.parent_id)
       select 1 from up where id = $2`, [parentId, selfId]);
    if (loop.rowCount) throw badRequest('ตั้งบัญชีคุมวนกลับมาที่ตัวเองไม่ได้');
  }
  return p;
}

function categoryFor(type: AccountType, category: string | undefined, parentCategory?: string): string {
  const allowed = TYPE_CATEGORIES[type] as string[];
  const cat = category ?? (parentCategory && allowed.includes(parentCategory) ? parentCategory : allowed[0]);
  if (!allowed.includes(cat)) throw badRequest(`หมวดงบการเงิน "${CATEGORY_TH[cat as keyof typeof CATEGORY_TH] ?? cat}" ใช้กับบัญชีหมวด${TYPE_TH[type]}ไม่ได้`);
  return cat;
}

/** a mapping's account must exist, be active and postable (not a group) */
async function checkMappingAccount(c: Client, accountId: string) {
  const acc = (await c.query('select code, name, active, is_group from accounts where id = $1', [accountId])).rows[0];
  if (!acc) throw badRequest('ไม่พบบัญชี', { fieldErrors: { accountId: ['ไม่พบบัญชี'] } });
  if (acc.is_group) throw badRequest(`บัญชี ${acc.code} เป็นบัญชีคุม เลือกบัญชีย่อย`, { fieldErrors: { accountId: ['เลือกบัญชีย่อย'] } });
  if (!acc.active) throw badRequest(`บัญชี ${acc.code} ปิดการใช้งานอยู่`, { fieldErrors: { accountId: ['บัญชีปิดการใช้งาน'] } });
}

const MAPPING_SELECT = `select m.*, a.code as account_code, a.name as account_name, a.code || ' ' || a.name as account_label,
    m.category_code || coalesce(' ' || m.category_name, '') as label
  from category_mappings m join accounts a on a.id = m.account_id`;
const decorateMapping = (m: any) => m && ({ ...m, categoryCode: m.category_code, categoryName: m.category_name, accountId: m.account_id });

/** event handler: post, never throw for business reasons (recorded in posting_errors instead) */
const autoPost = <T extends PostedEvent>(type: T) => async (data: unknown, ctx: HandlerContext) => {
  await postEvent(ctx.client, type, data, { eventId: ctx.event.id, occurredAt: ctx.event.occurredAt });
};

/* ---------------- service ---------------- */

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    /* ---------- chart of accounts ---------- */

    app.post('/accounts/setup', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.account.write');
      return k.db.tx(a.tenantId, async (c) => {
        const r = await seedChart(c);
        const total = (await c.query('select count(*)::int as n from accounts')).rows[0].n;
        return { ...r, total, message: r.accounts || r.rules || r.mappings ? `เพิ่มผังบัญชีมาตรฐาน ${r.accounts} บัญชี กฎลงบัญชี ${r.rules} รายการ และจับคู่หมวดค่าใช้จ่าย ${r.mappings} หมวด` : 'ผังบัญชีมาตรฐานครบแล้ว' };
      });
    });

    app.get('/accounts', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.read');
      const q = parse(AccountQuery, req.query);
      return k.db.tx(a.tenantId, async (c) => {
        await ensureChart(c);
        // `level` = depth in the group hierarchy (0 = top group) — the chart screen indents the names by it
        const rows = (await c.query(
          `with recursive tree as (
             select id, 0 as level from accounts where parent_id is null
             union all select x.id, t.level + 1 from accounts x join tree t on x.parent_id = t.id where t.level < 10)
           select a.*, p.code as parent_code, p.name as parent_name, coalesce(tr.level, 0)::int as level,
             case when a.is_group then 'group' else 'account' end as row_kind,
             coalesce((select sum(l.debit - l.credit) from journal_lines l join journal_entries j on j.id = l.journal_id
                       where l.account_id = a.id and j.status in ${EFFECTIVE}), 0) as dr_balance,
             (select count(*) from journal_lines l where l.account_id = a.id)::int as line_count
           from accounts a left join accounts p on p.id = a.parent_id left join tree tr on tr.id = a.id
           where ($1::text is null or a.code ilike $1 || '%' or a.name ilike '%' || $1 || '%' or a.name_en ilike '%' || $1 || '%')
             and ($2::text is null or a.type = $2) and ($3::text is null or a.category = $3) and ($4::text is null or a.role = $4)
             and ($5::boolean is null or a.active = $5) and ($6::boolean is not true or not a.is_group) and ($8::boolean is not true or a.is_group)
           order by a.code limit $7`,
          [q.q?.trim() || null, q.type || null, q.category || null, q.role || null, q.active ?? null, q.postable ?? null, q.limit, q.groups ?? null])).rows;
        return rows.map((x) => decorateAccount({ ...x, balance: debitNormal(x.type) ? x.dr_balance : -x.dr_balance }));
      });
    });

    app.get('/accounts/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const acc = await one(c, `select a.*, p.code as parent_code, p.name as parent_name from accounts a left join accounts p on p.id = a.parent_id where a.id = $1`, [id], 'Account');
        const usage = await accountUsage(c, id);
        const bal = (await c.query(
          `select coalesce(sum(l.debit), 0) as d, coalesce(sum(l.credit), 0) as c from journal_lines l join journal_entries j on j.id = l.journal_id
           where j.status in ${EFFECTIVE} and (l.account_id = $1 or l.account_id in (
             with recursive t as (select id from accounts where parent_id = $1 union all select x.id from accounts x join t on x.parent_id = t.id) select id from t))`, [id])).rows[0];
        const movements = (await c.query(
          `select j.id, j.no, j.entry_date, j.description, j.status, l.debit, l.credit, l.partner_name
           from journal_lines l join journal_entries j on j.id = l.journal_id where l.account_id = $1 and j.status <> 'cancelled'
           order by j.entry_date desc, j.no desc limit 50`, [id])).rows;
        const children = (await c.query('select id, code, name, is_group, active from accounts where parent_id = $1 order by code', [id])).rows;
        return decorateAccount({
          ...acc, ...usage, used: usage.lines > 0, debit_total: bal.d, credit_total: bal.c,
          balance: debitNormal(acc.type) ? bal.d - bal.c : bal.c - bal.d, normal_side: debitNormal(acc.type) ? 'เดบิต' : 'เครดิต',
          movements, children_list: children,
          nameEn: acc.name_en, isGroup: acc.is_group, parentId: acc.parent_id,
        });
      });
    });

    app.post('/accounts', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'accounting.account.write');
      const b = parse(AccountInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await ensureChart(c);
        const parent = await checkParent(c, b.parentId, b.type);
        const category = categoryFor(b.type, b.category, parent?.category);
        const dup = await c.query('select 1 from accounts where code = $1', [b.code]);
        if (dup.rowCount) throw conflict(`รหัสบัญชี ${b.code} มีอยู่แล้ว`);
        const row = (await c.query(
          `insert into accounts (code, name, name_en, type, category, parent_id, is_group, role, active, note)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
          [b.code, b.name, b.nameEn || null, b.type, category, b.parentId ?? null, b.isGroup, b.role ?? null, b.active, b.note || null])).rows[0];
        return decorateAccount(row);
      });
    });

    app.put('/accounts/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.account.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(AccountUpdate, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const cur = await one(c, 'select * from accounts where id = $1 for update', [id], 'Account');
        const usage = await accountUsage(c, id);
        const type = (b.type ?? cur.type) as AccountType;
        if (b.type && b.type !== cur.type && (usage.lines || usage.children)) throw conflict('บัญชีนี้มีรายการหรือบัญชีย่อยแล้ว เปลี่ยนหมวดบัญชีไม่ได้');
        if (b.code && b.code !== cur.code && usage.lines) throw conflict('บัญชีนี้มีรายการบันทึกแล้ว เปลี่ยนรหัสไม่ได้');
        if (b.isGroup === true && !cur.is_group && usage.lines) throw conflict('บัญชีนี้มีรายการบันทึกแล้ว เปลี่ยนเป็นบัญชีคุมไม่ได้');
        if (b.isGroup === false && cur.is_group && usage.children) throw conflict('บัญชีคุมนี้ยังมีบัญชีย่อย เปลี่ยนเป็นบัญชีย่อยไม่ได้');
        if ((b.isGroup === true || b.active === false) && usage.rules) {
          throw conflict('บัญชีนี้ใช้อยู่ในกฎการลงบัญชีอัตโนมัติ — เปลี่ยนกฎไปใช้บัญชีอื่นก่อน');
        }
        if (b.code && b.code !== cur.code && (await c.query('select 1 from accounts where code = $1 and id <> $2', [b.code, id])).rowCount) throw conflict(`รหัสบัญชี ${b.code} มีอยู่แล้ว`);
        const parentId = b.parentId === undefined ? cur.parent_id : b.parentId;
        const parent = await checkParent(c, parentId, type, id);
        const category = categoryFor(type, b.category ?? (b.type && b.type !== cur.type ? undefined : cur.category), parent?.category);
        const row = (await c.query(
          `update accounts set code = $2, name = $3, name_en = $4, type = $5, category = $6, parent_id = $7, is_group = $8, role = $9, active = $10, note = $11, updated_at = now()
           where id = $1 returning *`,
          [id, b.code ?? cur.code, b.name ?? cur.name, b.nameEn === undefined ? cur.name_en : b.nameEn || null, type, category, parentId,
            b.isGroup ?? cur.is_group, b.role === undefined ? cur.role : b.role, b.active ?? cur.active, b.note === undefined ? cur.note : b.note || null])).rows[0];
        return decorateAccount(row);
      });
    });

    app.delete('/accounts/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.account.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const acc = await one(c, 'select * from accounts where id = $1 for update', [id], 'Account');
        const u = await accountUsage(c, id);
        if (u.lines) throw conflict(`บัญชี ${acc.code} ${acc.name} มีรายการบันทึกแล้ว ${u.lines} บรรทัด ลบไม่ได้ — ปิดการใช้งานแทน`);
        if (u.children) throw conflict(`บัญชี ${acc.code} ยังมีบัญชีย่อย ${u.children} บัญชี ลบไม่ได้`);
        if (u.rules) throw conflict(`บัญชี ${acc.code} ใช้อยู่ในกฎการลงบัญชีอัตโนมัติ — เปลี่ยนกฎก่อนจึงจะลบได้`);
        await c.query('delete from accounts where id = $1', [id]);
        return { deleted: true, id, code: acc.code };
      });
    });

    /* ---------- journal vouchers ---------- */

    app.get('/journals', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.read');
      const q = parse(JournalQuery, req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const rows = (await c.query(
          `select j.id, j.no, j.entry_date, j.description, j.ref, j.status, j.source_type, j.total_debit, j.total_credit, j.created_by_name, j.posted_at
           from journal_entries j
           where ($1::text is null or j.no ilike '%' || $1 || '%' or j.description ilike '%' || $1 || '%' or j.ref ilike '%' || $1 || '%')
             and ($2::text is null or j.status = $2) and ($3::text is null or j.source_type = $3)
             and ($4::date is null or j.entry_date >= $4) and ($5::date is null or j.entry_date <= $5)
             and ($6::uuid is null or exists (select 1 from journal_lines l where l.journal_id = j.id and l.account_id = $6))
           order by j.entry_date desc, j.no desc limit $7 offset $8`,
          [q.q?.trim() || null, q.status || null, q.source || null, q.from ?? null, q.to ?? null, q.accountId ?? null, q.limit, q.offset])).rows;
        return rows.map((r) => ({ ...r, status_label: STATUS_TH[r.status], source_label: EVENT_TH[r.source_type] ?? r.source_type }));
      });
    });

    app.get('/journals/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => journalDetail(c, id));
    });

    app.post('/journals', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.write');
      const b = parse(JournalInput, req.body);
      if (b.post) requirePerm(a, 'accounting.journal.post');
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await ensureChart(c);
        const j = await createJournal(c, { entryDate: b.entryDate ?? todayTh(), description: b.description, ref: b.ref, note: b.note }, b.lines, b.post ? 'posted' : 'draft', byOf(a));
        return journalDetail(c, j.id);
      });
    });

    app.put('/journals/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(JournalUpdate, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const j = await one(c, 'select * from journal_entries where id = $1 for update', [id], 'Journal');
        if (j.status !== 'draft') throw conflict(`แก้ไขได้เฉพาะสมุดรายวันสถานะร่าง (ตอนนี้: ${STATUS_TH[j.status]}) — ใช้การกลับรายการแทน`);
        await c.query(
          `update journal_entries set entry_date = $2, description = $3, ref = $4, note = $5, updated_at = now() where id = $1`,
          [id, b.entryDate ?? j.entry_date, b.description ?? j.description, b.ref === undefined ? j.ref : b.ref || null, b.note === undefined ? j.note : b.note || null]);
        return journalDetail(c, id);
      });
    });

    app.put('/journals/:id/lines', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ lines: Lines }), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const j = await one(c, 'select * from journal_entries where id = $1 for update', [id], 'Journal');
        if (j.status !== 'draft') throw conflict(`แก้ไขรายการได้เฉพาะสมุดรายวันสถานะร่าง (ตอนนี้: ${STATUS_TH[j.status]})`);
        const checked = await checkLines(c, b.lines);
        await writeLines(c, id, checked.lines);
        await c.query('update journal_entries set total_debit = $2, total_credit = $3, updated_at = now() where id = $1', [id, checked.debit, checked.credit]);
        return journalDetail(c, id);
      });
    });

    app.post('/journals/:id/post', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.post');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const j = await one(c, 'select * from journal_entries where id = $1 for update', [id], 'Journal');
        if (j.status !== 'draft') throw conflict(`ผ่านรายการได้เฉพาะสมุดรายวันสถานะร่าง (ตอนนี้: ${STATUS_TH[j.status]})`);
        const lines = (await c.query('select account_id as "accountId", debit, credit from journal_lines where journal_id = $1 order by line_no', [id])).rows;
        await checkLines(c, lines);
        await assertPeriodOpen(c, j.entry_date);
        await c.query(`update journal_entries set status = 'posted', posted_at = now(), posted_by = $2, posted_by_name = $3, updated_at = now() where id = $1`,
          [id, a.userId, a.userName ?? null]);
        return journalDetail(c, id);
      });
    });

    app.post('/journals/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const j = await one(c, 'select * from journal_entries where id = $1 for update', [id], 'Journal');
        if (j.status !== 'draft') throw conflict(`ยกเลิกได้เฉพาะสมุดรายวันสถานะร่าง (ตอนนี้: ${STATUS_TH[j.status]}) — รายการที่ผ่านแล้วให้กลับรายการ`);
        await c.query(`update journal_entries set status = 'cancelled', updated_at = now() where id = $1`, [id]);
        return journalDetail(c, id);
      });
    });

    app.post('/journals/:id/reverse', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.post');
      const { id } = parse(IdParam, req.params);
      const b = parse(ReverseInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const j = await one(c, 'select * from journal_entries where id = $1 for update', [id], 'Journal');
        if (j.status !== 'posted') throw conflict(`กลับรายการได้เฉพาะสมุดรายวันที่ผ่านรายการแล้วและยังไม่เคยกลับรายการ (ตอนนี้: ${STATUS_TH[j.status]})`);
        const lines = (await c.query('select * from journal_lines where journal_id = $1 order by line_no', [id])).rows;
        const date = b.entryDate ?? todayTh();
        if (date < j.entry_date) throw badRequest('วันที่กลับรายการต้องไม่ก่อนวันที่ของรายการเดิม');
        const rev = await createJournal(c, {
          entryDate: date, description: `กลับรายการ ${j.no}: ${b.reason || j.description}`.slice(0, 500), ref: j.ref,
          note: b.reason ? `เหตุผล: ${b.reason}` : null, sourceType: 'reversal', sourceId: j.id, reversalOf: j.id,
        }, lines.map((l) => ({ accountId: l.account_id, debit: l.credit, credit: l.debit, description: l.description, partnerId: l.partner_id, partnerName: l.partner_name, taxBase: l.tax_base,
          // wave 9: keep the tax document behind VAT / WHT lines so the registers and the WHT-payable report show the reversal against it
          taxInvoiceNo: l.tax_invoice_no, taxInvoiceDate: l.tax_invoice_date, taxPartyName: l.tax_party_name, taxPartyTaxId: l.tax_party_tax_id, taxPartyBranch: l.tax_party_branch,
          taxRefInvoiceNo: l.tax_ref_invoice_no, taxRefInvoiceDate: l.tax_ref_invoice_date,
          whtForm: l.wht_form, whtIncomeType: l.wht_income_type, whtRate: l.wht_rate === null ? null : Number(l.wht_rate), whtCertificateNo: l.wht_certificate_no })),
        'posted', byOf(a));
        await c.query(`update journal_entries set status = 'reversed', reversed_by = $2, updated_at = now() where id = $1`, [id, rev.id]);
        reply.code(201);
        return journalDetail(c, rev.id);
      });
    });

    /* ---------- auto-posting rules & errors ---------- */

    app.get('/posting-rules', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.read');
      return k.db.tx(a.tenantId, async (c) => {
        await ensureChart(c);
        const rows = (await c.query(
          `select r.*, a.code as account_code, a.name as account_name, a.active as account_active
           from posting_rules r left join accounts a on a.id = r.account_id order by r.sort, r.event_type, r.leg`)).rows;
        return rows.map((r) => ({
          ...r, event_label: EVENT_TH[r.event_type] ?? r.event_type, side_label: SIDE_TH[r.side],
          account_label: r.account_id ? `${r.account_code} ${r.account_name}` : '— ยังไม่ได้เลือก —', ok: !!r.account_id && r.account_active,
        }));
      });
    });

    app.put('/posting-rules/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.account.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(RuleUpdate, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from posting_rules where id = $1', [id], 'Posting rule');
        if (b.accountId) {
          const acc = (await c.query('select active, is_group, code from accounts where id = $1', [b.accountId])).rows[0];
          if (!acc) throw badRequest('ไม่พบบัญชี');
          if (acc.is_group) throw badRequest(`บัญชี ${acc.code} เป็นบัญชีคุม เลือกบัญชีย่อย`);
          if (!acc.active) throw badRequest(`บัญชี ${acc.code} ปิดการใช้งานอยู่`);
        }
        await c.query('update posting_rules set account_id = $2, updated_at = now() where id = $1', [id, b.accountId]);
        const r = (await c.query(
          `select r.*, a.code as account_code, a.name as account_name from posting_rules r left join accounts a on a.id = r.account_id where r.id = $1`, [id])).rows[0];
        return { ...r, event_label: EVENT_TH[r.event_type], side_label: SIDE_TH[r.side], account_label: r.account_id ? `${r.account_code} ${r.account_name}` : '— ยังไม่ได้เลือก —' };
      });
    });

    /* ---------- expense category → account (paid expense claims) ---------- */

    app.get('/category-mappings', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.read');
      const q = parse(z.object({ q: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        await ensureChart(c);
        const rows = (await c.query(
          `${MAPPING_SELECT} where ($1::text is null or m.category_code ilike $1 or m.category_name ilike $1 or a.code ilike $1 or a.name ilike $1)
           order by m.category_code`, [q.q?.trim() ? `%${q.q.trim()}%` : null])).rows;
        return rows.map(decorateMapping);
      });
    });

    app.get('/category-mappings/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => decorateMapping(await one(c, `${MAPPING_SELECT} where m.id = $1`, [id], 'Category mapping')));
    });

    app.post('/category-mappings', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'accounting.account.write');
      const b = parse(MappingInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await ensureChart(c);
        await checkMappingAccount(c, b.accountId);
        if ((await c.query('select 1 from category_mappings where lower(category_code) = lower($1)', [b.categoryCode])).rowCount) {
          throw conflict(`หมวด ${b.categoryCode} จับคู่บัญชีไว้แล้ว — แก้ไขรายการเดิมแทน`);
        }
        const row = (await c.query(
          `insert into category_mappings (category_code, category_name, account_id, note) values ($1, $2, $3, $4) returning id`,
          [b.categoryCode, b.categoryName || null, b.accountId, b.note || null])).rows[0];
        return decorateMapping((await c.query(`${MAPPING_SELECT} where m.id = $1`, [row.id])).rows[0]);
      });
    });

    app.put('/category-mappings/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.account.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(MappingUpdate, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const cur = await one(c, 'select * from category_mappings where id = $1 for update', [id], 'Category mapping');
        if (b.accountId) await checkMappingAccount(c, b.accountId);
        if (b.categoryCode && (await c.query('select 1 from category_mappings where lower(category_code) = lower($1) and id <> $2', [b.categoryCode, id])).rowCount) {
          throw conflict(`หมวด ${b.categoryCode} จับคู่บัญชีไว้แล้ว`);
        }
        await c.query(
          `update category_mappings set category_code = $2, category_name = $3, account_id = $4, note = $5, updated_at = now() where id = $1`,
          [id, b.categoryCode ?? cur.category_code, b.categoryName === undefined ? cur.category_name : b.categoryName || null,
            b.accountId ?? cur.account_id, b.note === undefined ? cur.note : b.note || null]);
        return decorateMapping((await c.query(`${MAPPING_SELECT} where m.id = $1`, [id])).rows[0]);
      });
    });

    app.delete('/category-mappings/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.account.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const m = await one(c, 'select category_code from category_mappings where id = $1', [id], 'Category mapping');
        await c.query('delete from category_mappings where id = $1', [id]);
        return { deleted: true, id, message: `ลบการจับคู่หมวด ${m.category_code} แล้ว — ใบเบิกหมวดนี้จะลงบัญชีค่าใช้จ่ายตามกฎ (ค่าเริ่มต้น)` };
      });
    });

    app.get('/posting-errors', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.read');
      const q = parse(z.object({ status: z.enum(['open', 'resolved', 'dismissed', 'all']).default('open'), q: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const rows = (await c.query(
          `select e.id, e.event_id, e.event_type, e.source_id, e.source_no, e.occurred_at, e.reason, e.status, e.attempts, e.created_at, e.resolved_at,
             e.resolved_by_name, e.journal_id, j.no as journal_no
           from posting_errors e left join journal_entries j on j.id = e.journal_id
           where ($1 = 'all' or e.status = $1) and ($2::text is null or e.source_no ilike '%' || $2 || '%' or e.reason ilike '%' || $2 || '%')
           order by e.created_at desc limit 500`, [q.status, q.q?.trim() || null])).rows;
        return rows.map((r) => ({ ...r, event_label: EVENT_TH[r.event_type] ?? r.event_type, status_label: ERROR_TH[r.status] }));
      });
    });

    app.post('/posting-errors/:id/retry', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.post');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const e = await one(c, 'select * from posting_errors where id = $1 for update', [id], 'Posting error');
        if (e.status !== 'open') throw conflict(`รายการนี้${ERROR_TH[e.status]}แล้ว`);
        const r = await postEvent(c, e.event_type as PostedEvent, e.payload, { eventId: e.event_id, occurredAt: new Date(e.occurred_at).toISOString() }, { name: a.userName ?? null });
        if (r.status === 'error') return { ok: false, status: 'open', message: `ยังลงบัญชีไม่ได้: ${r.reason}` };
        if (r.status === 'skipped' && r.message) {
          // wave 9: handled without a journal (a supplier bill matched to its goods receipt) — postEvent resolved the error
          return { ok: true, status: 'resolved', message: r.message };
        }
        if (r.status === 'skipped') {
          await c.query(`update posting_errors set status = 'dismissed', resolved_at = now(), resolved_by_name = $2 where id = $1`, [id, a.userName ?? null]);
          return { ok: true, status: 'dismissed', message: 'ไม่มียอดเงินที่ต้องลงบัญชี' };
        }
        const after = (await c.query(`select e.status, j.no from posting_errors e left join journal_entries j on j.id = e.journal_id where e.id = $1`, [id])).rows[0];
        return { ok: true, status: after.status, journal_id: r.status === 'posted' ? r.journal.id : null, message: `ลงบัญชีแล้ว${after.no ? ` (${after.no})` : ''}` };
      });
    });

    app.post('/posting-errors/:id/dismiss', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.post');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const e = await one(c, 'select * from posting_errors where id = $1 for update', [id], 'Posting error');
        if (e.status !== 'open') throw conflict(`รายการนี้${ERROR_TH[e.status]}แล้ว`);
        await c.query(`update posting_errors set status = 'dismissed', resolved_at = now(), resolved_by_name = $2 where id = $1`, [id, a.userName ?? null]);
        return { id, status: 'dismissed', message: 'ไม่ลงบัญชีรายการนี้ (บันทึกเองด้วยสมุดรายวัน)' };
      });
    });

    /* ---------- fiscal periods ---------- */

    app.get('/periods', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.read');
      const q = parse(z.object({ year: year.optional() }), req.query);
      const y = q.year ?? todayTh().slice(0, 4);
      return k.db.tx(a.tenantId, async (c) => {
        const rows = (await c.query(
          `select to_char(m, 'YYYY-MM') as period, coalesce(p.status, 'open') as status, p.closed_at, p.closed_by_name, p.reopened_at, p.reopened_by_name, p.note,
             count(j.id) filter (where j.status in ${EFFECTIVE})::int as entries,
             count(j.id) filter (where j.status = 'draft')::int as drafts,
             coalesce(sum(j.total_debit) filter (where j.status in ${EFFECTIVE}), 0) as total_debit
           from generate_series(make_date($1::int, 1, 1), make_date($1::int, 12, 1), interval '1 month') m
           left join fiscal_periods p on p.period = to_char(m, 'YYYY-MM')
           left join journal_entries j on date_trunc('month', j.entry_date) = m
           group by m, p.id order by m`, [Number(y)])).rows;
        return rows.map((r) => ({ ...r, id: r.period, period_th: periodTh(r.period), status_label: r.status === 'closed' ? 'ปิดงวดแล้ว' : 'เปิด' }));
      });
    });

    app.post('/periods/:period/close', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.period.close');
      const { period } = parse(PeriodParam, req.params);
      const b = parse(NoteInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const cur = (await c.query('select status from fiscal_periods where period = $1 for update', [period])).rows[0];
        if (cur?.status === 'closed') throw conflict(`งวด ${periodTh(period)} ปิดอยู่แล้ว`);
        const drafts = (await c.query(
          `select count(*)::int as n from journal_entries where status = 'draft' and to_char(entry_date, 'YYYY-MM') = $1`, [period])).rows[0].n;
        if (drafts) throw conflict(`งวด ${periodTh(period)} ยังมีสมุดรายวันสถานะร่าง ${drafts} รายการ — ผ่านรายการหรือยกเลิกก่อนปิดงวด`);
        await c.query(
          `insert into fiscal_periods (period, status, closed_at, closed_by, closed_by_name, note) values ($1, 'closed', now(), $2, $3, $4)
           on conflict (tenant_id, period) do update set status = 'closed', closed_at = now(), closed_by = $2, closed_by_name = $3, note = coalesce($4, fiscal_periods.note)`,
          [period, a.userId, a.userName ?? null, b.note || null]);
        // wave 8 (C5): Sales / Purchasing / Expense move their lock date so no posting document can be dated into the closed month
        await k.emit(c, 'accounting.period_closed', { period, lastDate: periodLastDate(period), closedByName: a.userName ?? null });
        return { id: period, period, period_th: periodTh(period), status: 'closed', status_label: 'ปิดงวดแล้ว', message: `ปิดงวด ${periodTh(period)} แล้ว` };
      });
    });

    app.post('/periods/:period/reopen', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.period.close');
      const { period } = parse(PeriodParam, req.params);
      const b = parse(NoteInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const cur = (await c.query('select status from fiscal_periods where period = $1 for update', [period])).rows[0];
        if (cur?.status !== 'closed') throw conflict(`งวด ${periodTh(period)} ยังเปิดอยู่`);
        await c.query(`update fiscal_periods set status = 'open', reopened_at = now(), reopened_by_name = $2, note = coalesce($3, note) where period = $1`,
          [period, a.userName ?? null, b.note || null]);
        await k.emit(c, 'accounting.period_reopened', { period, firstDate: `${period}-01`, reopenedByName: a.userName ?? null });
        return { id: period, period, period_th: periodTh(period), status: 'open', status_label: 'เปิด', message: `เปิดงวด ${periodTh(period)} อีกครั้งแล้ว` };
      });
    });

    /* ---------- reports ---------- */

    app.get('/reports/trial-balance', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.report.read');
      const q = parse(z.object({ asOf: s.isoDate.optional(), all: flag }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        await ensureChart(c);
        const asOf = q.asOf ?? todayTh();
        return { ...(await trialBalance(c, asOf, !!q.all)), asOfTh: formatThaiDate(asOf), title: 'งบทดลอง' };
      });
    });

    app.get('/reports/ledger', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.report.read');
      const q = parse(z.object({ accountId: s.uuid.optional(), from: s.isoDate.optional(), to: s.isoDate.optional() }), req.query);
      const to = q.to ?? todayTh();
      const from = q.from ?? `${to.slice(0, 7)}-01`;
      if (from > to) throw badRequest('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
      return k.db.tx(a.tenantId, async (c) => {
        if (q.accountId) await one(c, 'select id from accounts where id = $1', [q.accountId], 'Account');
        return { ...(await generalLedger(c, from, to, q.accountId)), title: 'บัญชีแยกประเภททั่วไป' };
      });
    });

    app.get('/reports/profit-loss', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.report.read');
      const q = parse(z.object({ month: month.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => ({ ...(await profitLoss(c, q.month ?? todayTh().slice(0, 7))), title: 'งบกำไรขาดทุน' }));
    });

    app.get('/reports/balance-sheet', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.report.read');
      const q = parse(z.object({ asOf: s.isoDate.optional() }), req.query);
      const asOf = q.asOf ?? todayTh();
      return k.db.tx(a.tenantId, async (c) => ({ ...(await balanceSheet(c, asOf)), asOfTh: formatThaiDate(asOf), title: 'งบแสดงฐานะการเงิน' }));
    });

    app.get('/reports/vat', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.report.read');
      const q = parse(z.object({ year: year.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => ({ ...(await vatReport(c, q.year ?? todayTh().slice(0, 4))), title: 'สรุปภาษีมูลค่าเพิ่มรายเดือน (ภ.พ.30)' }));
    });

    app.get('/reports/vat/lines', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.report.read');
      const q = parse(z.object({ month: month.optional(), kind: z.enum(['output', 'input']).default('output') }), req.query);
      return k.db.tx(a.tenantId, (c) => vatLines(c, q.month ?? todayTh().slice(0, 7), q.kind));
    });

    app.get('/reports/wht-received', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.report.read');
      const q = parse(z.object({ year: year.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => ({ ...(await whtReceived(c, q.year ?? todayTh().slice(0, 4))), title: 'ภาษีเงินได้ถูกหัก ณ ที่จ่าย' }));
    });

    /* ---------- wave 9: tax returns (ภ.พ.30, WHT payable) and supplier bills ---------- */

    // ภ.พ.30 of a month (boxes 1–16) — a preview: zeroRated / exempt / surcharge / penalty / filedDate / channel may be passed to see the effect
    const pp30 = async (req: any) => {
      const a = auth(req);
      requirePerm(a, 'accounting.tax.read');
      const period = req.params?.period ?? parse(z.object({ period: month.optional() }), req.query).period ?? todayTh().slice(0, 7);
      parse(PeriodParam, { period });
      const q = parse(Pp30Query, req.query);
      return k.db.tx(a.tenantId, async (c) => { await ensureChart(c); return computePp30(c, period, q); });
    };
    app.get('/reports/pp30', pp30);
    app.get('/pp30/:period', pp30);

    app.get('/reports/pp30/csv', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'accounting.tax.read');
      const { period } = parse(z.object({ period: month }), req.query);
      const q = parse(Pp30Query, req.query);
      const x = await k.db.tx(a.tenantId, (c) => computePp30(c, period, q));
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="pp30-${period}.csv"`);
      return pp30Csv(x);
    });

    app.get('/pp30', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.tax.read');
      const q = parse(z.object({ year: year.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => { await ensureChart(c); return pp30Year(c, q.year ?? todayTh().slice(0, 4)); });
    });

    // RECORD a filing made on rd.go.th / on paper — nothing is sent to the Revenue Department
    app.post('/pp30/:period/file', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'accounting.tax.file');
      const { period } = parse(PeriodParam, req.params);
      const b = parse(Pp30File, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => { await ensureChart(c); return recordFiling(c, period, b, byOf(a)); });
    });

    app.get('/reports/wht-payable', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.tax.read');
      const q = parse(z.object({ year: year.optional(), month: month.optional(), form: z.enum(['PND3', 'PND53']).optional() }), req.query);
      const y = q.year ?? q.month?.slice(0, 4) ?? todayTh().slice(0, 4);
      return k.db.tx(a.tenantId, async (c) => { await ensureChart(c); return whtPayable(c, { year: y, month: q.month, form: q.form }); });
    });

    app.get('/supplier-bills', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.journal.read');
      const q = parse(BillQuery, req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const rows = (await c.query(
          `select b.*, j.no as journal_no from supplier_bills b left join journal_entries j on j.id = b.journal_id
           where ($1::text is null or b.bill_no ilike '%' || $1 || '%' or b.supplier_name ilike '%' || $1 || '%' or b.supplier_invoice_no ilike '%' || $1 || '%' or b.po_no ilike '%' || $1 || '%')
             and ($2::text is null or b.kind = $2) and ($3::text is null or b.treatment = $3)
             and ($4::date is null or b.bill_date >= $4) and ($5::date is null or b.bill_date <= $5)
           order by b.bill_date desc, b.bill_no desc limit $6 offset $7`,
          [q.q?.trim() || null, q.kind ?? null, q.treatment ?? null, q.from ?? null, q.to ?? null, q.limit, q.offset])).rows;
        return rows.map((r) => ({ ...r, kind_label: BILL_KIND_TH[r.kind], treatment_label: TREATMENT_TH[r.treatment] }));
      });
    });

    /* ---------- dashboard ---------- */

    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'accounting.report.read');
      const today = todayTh();
      return k.db.tx(a.tenantId, async (c) => {
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month,
             coalesce(sum(case when a.type = 'revenue' then l.credit - l.debit end), 0) as revenue,
             coalesce(sum(case when a.type = 'expense' then l.debit - l.credit end), 0) as expense
           from generate_series(date_trunc('month', $1::date) - interval '5 months', date_trunc('month', $1::date), interval '1 month') m
           left join journal_entries j on date_trunc('month', j.entry_date) = m and j.status in ${EFFECTIVE}
           left join journal_lines l on l.journal_id = j.id
           left join accounts a on a.id = l.account_id and a.type in ('revenue', 'expense')
           group by m order by m`, [today])).rows.map((m) => ({ ...m, revenue: Math.round(m.revenue * 100) / 100, expense: Math.round(m.expense * 100) / 100, net: Math.round((m.revenue - m.expense) * 100) / 100 }));
        const bal = (await c.query(
          `select a.role, coalesce(sum(l.debit - l.credit), 0) as dr from accounts a
           join journal_lines l on l.account_id = a.id join journal_entries j on j.id = l.journal_id and j.status in ${EFFECTIVE} and j.entry_date <= $1
           where a.role in ('ar', 'ap', 'cash', 'bank', 'vat_output', 'vat_input', 'deposit_received') group by a.role`, [today])).rows;
        const dr = (role: string) => Number(bal.find((b) => b.role === role)?.dr ?? 0);
        const counts = (await c.query(
          `select (select count(*) from journal_entries where status = 'draft')::int as drafts,
                  (select count(*) from posting_errors where status = 'open')::int as errors,
                  (select count(*) from journal_entries where status in ${EFFECTIVE} and date_trunc('month', entry_date) = date_trunc('month', $1::date))::int as entries_month`, [today])).rows[0];
        const rows = (await c.query(
          `select id, no, entry_date, description, status, source_type, total_debit, created_at from journal_entries where status <> 'cancelled' order by created_at desc limit 20`)).rows
          .map((r) => ({ ...r, status_label: STATUS_TH[r.status], source_label: EVENT_TH[r.source_type] ?? r.source_type, link: `/m/accounting/jvDetail/${r.id}` }));
        const cur = months[months.length - 1];
        const r2 = (n: number) => Math.round(n * 100) / 100;
        return {
          month: cur.month, revenueMonth: cur.revenue, expenseMonth: cur.expense, netMonth: cur.net,
          arBalance: r2(dr('ar')), apBalance: r2(-dr('ap')), cashBalance: r2(dr('cash') + dr('bank')),
          vatPayable: r2(-dr('vat_output') - dr('vat_input')), depositsHeld: r2(-dr('deposit_received')),
          drafts: counts.drafts, postingErrors: counts.errors, entriesMonth: counts.entries_month,
          months, rows,
        };
      });
    });

  },
  handlers: {
    'sales.invoiced': autoPost('sales.invoiced'),
    'sales.payment_received': autoPost('sales.payment_received'),
    'purchasing.goods_received': autoPost('purchasing.goods_received'),
    'purchasing.goods_returned': autoPost('purchasing.goods_returned'),
    'expense.claim_paid': autoPost('expense.claim_paid'),
    'payroll.run_paid': autoPost('payroll.run_paid'),
    'sales.note_issued': autoPost('sales.note_issued'),
    'purchasing.bill_recorded': autoPost('purchasing.bill_recorded'),
    'purchasing.supplier_paid': autoPost('purchasing.supplier_paid'),
  },
};

