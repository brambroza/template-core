/** Ledger core: chart setup, journal creation/validation, period guard and event auto-posting. */
import { badRequest, conflict, HttpError, nextDocNo, type Client } from '@erp/kernel';
import type { EventData } from '@erp/contracts';
import { round } from '@erp/thai';
import { DEFAULT_RULES, EVENT_TH, STANDARD_CHART, type PostedEvent } from './chart.ts';

/** journals that count in balances (a reversed entry still counts — its reversing entry offsets it) */
export const EFFECTIVE = `('posted', 'reversed')`;

export const money = (n: number) => round(n, 2).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Today in Bangkok as YYYY-MM-DD. */
export function todayTh(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
/** '2026-10' -> 'ตุลาคม 2569' */
export function periodTh(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${TH_MONTHS[m - 1]} ${y + 543}`;
}

/* ---------------- chart setup ---------------- */

/** Insert the standard chart + default posting rules that are missing (idempotent). */
export async function seedChart(c: Client): Promise<{ accounts: number; rules: number }> {
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
  return { accounts, rules };
}

/** Lazily seed the standard chart the first time a tenant uses accounting. */
export async function ensureChart(c: Client): Promise<void> {
  const r = await c.query(`select exists (select 1 from accounts) as a, exists (select 1 from posting_rules) as r`);
  if (!r.rows[0].a || !r.rows[0].r) await seedChart(c);
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
      `insert into journal_lines (journal_id, line_no, account_id, description, debit, credit, partner_id, partner_name, tax_base)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [journalId, l.n, l.accountId, l.description || null, l.debit, l.credit, l.partnerId ?? null, l.partnerName || null, l.taxBase ?? null]);
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
  }
}

const GR_NOTE = 'เหตุการณ์รับสินค้าไม่มีข้อมูลภาษีมูลค่าเพิ่ม: บันทึกมูลค่าตามราคาต่อหน่วยในใบสั่งซื้อ (ไม่แยกภาษีซื้อ) — บันทึกภาษีซื้อเมื่อได้รับใบกำกับภาษีจากผู้ขาย';

/** Build the journal for an event. Throws PostingProblem when a mapping is missing. Returns null when there is nothing to post (zero amounts). */
export async function buildFromEvent(c: Client, type: PostedEvent, data: any, meta: EventMeta): Promise<{ header: JournalHeader; lines: LineInput[] } | null> {
  const rules = await loadRules(c, type);
  const date = todayTh(new Date(meta.occurredAt));
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
      add('revenue', 'credit', round(e.gross - e.vat, 2), { ...partner });
      add('vat', 'credit', e.vat, { ...partner, taxBase: round(e.gross - e.vat, 2), description: `ภาษีขาย ${e.invoiceNo}` });
      break;
    }
    case 'sales.payment_received': {
      const e = data as EventData<'sales.payment_received'>;
      const partner = { partnerId: e.customerId, partnerName: e.customerName };
      const leg = e.method === 'cash' ? 'cash' : 'bank';
      const via = { cash: 'เงินสด', transfer: 'โอนเงิน', cheque: 'เช็ค', card: 'บัตร' }[e.method];
      if (e.kind === 'deposit') {
        header.description = `รับเงินมัดจำ ${e.receiptNo} — ${e.customerName}`;
        add(leg, 'debit', e.total, { ...partner, description: via });
        add('deposit', 'credit', e.total, { ...partner });
      } else {
        const invs = e.invoices.map((i) => i.invoiceNo).join(', ');
        header.description = `รับชำระหนี้ ${e.receiptNo} — ${e.customerName}`;
        add(leg, 'debit', e.received, { ...partner, description: via });
        add('wht', 'debit', e.whtAmount, { ...partner, description: `ลูกค้าหักภาษี ณ ที่จ่าย (รอหนังสือรับรอง 50 ทวิ) ${e.receiptNo}` });
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
      header.description = `รับสินค้าตามใบสั่งซื้อ ${e.poNo} — ${e.supplierName} (คลัง ${e.warehouseCode})`;
      header.note = GR_NOTE;
      add('inventory', 'debit', amount, { ...partner, description: e.lines.map((l) => `${l.itemCode} × ${l.qty}`).join(', ').slice(0, 500) });
      add('ap', 'credit', amount, { ...partner });
      break;
    }
    case 'purchasing.goods_returned': {
      const e = data as EventData<'purchasing.goods_returned'>;
      const amount = round(e.lines.reduce((s, l) => s + round(l.qty * l.unitPrice, 2), 0), 2);
      const partner = { partnerId: e.supplierId, partnerName: e.supplierName };
      header.description = `ส่งคืนสินค้า ${e.returnNo} (ใบสั่งซื้อ ${e.poNo}) — ${e.supplierName}`;
      header.note = 'มูลค่าตามราคาต่อหน่วยในใบสั่งซื้อ (ไม่แยกภาษีซื้อ) — ลดภาษีซื้อเมื่อได้รับใบลดหนี้จากผู้ขาย';
      add('ap', 'debit', amount, { ...partner });
      add('inventory', 'credit', amount, { ...partner, description: e.lines.map((l) => `${l.itemCode} × ${l.qty}`).join(', ').slice(0, 500) });
      break;
    }
    case 'expense.claim_paid': {
      const e = data as EventData<'expense.claim_paid'>;
      const partner = { partnerId: e.claimantId ?? null, partnerName: e.claimantName };
      header.description = `จ่ายเงินตามใบเบิกค่าใช้จ่าย ${e.no}${e.claimantName ? ` — ${e.claimantName}` : ''}`;
      header.note = 'เหตุการณ์ไม่มีหมวดค่าใช้จ่ายและ VAT แยก: บันทึกยอดรวมเข้าบัญชีค่าใช้จ่ายตามกฎ — โอนเข้าบัญชีค่าใช้จ่ายที่ถูกต้อง/ภาษีซื้อด้วยสมุดรายวันถ้าจำเป็น';
      add('expense', 'debit', e.total, { ...partner });
      add('bank', 'credit', e.total, { ...partner });
      break;
    }
  }
  return lines.length ? { header, lines } : null;
}

export type PostResult = { status: 'posted'; journal: any } | { status: 'duplicate' | 'skipped' } | { status: 'error'; reason: string };

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
  await c.query('savepoint accounting_autopost');
  try {
    const built = await buildFromEvent(c, type, data, meta);
    if (!built) {
      await c.query('release savepoint accounting_autopost');
      return { status: 'skipped' };
    }
    const j = await createJournal(c, built.header, built.lines, 'posted', { id: null, name: by?.name ?? 'ระบบ (ลงบัญชีอัตโนมัติ)' });
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
