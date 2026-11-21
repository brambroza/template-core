import { auth, badRequest, conflict, forbidden, guardLockDate, hasPerm, loadManifest, lockThroughPeriod, nextDocNo, one, parse, readLock, requirePerm, s, setLockDate, thaiToday, unlockPeriod, z, type AuthContext, type Client, type Kernel, type ServiceDefinition } from '@erp/kernel';
import { bahtText, isValidThaiTaxId, round } from '@erp/thai';
import { fileURLToPath } from 'node:url';
import { statusTh } from '@erp/ui-schema';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- input schemas ---------------- */

const text = (max: number) => z.string().trim().max(max);
const PayMethod = z.enum(['transfer', 'cash', 'cheque']);

const CategoryInput = z.object({
  code: s.code,
  name: s.name,
  monthlyLimit: s.money.nullable().optional(),
  requiresReceipt: z.boolean().default(false),
  /** C3: VAT of this category may be claimed as ภาษีซื้อ (omitted = decided from the name: ค่ารับรอง / รถยนต์นั่ง → false) */
  vatClaimable: z.boolean().optional(),
  note: text(500).optional(),
  active: z.boolean().default(true),
});
const CategoryUpdate = z.object({
  name: s.name.optional(),
  monthlyLimit: s.money.nullable().optional(),
  requiresReceipt: z.boolean().optional(),
  vatClaimable: z.boolean().optional(),
  note: text(500).nullable().optional(),
  active: z.boolean().optional(),
});

const ClaimLine = z.object({
  expenseDate: s.isoDate,
  categoryId: s.uuid,
  description: text(500).optional(),
  amount: s.money,
  vat: s.money.default(0),
  /** เลขที่ใบเสร็จ / ใบกำกับภาษีของผู้ขาย */
  receiptNo: text(100).optional(),
  /** C3: full_tax_invoice (ใบกำกับภาษีเต็มรูป) | abbreviated (อย่างย่อ) | none (ใบเสร็จธรรมดา/ไม่มี). Default: full when VAT > 0, else none */
  receiptType: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.enum(['full_tax_invoice', 'abbreviated', 'none']).optional()),
  vendorName: text(200).optional(),
  vendorTaxId: z.string().trim().regex(/^\d{13}$/, 'เลขประจำตัวผู้เสียภาษี 13 หลัก').refine(isValidThaiTaxId, 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง').optional().or(z.literal('').transform(() => undefined)),
  /** สาขาผู้ขาย: '00000' = สำนักงานใหญ่ */
  vendorBranch: text(20).optional(),
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
const PayInput = z.object({
  paidDate: s.isoDate.optional(), method: PayMethod, reference: text(200).optional(),
  /** wave 8: needed (with perm expense.lock.override) to date a payment on/before the lock date */
  lockOverrideReason: text(500).optional(),
});

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
const bangkokToday = () => thaiToday();
/** Payment date: given or today in Bangkok (never the database's UTC current_date — accountant C10); not in the future. */
function payDate(given?: string): string {
  const d = given ?? bangkokToday();
  if (d > bangkokToday()) throw badRequest('ลงวันที่จ่ายล่วงหน้าไม่ได้', { fieldErrors: { paidDate: ['วันที่จ่ายต้องไม่เกินวันนี้'] } });
  return d;
}
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
  cl.lines = (await c.query('select * from claim_lines where claim_id = $1 order by line_no', [id])).rows
    .map((l: any) => ({ ...l, receipt_type_label: l.receipt_type ? RECEIPT_TH[l.receipt_type] : null, input_vat: l.vat_claimable === false ? 0 : Number(l.vat) }));
  // C3: ภาษีซื้อที่ขอคืนได้ vs VAT ที่เป็นค่าใช้จ่าย
  cl.input_vat = round(cl.lines.reduce((sum: number, l: any) => sum + l.input_vat, 0));
  cl.vat_expensed = round(Number(cl.vat) - cl.input_vat);
  cl.net_payable = round(cl.total - cl.advance_amount);
  cl.total_text = bahtText(cl.total);
  cl.is_mine = cl.claimant_id === a.userId;
  return decorate(cl);
}

/**
 * Attachments of a claim / advance can be added or removed by its owner only while it is still open; after approval the evidence is frozen
 * (approvers and payers may still add files, deleting needs `expense.attachment.delete`).
 */
async function evidenceOpen(c: Client, a: AuthContext, table: 'claims' | 'advances', id: string, open: string[]) {
  if (hasPerm(a, 'expense.claim.approve') || hasPerm(a, 'expense.claim.pay')) return;
  const row = (await c.query(`select no, status from ${table} where id = $1`, [id])).rows[0];
  if (row && !open.includes(row.status)) {
    throw conflict(`${row.no} ${STATUS_TH[row.status] ?? row.status}แล้ว — เพิ่มหรือลบไฟล์แนบไม่ได้ (ติดต่อฝ่ายบัญชีถ้าต้องแก้หลักฐาน)`);
  }
}

/** Segregation of duties: nobody approves their own claim or advance. */
function refuseSelfApproval(owner: string, a: AuthContext, what: string) {
  if (owner === a.userId) throw forbidden(`อนุมัติ${what}ของตนเองไม่ได้ — ให้ผู้อนุมัติคนอื่นอนุมัติ`);
}

/** Approve a submitted claim as `a`: never one's own, and over the monthly limit only with approve-over-limit (wave 8). */
async function approveClaim(c: Client, id: string, a: AuthContext, note: string | null) {
  const cl = await loadClaim(c, id, a, true);
  if (cl.status !== 'submitted') throw conflict(`อนุมัติใบเบิกไม่ได้ — อยู่ในสถานะ "${statusTh(cl.status)}"`);
  refuseSelfApproval(cl.claimant_id, a, 'ใบเบิก');
  // over the monthly limit (re-checked now) → only someone with approve-over-limit (e.g. the executive), not the line approver (wave 8)
  await refreshWarnings(c, id);
  const lim = (await c.query('select over_limit, warnings from claims where id = $1', [id])).rows[0];
  if (lim.over_limit && !hasPerm(a, 'expense.claim.approve-over-limit')) {
    const why = (lim.warnings as any[]).filter((w) => w.kind === 'limit').map((w) => w.message).join(' · ');
    throw forbidden(`ใบเบิก ${cl.no} เกินวงเงินรายเดือน (${why}) — ต้องให้ผู้มีสิทธิ์ "อนุมัติใบเบิกที่เกินวงเงินรายเดือน" (เช่น ผู้บริหาร) อนุมัติ`);
  }
  await c.query(`update claims set status = 'approved', approved_by = $2, approved_by_name = $4, approved_at = now(), last_note = coalesce($3, last_note), updated_at = now() where id = $1`, [id, a.userId, note, a.userName ?? null]);
  return loadClaim(c, id, a);
}

/**
 * "อนุมัติ" pressed on a LINE card (automation.line_decision, target expense.claim): approve as that person with the app's rules.
 * Refused when their sessions were revoked after automation last saw their permissions, or they lack expense.claim.approve. Never throws.
 */
export async function lineClaimDecision(e: { lineActionId: string; userId: string; userName: string | null; perms: string[]; permsAt: number; entityId: string },
  ctx: { client: Client; tenantId: string; emit: (type: any, data: any) => Promise<string> }) {
  const c = ctx.client;
  const answer = (ok: boolean, message: string) => ctx.emit('expense.line_decision_result', { lineActionId: e.lineActionId, userId: e.userId, ok, message });
  const cutoff = (await c.query<{ before: string }>('select before from _revoked_tokens where user_id = $1', [e.userId])).rows[0];
  if (cutoff && Number(cutoff.before) > e.permsAt) return answer(false, 'สิทธิ์หรือการเข้าระบบของคุณเปลี่ยนไปหลังจากได้รับข้อความนี้ — เปิดแอปเพื่ออนุมัติแทน');
  const a: AuthContext = { tenantId: ctx.tenantId, userId: e.userId, userName: e.userName ?? undefined, perms: e.perms };
  if (!hasPerm(a, 'expense.claim.approve')) return answer(false, 'บัญชีของคุณไม่มีสิทธิ์อนุมัติใบเบิก');
  await c.query('savepoint line_decision');
  try {
    const cl = await approveClaim(c, e.entityId, a, 'อนุมัติผ่าน LINE');
    await c.query('release savepoint line_decision');
    return answer(true, `✅ อนุมัติใบเบิก ${cl.no} ของ ${cl.claimant_name ?? '-'} ยอด ${Number(cl.total).toLocaleString('en-US', { minimumFractionDigits: 2 })} บาทแล้ว`);
  } catch (err) {
    await c.query('rollback to savepoint line_decision');
    return answer(false, `อนุมัติไม่สำเร็จ: ${(err as Error).message}`);
  }
}

const SettingsInput = z.object({ separatePayer: z.boolean() });
async function readSettings(c: Client) {
  const r = (await c.query('select separate_payer from settings')).rows[0];
  return { separatePayer: r?.separate_payer ?? true };
}

/**
 * Segregation of duties on payment (setting `separatePayer`, default on, wave 8): whoever approved a claim/advance cannot record
 * its payment, and nobody records the payment of their own claim/advance.
 */
async function refuseSamePayer(c: Client, a: AuthContext, row: { no: string; approved_by: string | null; claimant_id?: string; requester_id?: string }, what: string) {
  if (!(await readSettings(c)).separatePayer) return;
  if (row.approved_by && row.approved_by === a.userId) {
    throw forbidden(`ผู้อนุมัติ${what} ${row.no} บันทึกจ่ายเงินเองไม่ได้ (แยกหน้าที่ผู้อนุมัติ/ผู้จ่ายเงิน) — ให้เจ้าหน้าที่การเงินคนอื่นบันทึกจ่าย`);
  }
  if ((row.claimant_id ?? row.requester_id) === a.userId) throw forbidden(`บันทึกจ่ายเงิน${what}ของตนเองไม่ได้ — ให้เจ้าหน้าที่การเงินคนอื่นบันทึกจ่าย`);
}

function requireOwner(row: { claimant_id?: string; requester_id?: string }, a: AuthContext) {
  const owner = row.claimant_id ?? row.requester_id;
  if (owner !== a.userId && !hasPerm(a, 'expense.claim.approve')) throw forbidden(`แก้ได้เฉพาะผู้เบิก หรือผู้อนุมัติ`);
}

/** C3: ภาษีซื้อต้องห้าม by category name when the company has not decided: entertainment (ค่ารับรอง) and passenger cars (รถยนต์นั่ง/รถเก๋ง). */
const NOT_CLAIMABLE_NAME = /รับรอง|entertain|รถยนต์นั่ง|รถเก๋ง|รถนั่ง|passenger car/i;
export const categoryVatClaimable = (cat: { vat_claimable: boolean | null; name: string; code?: string }) =>
  cat.vat_claimable ?? !(NOT_CLAIMABLE_NAME.test(cat.name) || NOT_CLAIMABLE_NAME.test(cat.code ?? ''));
const decorateCategory = (cat: any) => ({ ...cat, vat_claimable_set: cat.vat_claimable !== null, vat_claimable: categoryVatClaimable(cat) });
const RECEIPT_TH: Record<string, string> = { full_tax_invoice: 'ใบกำกับภาษีเต็มรูป', abbreviated: 'ใบกำกับภาษีอย่างย่อ', none: 'ใบเสร็จ/ไม่มีใบกำกับภาษี' };

/** Why a line's VAT cannot be claimed as ภาษีซื้อ (null = claimable or no VAT). */
function vatBlock(l: { vat: number; receipt_type: string | null; vendor_tax_id: string | null }, catClaimable: boolean, catName: string): string | null {
  if (!(Number(l.vat) > 0)) return null;
  if (!catClaimable) return `หมวด ${catName} เป็นภาษีซื้อต้องห้าม`;
  if (l.receipt_type === null) return null; // written before C3: kept as posted
  if (l.receipt_type !== 'full_tax_invoice') return `${RECEIPT_TH[l.receipt_type]} ใช้เครดิตภาษีซื้อไม่ได้`;
  if (!l.vendor_tax_id) return 'ไม่มีเลขประจำตัวผู้เสียภาษีของผู้ขาย';
  return null;
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
    if (!cat) throw badRequest(`รายการที่ ${i + 1}: ไม่พบหมวดค่าใช้จ่ายนี้`);
    if (!cat.active) throw badRequest(`รายการที่ ${i + 1}: หมวด ${cat.code} ปิดการใช้งานแล้ว`);
    if (l.expenseDate > bangkokToday()) {
      throw badRequest(`รายการที่ ${i + 1}: วันที่ใช้จ่าย ${l.expenseDate} อยู่ในอนาคต`, { fieldErrors: { expenseDate: ['วันที่ใช้จ่ายต้องไม่เกินวันนี้'] } });
    }
    const amount = round(l.amount);
    const v = round(l.vat);
    if (v > amount) throw badRequest(`รายการที่ ${i + 1}: VAT (${fmt(v)}) มากกว่าจำนวนเงิน (${fmt(amount)})`, { fieldErrors: { vat: ['VAT ต้องไม่มากกว่าจำนวนเงิน'] } });
    // C3: VAT is 0% or 7% of the amount before VAT (± 1 baht for the seller's rounding) — anything else is not a Thai VAT
    if (v > 0 && Math.abs(v - amount * 0.07) > 1) {
      throw badRequest(`รายการที่ ${i + 1}: VAT ${fmt(v)} บาท ไม่ใช่ 7% ของ ${fmt(amount)} บาท (ควรเป็น ${fmt(round(amount * 0.07))}) — ถ้าร้านไม่ได้จด VAT ให้กรอก VAT เป็น 0 และใส่ยอดรวมในจำนวนเงิน`,
        { fieldErrors: { vat: ['VAT ต้องเป็น 0 หรือ 7% ของจำนวนเงิน (คลาดเคลื่อนได้ไม่เกิน 1 บาท)'] } });
    }
    const receiptType = l.receiptType ?? (v > 0 ? 'full_tax_invoice' : 'none');
    const claimable = v > 0 && vatBlock({ vat: v, receipt_type: receiptType, vendor_tax_id: l.vendorTaxId ?? null }, categoryVatClaimable(cat), cat.name) === null;
    net += amount;
    vat += v;
    await c.query(
      `insert into claim_lines (claim_id, line_no, expense_date, category_id, category_code, category_name, receipt_required, description, amount, vat, total, receipt_no,
         receipt_type, vendor_name, vendor_tax_id, vendor_branch, vat_claimable)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [claimId, i + 1, l.expenseDate, cat.id, cat.code, cat.name, cat.requires_receipt, l.description ?? null, amount, v, round(amount + v), l.receiptNo || null,
        receiptType, l.vendorName || null, l.vendorTaxId || null, l.vendorBranch || null, claimable],
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
    ...(await vatWarnings(c, claimId)),
  ];
  await c.query('update claims set warnings = $2, over_limit = $3 where id = $1', [claimId, JSON.stringify(warnings), over.length > 0]);
}

/** C3: lines whose VAT goes to the expense instead of ภาษีซื้อ (information for the approver and finance, never blocks). */
async function vatWarnings(c: Client, claimId: string) {
  const rows = (await c.query(
    `select l.line_no, l.vat, l.receipt_type, l.vendor_tax_id, l.category_name, cat.vat_claimable as cat_flag, cat.name as cat_name, cat.code as cat_code
     from claim_lines l join expense_categories cat on cat.id = l.category_id where l.claim_id = $1 and l.vat > 0 and l.vat_claimable is false order by l.line_no`, [claimId])).rows;
  return rows.map((r) => {
    const why = vatBlock(r, categoryVatClaimable({ vat_claimable: r.cat_flag, name: r.cat_name, code: r.cat_code }), r.category_name) ?? 'เครดิตภาษีซื้อไม่ได้';
    return { kind: 'vat', lineNo: r.line_no, vat: Number(r.vat), message: `รายการที่ ${r.line_no}: ${why} — VAT ${fmt(Number(r.vat))} บาท ลงเป็นค่าใช้จ่าย` };
  });
}

async function submitClaim(k: Kernel, c: Client, id: string, a: AuthContext) {
  const cl = await loadClaim(c, id, a, true);
  requireOwner(cl, a);
  if (!['draft', 'returned'].includes(cl.status)) throw conflict(`ส่งใบเบิกไม่ได้ — อยู่ในสถานะ "${statusTh(cl.status)}"`);
  const missing = cl.lines.filter((l: any) => l.receipt_required && !l.receipt_no);
  if (missing.length) throw badRequest(`ต้องใส่เลขที่ใบเสร็จในรายการที่ ${missing.map((l: any) => l.line_no).join(', ')}`);
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
      // once approved, the claimant can no longer swap the evidence (bugs-0.4 EXP-06); finance may still add e.g. the transfer slip
      claim: { table: 'claims', access: (c, a, id) => loadClaim(c, id, a), writable: (c, a, id) => evidenceOpen(c, a, 'claims', id, ['draft', 'submitted', 'returned']) },
      advance: { table: 'advances', access: (c, a, id) => loadAdvance(c, id, a), writable: (c, a, id) => evidenceOpen(c, a, 'advances', id, ['requested']) },
    },
  },
  routes(app, k) {
    /* ----- company controls (wave 8) ----- */

    app.get('/settings', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      return k.db.tx(a.tenantId, readSettings);
    });

    app.put('/settings', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.settings.write');
      const b = parse(SettingsInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await c.query(
          `insert into settings (tenant_id, separate_payer) values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1)
           on conflict (tenant_id) do update set separate_payer = $1`, [b.separatePayer]);
        return readSettings(c);
      });
    });

    /* ----- categories ----- */

    app.get('/categories', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      const q = parse(s.listQuery.extend({ limit: z.coerce.number().int().min(1).max(500).default(200), active: flag }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from expense_categories where ($1::boolean is null or active = $1) and ($2::text is null or code ilike $2 or name ilike $2)
         order by code limit $3 offset $4`, [q.active ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows.map(decorateCategory));
    });

    app.get('/categories/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const cat = await one(c, 'select * from expense_categories where id = $1', [id], 'Category');
        cat.used_this_month = (await c.query(
          `select coalesce(sum(l.total), 0) as v from claim_lines l join claims cl on cl.id = l.claim_id
           where l.category_id = $1 and cl.status in ('submitted', 'approved', 'paid') and date_trunc('month', l.expense_date) = date_trunc('month', $4::date)
             and (cl.claimant_id = $2 or $3::boolean)`, [id, a.userId, seesAll(a), bangkokToday()])).rows[0].v; // staff: only their own spend
        return decorateCategory(cat);
      });
    });

    app.post('/categories', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'expense.category.write');
      const b = parse(CategoryInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `insert into expense_categories (code, name, monthly_limit, requires_receipt, note, active, vat_claimable) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [b.code, b.name, b.monthlyLimit ?? null, b.requiresReceipt, b.note ?? null, b.active,
          b.vatClaimable ?? categoryVatClaimable({ vat_claimable: null, name: b.name, code: b.code })])).rows.map(decorateCategory)[0]);
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
             active = coalesce($8, active), vat_claimable = coalesce($9, vat_claimable), updated_at = now()
           where id = $1 returning *`,
          [id, b.name ?? null, b.monthlyLimit !== undefined, b.monthlyLimit ?? null, b.requiresReceipt ?? null, b.note !== undefined, b.note ?? null, b.active ?? null,
            b.vatClaimable ?? null])).rows.map(decorateCategory)[0];
      });
    });

    /* ----- claims ----- */

    app.post('/claims', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.write');
      const b = parse(ClaimInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const claimDate = b.claimDate ?? bangkokToday(); // Thai day, not the database's UTC current_date (round-2 #4)
        const no = await nextDocNo(c, 'EXP', new Date(claimDate));
        const row = (await c.query(
          `insert into claims (no, claimant_id, claimant_name, department, purpose, claim_date, created_by)
           values ($1,$2,$3,$4,$5,$6::date,$2) returning id`,
          [no, a.userId, a.userName ?? b.claimantName ?? null, b.department ?? null, b.purpose, claimDate])).rows[0];
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
        if (!['draft', 'returned'].includes(cl.status)) throw conflict(`แก้ไขใบเบิกไม่ได้ — อยู่ในสถานะ "${statusTh(cl.status)}"`);
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
        if (!['draft', 'returned'].includes(cl.status)) throw conflict(`แก้รายการในใบเบิกไม่ได้ — อยู่ในสถานะ "${statusTh(cl.status)}"`);
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
      return k.db.tx(a.tenantId, (c) => approveClaim(c, id, a, b.note ?? null));
    });

    for (const [path, status] of [['reject', 'rejected'], ['return', 'returned']] as const) {
      app.post(`/claims/:id/${path}`, async (req) => {
        const a = auth(req);
        requirePerm(a, 'expense.claim.approve');
        const { id } = parse(IdParam, req.params);
        const b = parse(Note, req.body ?? {});
        return k.db.tx(a.tenantId, async (c) => {
          const cl = await loadClaim(c, id, a, true);
          if (cl.status !== 'submitted') throw conflict(`ทำรายการนี้กับใบเบิกไม่ได้ — อยู่ในสถานะ "${statusTh(cl.status)}"`);
          await c.query(`update claims set status = $2, last_note = $3, rejected_at = case when $2 = 'rejected' then now() else rejected_at end, updated_at = now() where id = $1`, [id, status, b.note]);
          if (status === 'rejected') await refreshWarnings(c, id);
          return loadClaim(c, id, a);
        });
      });
    }

    /* ---------- lock date (wave 8): claim / advance payments dated on/before it are refused ---------- */

    app.get('/lock', async (req) => {
      const a = auth(req);
      if (!hasPerm(a, 'expense.lock.write')) requirePerm(a, 'expense.claim.pay');
      return k.db.tx(a.tenantId, async (c) => ({ id: 'lock', ...(await readLock(c)) }));
    });

    app.post('/lock', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.lock.write');
      const b = parse(z.object({ lockDate: z.preprocess((v) => (v === '' || v === undefined ? null : v), s.isoDate.nullable()) }), req.body ?? {});
      if (b.lockDate && b.lockDate > bangkokToday()) throw badRequest('วันที่ปิดงวดต้องไม่เกินวันนี้', { fieldErrors: { lockDate: ['วันที่ปิดงวดต้องไม่เกินวันนี้'] } });
      return k.db.tx(a.tenantId, async (c) => ({ id: 'lock', ...(await setLockDate(c, b.lockDate, a.userName ?? null)) }));
    });

    app.post('/claims/:id/pay', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.pay');
      const { id } = parse(IdParam, req.params);
      const b = parse(PayInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const cl = await loadClaim(c, id, a, true);
        if (cl.status !== 'approved') throw conflict(`จ่ายเงินใบเบิกไม่ได้ — อยู่ในสถานะ "${statusTh(cl.status)}"`);
        await refuseSamePayer(c, a, cl, 'ใบเบิก');
        const paidDate = payDate(b.paidDate);
        await guardLockDate(c, a, { module: 'expense', date: paidDate, what: 'จ่ายเงินใบเบิก', overrideReason: b.lockOverrideReason });
        await c.query(
          `update claims set status = 'paid', paid_date = $2::date, pay_method = $3, pay_reference = $4, paid_by = $5, paid_by_name = $6, updated_at = now() where id = $1`,
          [id, paidDate, b.method, b.reference ?? null, a.userId, a.userName ?? null]);
        const paid = (await c.query(`select to_char(paid_date, 'YYYY-MM-DD') as paid_date from claims where id = $1`, [id])).rows[0];
        await k.emit(c, 'expense.claim_paid', {
          claimId: cl.id, no: cl.no, claimantName: cl.claimant_name ?? null, total: cl.total, claimantId: cl.claimant_id,
          // wave 5: what accounting needs to post the expense by category with input VAT
          paidDate: paid.paid_date, payMethod: b.method, department: cl.department ?? null,
          lines: cl.lines.map((l: any) => ({
            categoryCode: l.category_code, categoryName: l.category_name, amount: Number(l.amount), vat: Number(l.vat), description: l.description ?? null,
            // C3 / C7: input VAT eligibility and the seller's tax invoice for the purchase VAT register
            vatClaimable: l.vat_claimable !== false, receiptType: l.receipt_type ?? null, expenseDate: l.expense_date,
            vendorName: l.vendor_name ?? null, vendorTaxId: l.vendor_tax_id ?? null, vendorBranch: l.vendor_branch ?? null, receiptNo: l.receipt_no ?? null,
          })),
          ...(Number(cl.advance_amount) > 0 ? { advanceNo: cl.advance_no ?? null, advanceAmount: Number(cl.advance_amount) } : {}),
        });
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
        if (!['draft', 'returned'].includes(cl.status)) throw conflict(`ยกเลิกใบเบิกไม่ได้ — อยู่ในสถานะ "${statusTh(cl.status)}"`);
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
        if (adv.status !== 'requested') throw conflict(`อนุมัติเงินทดรองไม่ได้ — อยู่ในสถานะ "${statusTh(adv.status)}"`);
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
        if (adv.status !== 'requested') throw conflict(`ไม่อนุมัติเงินทดรองไม่ได้ — อยู่ในสถานะ "${statusTh(adv.status)}"`);
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
        if (adv.status !== 'approved') throw conflict(`จ่ายเงินทดรองไม่ได้ — อยู่ในสถานะ "${statusTh(adv.status)}"`);
        await refuseSamePayer(c, a, adv, 'เงินทดรองจ่าย');
        const paidDate = payDate(b.paidDate);
        await guardLockDate(c, a, { module: 'expense', date: paidDate, what: 'จ่ายเงินทดรอง', overrideReason: b.lockOverrideReason });
        await c.query(`update advances set status = 'paid', paid_date = $2::date, pay_method = $3, pay_reference = $4, paid_by = $5, paid_by_name = $6, updated_at = now() where id = $1`,
          [id, paidDate, b.method, b.reference ?? null, a.userId, a.userName ?? null]);
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
        if (!['requested', 'approved'].includes(adv.status)) throw conflict(`ยกเลิกเงินทดรองไม่ได้ — อยู่ในสถานะ "${statusTh(adv.status)}"`);
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
        if (adv.status !== 'paid') throw conflict(`เคลียร์เงินทดรองไม่ได้ — อยู่ในสถานะ "${statusTh(adv.status)}"`);
        const cl = await loadClaim(c, b.claimId, a, true);
        if (cl.claimant_id !== adv.requester_id) throw conflict(`ใบเบิก ${cl.no} เป็นของพนักงานคนอื่น`);
        // a claim that was already paid in full cannot absorb the advance any more (the employee would keep the advance)
        if (cl.status === 'paid') throw conflict(`ใบเบิก ${cl.no} จ่ายเงินเต็มจำนวนไปแล้ว — เคลียร์เงินทดรองได้เฉพาะใบเบิกที่อนุมัติแล้วและยังไม่จ่าย (พนักงานต้องคืนเงินทดรอง ${fmt(adv.amount)} บาท)`);
        if (cl.status !== 'approved') throw conflict(`ใบเบิก ${cl.no} อยู่ในสถานะ "${statusTh(cl.status)}" — ใช้เคลียร์เงินทดรองได้เฉพาะใบที่อนุมัติแล้ว`);
        if (cl.advance_id) throw conflict(`ใบเบิก ${cl.no} ใช้เคลียร์เงินทดรอง ${cl.advance_no} ไปแล้ว`);
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
             and date_trunc('month', l.expense_date) = coalesce(to_date($1, 'YYYY-MM'), date_trunc('month', $4::date))
           group by l.category_id
         ) x on x.category_id = cat.id
         where cat.active or x.total is not null
         order by total desc, cat.code`, [q.month ?? null, a.userId, seesAll(a), bangkokToday()])).rows);
    });

    /** What finance still owes: approved claims not yet paid, advances paid out but not cleared. */
    app.get('/reports/outstanding', async (req) => {
      const a = auth(req);
      requirePerm(a, 'expense.claim.read');
      return k.db.tx(a.tenantId, async (c) => {
        const items = (await c.query(
          `select *, total - advance_amount as net_payable, ($3::date - (approved_at at time zone 'Asia/Bangkok')::date) as days_waiting from claims
           where status = 'approved' and (claimant_id = $1 or $2::boolean) order by approved_at`, [a.userId, seesAll(a), bangkokToday()])).rows.map(decorate);
        const advances = (await c.query(
          `select *, ($3::date - paid_date) as days_open from advances where status = 'paid' and (requester_id = $1 or $2::boolean) order by paid_date`,
          [a.userId, seesAll(a), bangkokToday()])).rows.map(decorate);
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
      const p = [a.userId, seesAll(a), bangkokToday()];
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select count(*) filter (where status = 'submitted')::int as to_approve,
                  count(*) filter (where status = 'submitted' and over_limit)::int as over_limit,
                  count(*) filter (where status = 'approved')::int as to_pay,
                  coalesce(sum(total - advance_amount) filter (where status = 'approved'), 0) as to_pay_amount,
                  coalesce(sum(total) filter (where status = 'paid' and date_trunc('month', paid_date) = date_trunc('month', $3::date)), 0) as paid_month,
                  coalesce(sum(total) filter (where status in ('submitted', 'approved', 'paid') and date_trunc('month', claim_date) = date_trunc('month', $3::date)), 0) as claimed_month,
                  count(*) filter (where status in ('draft', 'returned') and claimant_id = $1)::int as my_open
           from claims where (claimant_id = $1 or $2::boolean)`, p)).rows[0];
        const adv = (await c.query(
          `select count(*) filter (where status = 'requested')::int as to_approve, coalesce(sum(amount) filter (where status = 'paid'), 0) as outstanding
           from advances where (requester_id = $1 or $2::boolean)`, p.slice(0, 2))).rows[0];
        const byCategory = (await c.query(
          `select l.category_code as code, l.category_name as name, sum(l.total) as total, max(cat.monthly_limit) as monthly_limit
           from claim_lines l join claims cl on cl.id = l.claim_id join expense_categories cat on cat.id = l.category_id
           where cl.status in ('submitted', 'approved', 'paid') and date_trunc('month', l.expense_date) = date_trunc('month', $3::date) and (cl.claimant_id = $1 or $2::boolean)
           group by l.category_code, l.category_name order by total desc`, p)).rows;
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month, coalesce(sum(cl.total), 0) as total, count(cl.id)::int as claims
           from generate_series(date_trunc('month', $3::date) - interval '5 months', date_trunc('month', $3::date), interval '1 month') m
           left join claims cl on date_trunc('month', cl.claim_date) = m and cl.status in ('submitted', 'approved', 'paid') and (cl.claimant_id = $1 or $2::boolean)
           group by m order by m`, p)).rows;
        const rows = (await c.query(
          `select id, no, purpose, claimant_name, total, status, over_limit from claims
           where status in ('submitted', 'returned', 'approved', 'paid') and (claimant_id = $1 or $2::boolean) order by updated_at desc limit 30`, p.slice(0, 2))).rows;
        return {
          toApprove: n.to_approve, overLimit: n.over_limit, toPay: n.to_pay, toPayAmount: n.to_pay_amount,
          paidThisMonth: n.paid_month, claimedThisMonth: n.claimed_month, myOpen: n.my_open,
          advancesToApprove: adv.to_approve, advancesOutstanding: adv.outstanding,
          byCategory, months, rows,
        };
      });
    });
  },

  handlers: {
    'automation.line_decision': async (e, ctx) => { if (e.target === 'expense.claim') await lineClaimDecision(e, ctx); },
    /** Accounting closed a period → payments dated up to its last day are locked (forward only). */
    'accounting.period_closed': async (e, { client }) => { await lockThroughPeriod(client, e.period, e.closedByName ?? 'ฝ่ายบัญชี (ปิดงวด)'); },
    'accounting.period_reopened': async (e, { client }) => { await unlockPeriod(client, e.period, e.reopenedByName ?? 'ฝ่ายบัญชี (เปิดงวด)'); },
  },
};
