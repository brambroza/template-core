/** Ledger core: chart setup, journal creation/validation, period guard and event auto-posting. */
import { badRequest, conflict, HttpError, nextDocNo, now, thaiDate, type Client } from '@erp/kernel';
import type { EventData } from '@erp/contracts';
import { calcVat, round } from '@erp/thai';
import { DEFAULT_CATEGORY_MAP, DEFAULT_RULES, EVENT_TH, PAYROLL_CATEGORY_TH, STANDARD_CHART, type PostedEvent } from './chart.ts';

/** journals that count in balances (a reversed entry still counts — its reversing entry offsets it) */
export const EFFECTIVE = `('posted', 'reversed')`;

export const money = (n: number) => round(n, 2).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Today in Bangkok as YYYY-MM-DD (kernel business clock), or the Bangkok day of `at`. */
export function todayTh(at: Date = now()): string {
  return thaiDate(at);
}

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
/** '2026-10' -> 'ตุลาคม 2569' */
export function periodTh(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${TH_MONTHS[m - 1]} ${y + 543}`;
}

/* ---------------- chart setup ---------------- */

/** Insert the standard chart + default posting rules that are missing (idempotent); default category mappings when the tenant has none. */
export async function seedChart(c: Client): Promise<{ accounts: number; rules: number; mappings: number }> {
  await c.query(`select pg_advisory_xact_lock(hashtext('accounting.setup:' || current_setting('app.tenant_id', true)))`);
  let accounts = 0;
  for (const s of STANDARD_CHART) {
    const r = await c.query(
      `insert into accounts (code, name, name_en, type, category, parent_id, is_group, role, is_system)
       values ($1, $2, $3, $4, $5, (select id from accounts where code = $6), $7, $8, true)
       on conflict (tenant_id, code) do nothing`,
      [s.code, s.name, s.nameEn, s.type, s.category, s.parent ?? null, !!s.group, s.role ?? null]);
    accounts += r.rowCount ?? 0;
  }
  let rules = 0;
  for (const [i, r] of DEFAULT_RULES.entries()) {
    const x = await c.query(
      `insert into posting_rules (event_type, leg, label, side, account_id, sort)
       values ($1, $2, $3, $4, (select id from accounts where code = $5 and active and not is_group), $6)
       on conflict (tenant_id, event_type, leg) do nothing`,
      [r.eventType, r.leg, r.label, r.side, r.code, i]);
    rules += x.rowCount ?? 0;
  }
  let mappings = 0;
  if (!(await c.query('select 1 from category_mappings limit 1')).rowCount) {
    for (const m of DEFAULT_CATEGORY_MAP) {
      const x = await c.query(
        `insert into category_mappings (category_code, category_name, account_id, is_default)
         select $1, $2, id, true from accounts where code = $3 and active and not is_group
         on conflict (tenant_id, lower(category_code)) do nothing`, [m.code, m.name, m.account]);
      mappings += x.rowCount ?? 0;
    }
  }
  return { accounts, rules, mappings };
}

/**
 * Lazily seed the standard chart the first time a tenant uses accounting — and again when a release added
 * default posting rules (e.g. payroll) that an existing tenant does not have yet (rules are never deleted, only re-mapped).
 */
export async function ensureChart(c: Client): Promise<void> {
  const r = await c.query(`select exists (select 1 from accounts) as a, (select count(*)::int from posting_rules) as r`);
  if (!r.rows[0].a || r.rows[0].r < DEFAULT_RULES.length) await seedChart(c);
}

/* ---------------- periods ---------------- */

export async function assertPeriodOpen(c: Client, date: string): Promise<void> {
  const period = date.slice(0, 7);
  const r = await c.query(`select status from fiscal_periods where period = $1`, [period]);
  if (r.rows[0]?.status === 'closed') throw conflict(`งวดบัญชี ${periodTh(period)} ปิดแล้ว — ต้องเปิดงวดก่อนจึงจะบันทึกรายการในงวดนี้ได้`);
}

/* ---------------- journals ---------------- */

export interface LineInput {
  accountId: string;
  debit?: number | null;
  credit?: number | null;
  description?: string | null;
  partnerId?: string | null;
  partnerName?: string | null;
  taxBase?: number | null;
  /** VAT lines (C7): the tax invoice behind this line — number/date and the other party's name, tax ID and branch (for the VAT registers) */
  taxInvoiceNo?: string | null;
  taxInvoiceDate?: string | null;
  taxPartyName?: string | null;
  taxPartyTaxId?: string | null;
  taxPartyBranch?: string | null;
  /** wave 9: on a credit / debit note's VAT line — the tax invoice it corrects (§86/9, §86/10) */
  taxRefInvoiceNo?: string | null;
  taxRefInvoiceDate?: string | null;
  /** wave 9: on a WHT-payable line — the return (ภ.ง.ด.3 / 53), income type, rate and 50 ทวิ certificate number */
  whtForm?: 'PND3' | 'PND53' | null;
  whtIncomeType?: string | null;
  whtRate?: number | null;
  whtCertificateNo?: string | null;
}

export interface JournalHeader {
  entryDate: string;
  description: string;
  ref?: string | null;
  note?: string | null;
  sourceType?: string;
  sourceId?: string | null;
  sourceEventId?: string | null;
  reversalOf?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
}

/** Validate lines: one side each, accounts exist / active / postable, debits = credits > 0. Returns cleaned lines + totals. */
export async function checkLines(c: Client, lines: LineInput[]) {
  const clean = lines.map((l, i) => ({
    ...l, n: i + 1, debit: round(Number(l.debit ?? 0), 2), credit: round(Number(l.credit ?? 0), 2),
  }));
  if (clean.length < 2) throw badRequest('สมุดรายวันต้องมีอย่างน้อย 2 บรรทัด (เดบิตและเครดิต)');
  for (const l of clean) {
    if ((l.debit > 0) === (l.credit > 0)) throw badRequest(`บรรทัดที่ ${l.n}: ใส่จำนวนเงินด้านเดบิตหรือเครดิตอย่างใดอย่างหนึ่ง (มากกว่า 0)`, { line: l.n });
  }
  const ids = [...new Set(clean.map((l) => l.accountId))];
  const accts = new Map((await c.query(`select id, code, name, active, is_group from accounts where id = any($1::uuid[])`, [ids])).rows.map((a) => [a.id, a]));
  for (const l of clean) {
    const a = accts.get(l.accountId);
    if (!a) throw badRequest(`บรรทัดที่ ${l.n}: ไม่พบรหัสบัญชี`, { line: l.n });
    if (a.is_group) throw badRequest(`บรรทัดที่ ${l.n}: ${a.code} ${a.name} เป็นบัญชีคุม (หัวข้อ) บันทึกรายการไม่ได้ — เลือกบัญชีย่อย`, { line: l.n });
    if (!a.active) throw badRequest(`บรรทัดที่ ${l.n}: บัญชี ${a.code} ${a.name} ปิดการใช้งานแล้ว`, { line: l.n });
  }
  const debit = round(clean.reduce((s, l) => s + l.debit, 0), 2);
  const credit = round(clean.reduce((s, l) => s + l.credit, 0), 2);
  if (debit !== credit) {
    throw badRequest(`รายการไม่สมดุล: เดบิตรวม ${money(debit)} ไม่เท่ากับเครดิตรวม ${money(credit)} (ต่างกัน ${money(Math.abs(debit - credit))})`,
      { debit, credit, difference: round(debit - credit, 2) });
  }
  return { lines: clean, debit, credit };
}

export async function writeLines(c: Client, journalId: string, lines: Awaited<ReturnType<typeof checkLines>>['lines']): Promise<void> {
  await c.query('delete from journal_lines where journal_id = $1', [journalId]);
  for (const l of lines) {
    await c.query(
      `insert into journal_lines (journal_id, line_no, account_id, description, debit, credit, partner_id, partner_name, tax_base,
         tax_invoice_no, tax_invoice_date, tax_party_name, tax_party_tax_id, tax_party_branch,
         tax_ref_invoice_no, tax_ref_invoice_date, wht_form, wht_income_type, wht_rate, wht_certificate_no)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [journalId, l.n, l.accountId, l.description || null, l.debit, l.credit, l.partnerId ?? null, l.partnerName || null, l.taxBase ?? null,
        l.taxInvoiceNo || null, isoDate(l.taxInvoiceDate), l.taxPartyName || null, l.taxPartyTaxId || null, l.taxPartyBranch || null,
        l.taxRefInvoiceNo || null, isoDate(l.taxRefInvoiceDate), l.whtForm || null, l.whtIncomeType || null, l.whtRate ?? null, l.whtCertificateNo || null]);
  }
}

/** Create a journal (validated). `posted` journals check the period first. Returns the new row. */
export async function createJournal(c: Client, h: JournalHeader, lines: LineInput[], status: 'draft' | 'posted', by?: { id?: string | null; name?: string | null }) {
  const checked = await checkLines(c, lines);
  if (status === 'posted') await assertPeriodOpen(c, h.entryDate);
  const no = await nextDocNo(c, 'JV', new Date(`${h.entryDate}T00:00:00Z`));
  const j = (await c.query(
    `insert into journal_entries (no, entry_date, description, ref, note, status, source_type, source_id, source_event_id, reversal_of,
       total_debit, total_credit, created_by, created_by_name, posted_at, posted_by, posted_by_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       case when $6 = 'posted' then now() end, case when $6 = 'posted' then $13::uuid end, case when $6 = 'posted' then $14 end)
     returning *`,
    [no, h.entryDate, h.description, h.ref || null, h.note || null, status, h.sourceType ?? 'manual', h.sourceId ?? null, h.sourceEventId ?? null,
      h.reversalOf ?? null, checked.debit, checked.credit, by?.id ?? h.createdBy ?? null, by?.name ?? h.createdByName ?? null])).rows[0];
  await writeLines(c, j.id, checked.lines);
  return j;
}

/* ---------------- auto-posting from events ---------------- */

/** A business reason why an event could not be posted (missing mapping, nothing to post…). Recorded, never thrown to the bus. */
export class PostingProblem extends Error {}

type Rules = Map<string, { accountId: string | null; label: string; ok: boolean; why?: string }>;

async function loadRules(c: Client, eventType: string): Promise<Rules> {
  const r = await c.query(
    `select r.leg, r.label, r.account_id, a.code, a.name, a.active, a.is_group
     from posting_rules r left join accounts a on a.id = r.account_id where r.event_type = $1`, [eventType]);
  return new Map(r.rows.map((x) => [x.leg, {
    accountId: x.account_id, label: x.label,
    ok: !!x.account_id && x.active && !x.is_group,
    why: !x.account_id ? 'ยังไม่ได้เลือกบัญชี' : !x.active ? `บัญชี ${x.code} ${x.name} ปิดการใช้งาน` : x.is_group ? `บัญชี ${x.code} เป็นบัญชีคุม` : undefined,
  }]));
}

function account(rules: Rules, eventType: string, leg: string): string {
  const r = rules.get(leg);
  if (!r) throw new PostingProblem(`ไม่มีกฎการลงบัญชี "${leg}" สำหรับ ${EVENT_TH[eventType] ?? eventType}`);
  if (!r.ok) throw new PostingProblem(`กฎการลงบัญชี ${EVENT_TH[eventType] ?? eventType} — "${r.label}": ${r.why}`);
  return r.accountId!;
}

export interface EventMeta {
  eventId: string | null;
  occurredAt: string;
}

/** source id (one journal per source document) and the document number shown to users */
export function sourceOf(type: PostedEvent, data: any, eventId: string | null): { sourceId: string; sourceNo: string } {
  switch (type) {
    case 'sales.invoiced': return { sourceId: data.invoiceId, sourceNo: data.invoiceNo };
    case 'sales.payment_received': return { sourceId: data.receiptId, sourceNo: data.receiptNo };
    case 'purchasing.goods_received': return { sourceId: eventId ?? `${data.poId}:${data.lines.map((l: any) => `${l.itemId}x${l.qty}`).join(',')}`, sourceNo: data.poNo };
    case 'purchasing.goods_returned': return { sourceId: data.returnId, sourceNo: data.returnNo };
    case 'expense.claim_paid': return { sourceId: data.claimId, sourceNo: data.no };
    case 'payroll.run_paid': return { sourceId: data.runId, sourceNo: data.no };
    case 'sales.note_issued': return { sourceId: data.noteId, sourceNo: data.noteNo };
    case 'purchasing.bill_recorded': return { sourceId: data.billId, sourceNo: data.billNo };
    case 'purchasing.supplier_paid': return { sourceId: data.paymentId, sourceNo: data.paymentNo };
  }
}

/** a YYYY-MM-DD date carried by the event (issue / paid / received date), else null */
export const isoDate = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** Expense-claim category → account id via `category_mappings` (code, then name); null = not mapped. Throws when the mapped account is unusable. */
async function categoryAccount(c: Client, code: string, name: string): Promise<string | null> {
  const r = (await c.query(
    `select m.account_id, a.code, a.name, a.active, a.is_group from category_mappings m join accounts a on a.id = m.account_id
     where lower(m.category_code) = lower($1) or (m.category_name is not null and lower(m.category_name) = lower($2))
     order by (lower(m.category_code) = lower($1)) desc limit 1`, [code, name])).rows[0];
  if (!r) return null;
  if (!r.active || r.is_group) throw new PostingProblem(`หมวดค่าใช้จ่าย ${code} ${name} จับคู่กับบัญชี ${r.code} ${r.name} ที่${r.is_group ? 'เป็นบัญชีคุม' : 'ปิดการใช้งาน'} — แก้ที่ "จับคู่หมวดค่าใช้จ่าย"`);
  return r.account_id;
}

/** VAT split of goods received/returned: the event's totals when present, else computed from `vatMode` + per-line `vatRate` (default 7%). */
function purchaseVat(e: { lines: { qty: number; unitPrice: number; vatRate?: number }[]; vatMode?: 'exclusive' | 'inclusive'; net?: number; vat?: number }):
  { net: number; vat: number; gross: number } | null {
  if (typeof e.net === 'number' && typeof e.vat === 'number') return { net: round(e.net, 2), vat: round(e.vat, 2), gross: round(e.net + e.vat, 2) };
  if (!e.vatMode) return null;
  const byRate = new Map<number, number>();
  for (const l of e.lines) byRate.set(l.vatRate ?? 0.07, (byRate.get(l.vatRate ?? 0.07) ?? 0) + round(l.qty * l.unitPrice, 2));
  let net = 0; let vat = 0;
  for (const [rate, amount] of byRate) {
    const v = calcVat(amount, e.vatMode, rate);
    net += v.net; vat += v.vat;
  }
  return { net: round(net, 2), vat: round(vat, 2), gross: round(net + vat, 2) };
}

const GR_NOTE = 'เหตุการณ์รับสินค้าไม่มีข้อมูลภาษีมูลค่าเพิ่ม: บันทึกมูลค่าตามราคาต่อหน่วยในใบสั่งซื้อ (ไม่แยกภาษีซื้อ) — บันทึกภาษีซื้อเมื่อได้รับใบกำกับภาษีจากผู้ขาย';

/** Build the journal for an event. Throws PostingProblem when a mapping is missing. Returns null when there is nothing to post (zero amounts). */
export interface Built {
  header: JournalHeader;
  lines: LineInput[];
  /** runs after the journal was written (journalId) — or, when `lines` is empty, instead of it (journalId null: nothing to post, e.g. a matched goods bill) */
  after?: (c: Client, journalId: string | null) => Promise<void>;
  /** shown when nothing was posted (retry toast) */
  message?: string;
}

export async function buildFromEvent(c: Client, type: PostedEvent, data: any, meta: EventMeta): Promise<Built | null> {
  const rules = await loadRules(c, type);
  const eventDay = todayTh(new Date(meta.occurredAt));
  /** the document's own date when the event carries one (wave 5), else the day the event happened (Bangkok) */
  const date = isoDate(data.issueDate ?? data.paidDate ?? data.receivedDate ?? data.returnDate ?? data.receiptDate ?? data.billDate ?? data.paymentDate) ?? eventDay;
  const { sourceId, sourceNo } = sourceOf(type, data, meta.eventId);
  const header: JournalHeader = { entryDate: date, description: '', ref: sourceNo, sourceType: type, sourceId, sourceEventId: meta.eventId };
  const lines: LineInput[] = [];
  const add = (leg: string, side: 'debit' | 'credit', amount: number, extra: Partial<LineInput> = {}) => {
    const v = round(amount, 2);
    if (v <= 0) return;
    lines.push({ accountId: account(rules, type, leg), [side]: v, ...extra });
  };

  switch (type) {
    case 'sales.invoiced': {
      const e = data as EventData<'sales.invoiced'>;
      const partner = { partnerId: e.customerId ?? null, partnerName: e.customerName ?? null };
      header.description = `ขายเชื่อตามใบกำกับภาษี ${e.invoiceNo}${e.customerName ? ` — ${e.customerName}` : ''}`;
      add('ar', 'debit', e.gross, { ...partner, description: e.dueDate ? `ครบกำหนดชำระ ${e.dueDate}` : null });
      // wave 8 (C2): deposits whose VAT was charged on a deposit tax invoice are deducted here — clear เงินมัดจำรับ (base), revenue at full value,
      // output VAT only on what remains (e.vat)
      const dep = e.depositApplied;
      if (dep) add('deposit', 'debit', dep.net, { ...partner, description: `หักเงินมัดจำ ${dep.deposits.map((d) => d.taxInvoiceNo ?? d.depositNo).join(', ')}`.slice(0, 500) });
      add('revenue', 'credit', round(e.gross - e.vat + (dep?.net ?? 0), 2), { ...partner });
      add('vat', 'credit', e.vat, { ...partner, taxBase: round(e.gross - e.vat, 2), description: `ภาษีขาย ${e.invoiceNo}`,
        taxInvoiceNo: e.invoiceNo, taxInvoiceDate: e.issueDate ?? date, taxPartyName: e.customerName ?? null, taxPartyTaxId: e.customerTaxId ?? null, taxPartyBranch: e.customerBranch ?? null });
      break;
    }
    case 'sales.payment_received': {
      const e = data as EventData<'sales.payment_received'>;
      const partner = { partnerId: e.customerId, partnerName: e.customerName };
      const leg = e.method === 'cash' ? 'cash' : 'bank';
      const via = { cash: 'เงินสด', transfer: 'โอนเงิน', cheque: 'เช็ค', card: 'บัตร' }[e.method];
      if (e.kind === 'deposit') {
        header.description = `รับเงินมัดจำ ${e.receiptNo}${e.taxInvoiceNo ? ` (ใบกำกับภาษี ${e.taxInvoiceNo})` : ''} — ${e.customerName}`;
        add(leg, 'debit', e.total, { ...partner, description: via });
        // wave 8 (C2): a deposit is a tax point — base to เงินมัดจำรับ, VAT to ภาษีขาย in the month it was received
        const vat = round(e.vat ?? 0, 2);
        const base = vat > 0 ? round(e.net ?? e.total - vat, 2) : e.total;
        add('deposit', 'credit', base, { ...partner });
        add('vat', 'credit', vat, { ...partner, taxBase: base, description: `ภาษีขาย (เงินมัดจำ) ${e.taxInvoiceNo ?? e.receiptNo}`,
          taxInvoiceNo: e.taxInvoiceNo ?? e.receiptNo, taxInvoiceDate: e.receiptDate ?? date, taxPartyName: e.customerName, taxPartyTaxId: e.customerTaxId ?? null, taxPartyBranch: e.customerBranch ?? null });
      } else {
        const invs = e.invoices.map((i) => i.invoiceNo).join(', ');
        header.description = `รับชำระหนี้ ${e.receiptNo} — ${e.customerName}`;
        add(leg, 'debit', e.received, { ...partner, description: via });
        add('wht', 'debit', e.whtAmount, { ...partner, description: `ลูกค้าหักภาษี ณ ที่จ่าย (รอหนังสือรับรอง 50 ทวิ) ${e.receiptNo}`, taxBase: e.whtBase ?? null });
        add('deposit', 'debit', e.depositApplied, { ...partner, description: 'หักเงินมัดจำรับ' });
        const settled = round(e.received + e.whtAmount + e.depositApplied, 2);
        add('ar', 'credit', settled, { ...partner, description: invs ? `ตัดหนี้ ${invs}` : null });
        if (Math.abs(settled - e.total) > 0.01) header.note = `ยอดรับ+ภาษีหัก+มัดจำ (${money(settled)}) ไม่เท่ากับยอดตามใบเสร็จ (${money(e.total)}) — ตัดลูกหนี้ตามเงินที่ได้รับจริง`;
      }
      break;
    }
    case 'purchasing.goods_received': {
      const e = data as EventData<'purchasing.goods_received'>;
      const amount = round(e.lines.reduce((s, l) => s + round(l.qty * l.unitPrice, 2), 0), 2);
      const partner = { partnerId: e.supplierId, partnerName: e.supplierName };
      const items = e.lines.map((l) => `${l.itemCode} × ${l.qty}`).join(', ').slice(0, 500);
      header.description = `รับสินค้าตามใบสั่งซื้อ ${e.poNo} — ${e.supplierName} (คลัง ${e.warehouseCode})`;
      const v = purchaseVat(e);
      if (v) {
        // stock at the price before VAT, ภาษีซื้อ separately, AP for the amount incl. VAT
        add('inventory', 'debit', v.net, { ...partner, description: items });
        // C8: the supplier's tax invoice (number/date/tax ID/branch keyed in at receipt) for the purchase VAT register
        add('vat', 'debit', v.vat, { ...partner, taxBase: v.net, description: `ภาษีซื้อ ${e.poNo}${e.supplierInvoiceNo ? ` ใบกำกับ ${e.supplierInvoiceNo}` : ''}`,
          taxInvoiceNo: e.supplierInvoiceNo ?? null, taxInvoiceDate: e.supplierInvoiceDate ?? null, taxPartyName: e.supplierName,
          taxPartyTaxId: e.supplierTaxId ?? null, taxPartyBranch: e.supplierBranch ?? null });
        add('ap', 'credit', v.gross, { ...partner });
      } else {
        header.note = GR_NOTE;
        add('inventory', 'debit', amount, { ...partner, description: items });
        add('ap', 'credit', amount, { ...partner });
      }
      break;
    }
    case 'purchasing.goods_returned': {
      const e = data as EventData<'purchasing.goods_returned'>;
      const amount = round(e.lines.reduce((s, l) => s + round(l.qty * l.unitPrice, 2), 0), 2);
      const partner = { partnerId: e.supplierId, partnerName: e.supplierName };
      const items = e.lines.map((l) => `${l.itemCode} × ${l.qty}`).join(', ').slice(0, 500);
      header.description = `ส่งคืนสินค้า ${e.returnNo} (ใบสั่งซื้อ ${e.poNo}) — ${e.supplierName}`;
      const v = purchaseVat(e);
      if (v) {
        add('ap', 'debit', v.gross, { ...partner });
        add('inventory', 'credit', v.net, { ...partner, description: items });
        add('vat', 'credit', v.vat, { ...partner, taxBase: v.net, description: `ลดภาษีซื้อ ${e.returnNo}`, taxPartyName: e.supplierName, taxInvoiceDate: e.returnDate ?? date });
      } else {
        header.note = 'มูลค่าตามราคาต่อหน่วยในใบสั่งซื้อ (ไม่แยกภาษีซื้อ) — ลดภาษีซื้อเมื่อได้รับใบลดหนี้จากผู้ขาย';
        add('ap', 'debit', amount, { ...partner });
        add('inventory', 'credit', amount, { ...partner, description: items });
      }
      break;
    }
    case 'expense.claim_paid': {
      const e = data as EventData<'expense.claim_paid'>;
      const partner = { partnerId: e.claimantId ?? null, partnerName: e.claimantName };
      const payLeg = e.payMethod === 'cash' ? 'cash' : 'bank';
      header.description = `จ่ายเงินตามใบเบิกค่าใช้จ่าย ${e.no}${e.claimantName ? ` — ${e.claimantName}` : ''}`;
      const notes: string[] = [];
      if (e.lines?.length) {
        // one debit per expense account (category → account map; unmapped → the `expense` rule), input VAT on its own line
        // C3: VAT that cannot be credited (vatClaimable false: ภาษีซื้อต้องห้าม, abbreviated / no tax invoice, no seller tax ID) is part of the expense
        const byAccount = new Map<string, { amount: number; names: Set<string> }>();
        const unmapped = new Set<string>();
        let expensedVat = 0;
        for (const l of e.lines) {
          const mapped = await categoryAccount(c, l.categoryCode, l.categoryName);
          if (!mapped) unmapped.add(`${l.categoryCode} ${l.categoryName}`);
          const acc = mapped ?? account(rules, type, 'expense');
          const cur = byAccount.get(acc) ?? { amount: 0, names: new Set<string>() };
          const vatToExpense = l.vatClaimable === false ? l.vat : 0;
          expensedVat = round(expensedVat + vatToExpense, 2);
          cur.amount = round(cur.amount + l.amount + vatToExpense, 2);
          cur.names.add(l.categoryName);
          byAccount.set(acc, cur);
        }
        for (const [accountId, x] of byAccount) {
          if (x.amount > 0) lines.push({ accountId, debit: x.amount, description: [...x.names].join(', ').slice(0, 500), ...partner });
        }
        const claimable = e.lines.filter((l) => l.vat > 0 && l.vatClaimable !== false);
        if (claimable.some((l) => l.vendorTaxId || l.receiptNo)) {
          // one ภาษีซื้อ line per seller tax invoice (C7: the register shows the seller, not the employee)
          for (const l of claimable) {
            add('vat', 'debit', l.vat, { ...partner, taxBase: l.amount, description: `ภาษีซื้อตามใบเบิก ${e.no}${l.receiptNo ? ` ใบกำกับ ${l.receiptNo}` : ''}`,
              taxInvoiceNo: l.receiptNo ?? null, taxInvoiceDate: l.expenseDate ?? null, taxPartyName: l.vendorName ?? null, taxPartyTaxId: l.vendorTaxId ?? null, taxPartyBranch: l.vendorBranch ?? null });
          }
        } else {
          const vat = round(claimable.reduce((s, l) => s + l.vat, 0), 2);
          const base = round(claimable.reduce((s, l) => s + l.amount, 0), 2);
          add('vat', 'debit', vat, { ...partner, taxBase: base, description: `ภาษีซื้อตามใบเบิก ${e.no}` });
        }
        if (expensedVat > 0) notes.push(`ภาษีซื้อที่เครดิตไม่ได้ ${money(expensedVat)} บาท (ภาษีซื้อต้องห้าม / ใบกำกับอย่างย่อหรือไม่มีใบกำกับเต็มรูป) ลงเป็นค่าใช้จ่าย`);
        const paid = round(e.lines.reduce((s, l) => s + l.amount + l.vat, 0), 2);
        add(payLeg, 'credit', paid, { ...partner });
        if (unmapped.size) notes.push(`หมวดที่ยังไม่จับคู่บัญชี (ลงบัญชีค่าใช้จ่ายตามกฎ): ${[...unmapped].join(', ')}`);
        if (Math.abs(paid - e.total) > 0.01) notes.push(`ยอดรวมรายการ (${money(paid)}) ไม่เท่ากับยอดใบเบิก (${money(e.total)})`);
      } else {
        notes.push('เหตุการณ์ไม่มีหมวดค่าใช้จ่ายและ VAT แยก: บันทึกยอดรวมเข้าบัญชีค่าใช้จ่ายตามกฎ — โอนเข้าบัญชีค่าใช้จ่ายที่ถูกต้อง/ภาษีซื้อด้วยสมุดรายวันถ้าจำเป็น');
        add('expense', 'debit', e.total, { ...partner });
        add(payLeg, 'credit', e.total, { ...partner });
      }
      if (e.advanceAmount) notes.push(`หักล้างเงินทดรองจ่าย ${e.advanceNo ?? ''} ${money(e.advanceAmount)} บาท — จ่ายเพิ่มครั้งนี้ ${money(e.total - e.advanceAmount)} บาท (การจ่ายเงินทดรองไม่ได้ลงบัญชีอัตโนมัติ จึงบันทึกยอดเต็มจาก${payLeg === 'cash' ? 'เงินสด' : 'เงินฝาก'})`);
      header.note = notes.join(' · ') || null;
      break;
    }
    case 'payroll.run_paid': {
      const e = data as EventData<'payroll.run_paid'>;
      header.description = `จ่ายเงินเดือน ${e.no} งวด ${periodTh(e.period)} — ${e.headcount} คน`;
      header.note = `ยอดรวมทั้งบริษัทจากระบบเงินเดือน: เงินได้รวม ${money(e.totals.gross)} · หักรวม ${money(e.totals.totalDeductions)} · จ่ายสุทธิ ${money(e.totals.net)}`;
      for (const p of e.postings) add(p.category, p.side, p.amount, { description: PAYROLL_CATEGORY_TH[p.category] ?? p.category });
      break;
    }
    case 'sales.note_issued': return noteJournal(rules, data as EventData<'sales.note_issued'>, header);
    case 'purchasing.bill_recorded': return billJournal(c, rules, data as EventData<'purchasing.bill_recorded'>, header, meta);
    case 'purchasing.supplier_paid': return paymentJournal(rules, data as EventData<'purchasing.supplier_paid'>, header);
  }
  return lines.length ? { header, lines } : null;
}

/* ---------------- wave 9: credit/debit notes, supplier bills, supplier payments ---------------- */

type Add = (leg: string, side: 'debit' | 'credit', amount: number, extra?: Partial<LineInput>) => void;
function adder(rules: Rules, type: string, lines: LineInput[]): Add {
  return (leg, side, amount, extra = {}) => {
    const v = round(amount, 2);
    if (v <= 0) return;
    lines.push({ accountId: account(rules, type, leg), [side]: v, ...extra });
  };
}

/**
 * ใบลดหนี้ (§86/10) / ใบเพิ่มหนี้ (§86/9) against a sales tax invoice. `net`/`vat` are the difference (always positive).
 * Credit: Dr รับคืนและส่วนลดจ่าย (contra revenue, rule `returns`) net + Dr ภาษีขาย vat / Cr ลูกหนี้ gross.
 * Debit:  Dr ลูกหนี้ gross / Cr รายได้จากการขาย (rule `revenue`) net + Cr ภาษีขาย vat.
 * The VAT line is dated in the note's month (the output VAT of the month the note is issued is reduced/increased — §82/10, §82/9)
 * and carries the note number, the original invoice and the customer's tax ID / branch for the output VAT register.
 */
function noteJournal(rules: Rules, e: EventData<'sales.note_issued'>, header: JournalHeader): Built | null {
  const lines: LineInput[] = [];
  const add = adder(rules, 'sales.note_issued', lines);
  const partner = { partnerId: e.customerId, partnerName: e.customerName };
  const credit = e.kind === 'credit';
  const doc = credit ? 'ใบลดหนี้' : 'ใบเพิ่มหนี้';
  const net = round(e.net, 2);
  const vat = round(e.vat, 2);
  const gross = round(net + vat, 2);
  header.description = `${doc} ${e.noteNo} (อ้างอิงใบกำกับภาษี ${e.invoiceNo}) — ${e.customerName}`;
  const notes = [`เหตุผล: ${e.reason}`, `มูลค่าตามใบกำกับเดิม ${money(e.originalNet)} · มูลค่าที่ถูกต้อง ${money(e.correctNet)} · ผลต่าง ${money(net)}`];
  if (Math.abs(gross - e.gross) > 0.01) notes.push(`ผลต่าง+ภาษี (${money(gross)}) ไม่เท่ากับยอดรวมในเอกสาร (${money(e.gross)}) — ลงลูกหนี้ตามผลต่าง+ภาษี`);
  const tax: Partial<LineInput> = {
    ...partner, taxBase: net, description: `ภาษีขายตาม${doc} ${e.noteNo} (ใบกำกับเดิม ${e.invoiceNo})`,
    taxInvoiceNo: e.noteNo, taxInvoiceDate: e.issueDate, taxPartyName: e.customerName, taxPartyTaxId: e.customerTaxId ?? null, taxPartyBranch: e.customerBranch ?? null,
    taxRefInvoiceNo: e.invoiceNo, taxRefInvoiceDate: e.invoiceDate,
  };
  if (credit) {
    add('returns', 'debit', net, { ...partner, description: `${doc} ${e.noteNo}: ${e.reason}`.slice(0, 500) });
    add('vat', 'debit', vat, tax);
    add('ar', 'credit', gross, { ...partner, description: `ลดหนี้ใบกำกับ ${e.invoiceNo}` });
  } else {
    add('ar', 'debit', gross, { ...partner, description: `เพิ่มหนี้ใบกำกับ ${e.invoiceNo}` });
    add('revenue', 'credit', net, { ...partner, description: `${doc} ${e.noteNo}: ${e.reason}`.slice(0, 500) });
    add('vat', 'credit', vat, tax);
  }
  header.note = notes.join(' · ').slice(0, 2000);
  return lines.length ? { header, lines } : null;
}

const BILL_KIND_TH = { goods: 'ค่าสินค้า', service: 'ค่าบริการ', expense: 'ค่าใช้จ่าย' } as const;
/** calendar months from the month of `a` to the month of `b` (Jan → Jul = 6) */
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) * 12 + Number(b.slice(5, 7))) - (Number(a.slice(0, 4)) * 12 + Number(a.slice(5, 7)));

/**
 * A supplier bill (ตั้งหนี้). Decision (wave 9) — goods receipts already post Dr สินค้า + Dr ภาษีซื้อ / Cr เจ้าหนี้ at receipt
 * (`purchasing.goods_received`), so there is no GRNI account in this chart and a `goods` bill is a MATCH, not a second AP:
 *  - claimable VAT, receipt booked ภาษีซื้อ        → no journal (treatment `matched`); the supplier's tax invoice no/date/tax ID are filled into the
 *                                                     receipt's ภาษีซื้อ lines that had none, so the purchase VAT register shows the real tax invoice;
 *  - claimable VAT, receipt booked no VAT (old)     → Dr ภาษีซื้อ / Cr สินค้าคงเหลือ (VAT was in the stock value) or Cr เจ้าหนี้ (the receipt was
 *                                                     booked before VAT — AP short by the VAT) — `vat_reclassed`;
 *  - non-claimable VAT (§82/5), receipt booked VAT → Dr สินค้าคงเหลือ / Cr ภาษีซื้อ (the VAT becomes cost; negative line in the register);
 *  - price differences vs the receipt are NOT posted (noted on the bill / JV) — book them by JV.
 * `service` / `expense`: Dr rule `service` (53400) / `expense` (53900) net (+ VAT when not claimable) + Dr ภาษีซื้อ (claimable) / Cr เจ้าหนี้.
 * Input VAT is credited in the month the bill is booked; §82/3 allows the month of the tax invoice or up to 6 months later — older invoices get a note.
 */
async function billJournal(c: Client, rules: Rules, e: EventData<'purchasing.bill_recorded'>, header: JournalHeader, meta: EventMeta): Promise<Built> {
  const type = 'purchasing.bill_recorded';
  const lines: LineInput[] = [];
  const add = adder(rules, type, lines);
  const partner = { partnerId: e.supplierId, partnerName: e.supplierName };
  const net = round(e.net, 2);
  const vat = round(e.vat, 2);
  const taxDoc: Partial<LineInput> = {
    ...partner, taxBase: net, taxInvoiceNo: e.supplierInvoiceNo ?? e.billNo, taxInvoiceDate: e.supplierInvoiceDate ?? e.billDate,
    taxPartyName: e.supplierName, taxPartyTaxId: e.supplierTaxId, taxPartyBranch: e.supplierBranch ?? null,
  };
  header.description = `ตั้งหนี้ ${e.billNo} ${BILL_KIND_TH[e.kind]}${e.supplierInvoiceNo ? ` ใบกำกับ ${e.supplierInvoiceNo}` : ''}${e.poNo ? ` (ใบสั่งซื้อ ${e.poNo})` : ''} — ${e.supplierName}`;
  const notes: string[] = [];
  // §82/3 วรรคสอง: input tax may be claimed in the month of the tax invoice or within the 6 following months
  if (vat > 0 && e.vatClaimable && e.supplierInvoiceDate && monthsBetween(e.supplierInvoiceDate, e.billDate) > 6) {
    notes.push(`ใบกำกับภาษีลงวันที่ ${e.supplierInvoiceDate} เกิน 6 เดือนนับจากเดือนที่ออก — ตรวจสอบสิทธิ์ขอเครดิตภาษีซื้อ (มาตรา 82/3)`);
  }
  let treatment: 'posted' | 'matched' | 'vat_reclassed' = 'posted';
  let fillReceipts: string[] = [];
  let message: string | undefined;

  if (e.kind !== 'goods') {
    const cost = round(net + (e.vatClaimable ? 0 : vat), 2);
    add(e.kind, 'debit', cost, { ...partner, description: `${BILL_KIND_TH[e.kind]} ${e.supplierInvoiceNo ?? e.billNo}` });
    if (e.vatClaimable) add('vat', 'debit', vat, { ...taxDoc, description: `ภาษีซื้อ ${e.billNo}${e.supplierInvoiceNo ? ` ใบกำกับ ${e.supplierInvoiceNo}` : ''}` });
    else if (vat > 0) notes.push(`ภาษีซื้อ ${money(vat)} บาท ขอเครดิตไม่ได้ (มาตรา 82/5) — รวมเป็นค่าใช้จ่าย`);
    const ap = round(cost + (e.vatClaimable ? vat : 0), 2);
    add('ap', 'credit', ap, { ...partner, description: e.dueDate ? `ครบกำหนดชำระ ${e.dueDate}` : null });
    if (Math.abs(ap - e.gross) > 0.01) notes.push(`ยอดสุทธิ+ภาษี (${money(ap)}) ไม่เท่ากับยอดรวมในใบแจ้งหนี้ (${money(e.gross)})`);
  } else {
    if (!e.poNo) throw new PostingProblem(`ใบแจ้งหนี้ค่าสินค้า ${e.billNo} ไม่ระบุใบสั่งซื้อ — จับคู่กับการรับสินค้าไม่ได้; บันทึกด้วยสมุดรายวัน`);
    // the PO's receipts still in force (a reversed receipt and its reversal cancel out, so only `posted` ones count)
    const rec = (await c.query(
      `select count(distinct j.id)::int as n, coalesce(array_agg(distinct j.id) filter (where a.role = 'vat_input'), '{}') as vat_journals,
         coalesce(sum(l.debit - l.credit) filter (where a.role = 'vat_input'), 0) as vat,
         coalesce(sum(l.credit), 0) as ap
       from journal_entries j join journal_lines l on l.journal_id = j.id join accounts a on a.id = l.account_id
       where j.source_type = 'purchasing.goods_received' and j.ref = $1 and j.status = 'posted'`, [e.poNo])).rows[0];
    if (!rec.n) {
      throw new PostingProblem(`ยังไม่พบการรับสินค้าของใบสั่งซื้อ ${e.poNo} ที่ลงบัญชีแล้ว — ใบแจ้งหนี้ค่าสินค้าจับคู่กับการรับสินค้า (เจ้าหนี้ลงบัญชีตอนรับสินค้า); กด "ลงบัญชีอีกครั้ง" หลังรับสินค้า`);
    }
    const receiptVat = round(Number(rec.vat), 2);
    const bookedAp = round(Number(rec.ap), 2);
    const billedBefore = round(Number((await c.query(`select coalesce(sum(gross), 0) as g from supplier_bills where kind = 'goods' and po_no = $1`, [e.poNo])).rows[0].g), 2);
    let apAdded = 0;
    if (vat > 0 && e.vatClaimable && receiptVat > 0) {
      treatment = 'matched';
      if (e.supplierInvoiceNo) fillReceipts = rec.vat_journals;
      message = `ใบแจ้งหนี้ ${e.billNo} จับคู่กับการรับสินค้าของ ${e.poNo} แล้ว — เจ้าหนี้และภาษีซื้อลงบัญชีตอนรับสินค้า จึงไม่ลงซ้ำ`;
    } else if (vat > 0 && e.vatClaimable) {
      treatment = 'vat_reclassed';
      // the receipt carried no VAT split: either the stock value included the VAT, or AP was booked before VAT (short by the VAT)
      const apShort = round(billedBefore + e.gross - bookedAp, 2) >= vat - 0.01;
      add('vat', 'debit', vat, { ...taxDoc, description: `ภาษีซื้อ ${e.billNo} ใบกำกับ ${e.supplierInvoiceNo ?? '-'} (รับสินค้าไม่ได้แยก VAT)` });
      if (apShort) { add('ap', 'credit', vat, { ...partner, description: `VAT ตามใบแจ้งหนี้ ${e.billNo}` }); apAdded = vat; }
      else add('inventory', 'credit', vat, { ...partner, description: `แยก VAT ออกจากมูลค่าสินค้า ${e.poNo}` });
    } else if (vat > 0 && receiptVat > 0) {
      treatment = 'vat_reclassed';
      add('inventory', 'debit', vat, { ...partner, description: `ภาษีซื้อขอเครดิตไม่ได้ โอนเข้าต้นทุนสินค้า ${e.poNo} (มาตรา 82/5)` });
      add('vat', 'credit', vat, { ...taxDoc, description: `กลับภาษีซื้อที่ขอเครดิตไม่ได้ ${e.billNo}` });
    } else {
      treatment = 'matched';
      message = `ใบแจ้งหนี้ ${e.billNo} จับคู่กับการรับสินค้าของ ${e.poNo} แล้ว — ไม่มีภาษีซื้อที่ต้องปรับ`;
    }
    const over = round(billedBefore + e.gross - bookedAp - apAdded, 2);
    if (over > 0.01) {
      notes.push(`ยอดใบแจ้งหนี้ค่าสินค้าของ ${e.poNo} รวม ${money(billedBefore + e.gross)} เกินเจ้าหนี้ที่ตั้งไว้ตอนรับสินค้า ${money(bookedAp + apAdded)} อยู่ ${money(over)} บาท — ส่วนต่างราคา/ค่าขนส่งไม่ลงบัญชีอัตโนมัติ บันทึกด้วยสมุดรายวัน`);
    }
  }
  const note = notes.join(' · ').slice(0, 2000) || null;
  header.note = note;
  const after = async (cc: Client, journalId: string | null) => {
    await cc.query(
      `insert into supplier_bills (bill_id, bill_no, bill_date, due_date, supplier_id, supplier_name, supplier_tax_id, supplier_branch, supplier_invoice_no, supplier_invoice_date,
         kind, po_no, net, vat, gross, vat_claimable, treatment, journal_id, note, event_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       on conflict (tenant_id, bill_id) do nothing`,
      [e.billId, e.billNo, e.billDate, isoDate(e.dueDate), e.supplierId, e.supplierName, e.supplierTaxId, e.supplierBranch ?? null, e.supplierInvoiceNo,
        isoDate(e.supplierInvoiceDate), e.kind, e.poNo ?? null, net, vat, round(e.gross, 2), e.vatClaimable, journalId ? treatment : 'matched', journalId, note, meta.eventId]);
    if (fillReceipts.length) {
      // metadata only (no amounts change): the receipt's ภาษีซื้อ now names the supplier's tax invoice in the register
      await cc.query(
        `update journal_lines l set tax_invoice_no = $2, tax_invoice_date = coalesce($3, l.tax_invoice_date), tax_party_tax_id = coalesce(l.tax_party_tax_id, $4),
           tax_party_branch = coalesce(l.tax_party_branch, $5)
         from accounts a where a.id = l.account_id and a.role = 'vat_input' and l.journal_id = any($1::uuid[]) and l.tax_invoice_no is null and l.debit > 0`,
        [fillReceipts, e.supplierInvoiceNo, isoDate(e.supplierInvoiceDate), e.supplierTaxId, e.supplierBranch ?? null]);
    }
  };
  return { header, lines, after, message };
}

const WHT_FORM_TH = { PND3: 'ภ.ง.ด.3', PND53: 'ภ.ง.ด.53' } as const;

/**
 * A supplier payment (PV) with WHT withheld (§50 ประมวลรัษฎากร; ท.ป.4/2528 rates): Dr เจ้าหนี้ (net paid + WHT) / Cr เงินฝาก or เงินสด (net paid)
 * / Cr ภาษีหัก ณ ที่จ่ายค้างจ่าย — 21310 for ภ.ง.ด.3 (individuals) and 21320 for ภ.ง.ด.53 (juristic persons), one line per 50 ทวิ row carrying the
 * form, income type, rate, base and certificate number (WHT-payable report). Remitted by the 7th of the next month (e-Filing +8 days).
 */
function paymentJournal(rules: Rules, e: EventData<'purchasing.supplier_paid'>, header: JournalHeader): Built | null {
  const lines: LineInput[] = [];
  const add = adder(rules, 'purchasing.supplier_paid', lines);
  const partner = { partnerId: e.supplierId, partnerName: e.supplierName };
  header.description = `จ่ายชำระเจ้าหนี้ ${e.paymentNo} — ${e.supplierName}`;
  const notes: string[] = [];
  const wht = e.wht.filter((w) => round(w.amount, 2) > 0);
  const whtTotal = round(wht.reduce((s, w) => s + round(w.amount, 2), 0), 2);
  const settled = round(e.netPaid + whtTotal, 2);
  const bills = e.bills.map((b) => b.billNo).join(', ');
  add('ap', 'debit', settled, { ...partner, description: bills ? `ตัดหนี้ ${bills}`.slice(0, 500) : null });
  add(e.method === 'cash' ? 'cash' : 'bank', 'credit', e.netPaid, { ...partner, description: { cash: 'เงินสด', transfer: 'โอนเงิน', cheque: 'เช็ค' }[e.method] });
  for (const w of wht) {
    add(w.form === 'PND3' ? 'wht_pnd3' : 'wht_pnd53', 'credit', w.amount, {
      ...partner, taxBase: round(w.base, 2),
      description: `${WHT_FORM_TH[w.form]} ${w.incomeType} ${w.description} ${round(w.rate * 100, 2)}% — 50 ทวิ ${w.certificateNo}`.slice(0, 500),
      taxPartyName: e.supplierName, taxPartyTaxId: e.supplierTaxId,
      whtForm: w.form, whtIncomeType: w.incomeType, whtRate: w.rate, whtCertificateNo: w.certificateNo,
    });
    if (Math.abs(round(w.base * w.rate, 2) - round(w.amount, 2)) > 0.01) notes.push(`50 ทวิ ${w.certificateNo}: ภาษีที่หัก ${money(w.amount)} ≠ ฐาน ${money(w.base)} × ${round(w.rate * 100, 2)}% — ตรวจสอบ`);
  }
  if (Math.abs(settled - e.gross) > 0.01) notes.push(`จ่ายสุทธิ+ภาษีหัก (${money(settled)}) ไม่เท่ากับยอดตัดหนี้ (${money(e.gross)}) — ตัดเจ้าหนี้ตามเงินที่จ่ายจริง+ภาษีหัก`);
  header.note = notes.join(' · ').slice(0, 2000) || null;
  return lines.length ? { header, lines } : null;
}

export type PostResult = { status: 'posted'; journal: any } | { status: 'duplicate' } | { status: 'skipped'; message?: string } | { status: 'error'; reason: string };

/**
 * Post an event's journal inside a savepoint. Never throws for business reasons: a missing mapping or a closed period
 * is recorded in `posting_errors` (one row per event, updated on retry) so the bus never re-delivers forever.
 */
export async function postEvent(c: Client, type: PostedEvent, data: any, meta: EventMeta, by?: { name?: string | null }): Promise<PostResult> {
  await ensureChart(c);
  const { sourceId, sourceNo } = sourceOf(type, data, meta.eventId);
  const dup = await c.query(`select id from journal_entries where source_type = $1 and source_id = $2 and status <> 'cancelled' limit 1`, [type, sourceId]);
  if (dup.rowCount) {
    if (meta.eventId) await c.query(`update posting_errors set status = 'resolved', journal_id = $2, resolved_at = now() where event_id = $1 and status = 'open'`, [meta.eventId, dup.rows[0].id]);
    return { status: 'duplicate' };
  }
  // wave 9: a supplier bill is recorded in `supplier_bills` even when it posts no journal (matched goods bill)
  if (type === 'purchasing.bill_recorded' && (await c.query('select 1 from supplier_bills where bill_id = $1', [sourceId])).rowCount) {
    if (meta.eventId) await c.query(`update posting_errors set status = 'resolved', resolved_at = now() where event_id = $1 and status = 'open'`, [meta.eventId]);
    return { status: 'duplicate' };
  }
  await c.query('savepoint accounting_autopost');
  try {
    const built = await buildFromEvent(c, type, data, meta);
    if (!built || !built.lines.length) {
      if (built?.after) await built.after(c, null);
      await c.query('release savepoint accounting_autopost');
      if (built?.after && meta.eventId) {
        await c.query(`update posting_errors set status = 'resolved', resolved_at = now(), resolved_by_name = $2 where event_id = $1 and status = 'open'`, [meta.eventId, by?.name ?? null]);
      }
      return { status: 'skipped', message: built?.message };
    }
    const j = await createJournal(c, built.header, built.lines, 'posted', { id: null, name: by?.name ?? 'ระบบ (ลงบัญชีอัตโนมัติ)' });
    if (built.after) await built.after(c, j.id);
    await c.query('release savepoint accounting_autopost');
    if (meta.eventId) {
      await c.query(`update posting_errors set status = 'resolved', journal_id = $2, resolved_at = now(), resolved_by_name = $3 where event_id = $1 and status = 'open'`,
        [meta.eventId, j.id, by?.name ?? null]);
    }
    return { status: 'posted', journal: j };
  } catch (err) {
    await c.query('rollback to savepoint accounting_autopost');
    const reason = err instanceof PostingProblem || err instanceof HttpError ? err.message : `ข้อผิดพลาดระบบ: ${(err as Error)?.message ?? String(err)}`;
    if (meta.eventId) {
      await c.query(
        `insert into posting_errors (event_id, event_type, source_id, source_no, occurred_at, reason, payload)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (tenant_id, event_id) where event_id is not null
         do update set reason = excluded.reason, attempts = posting_errors.attempts + 1, status = 'open'`,
        [meta.eventId, type, sourceId, sourceNo, meta.occurredAt, reason, JSON.stringify(data)]);
    }
    return { status: 'error', reason };
  }
}
