/**
 * Wave 9 — tax returns an accountant files each month, computed from the posted ledger:
 *  - ภ.พ.30 (VAT return, ประมวลรัษฎากร มาตรา 83) from the VAT registers (journal lines on role vat_output / vat_input),
 *    with the filing the user RECORDS after filing on rd.go.th (nothing is submitted from here);
 *  - WHT payable (ภ.ง.ด.3 / ภ.ง.ด.53, มาตรา 50 + 52) from `purchasing.supplier_paid` postings, by month and form.
 *
 * Box numbering of ภ.พ.30 — the "การคำนวณภาษี" part of แบบ ภ.พ.30 (กรมสรรพากร, as published on rd.go.th, boxes 1–16), written from
 * our reading of the current form. ตรวจกับแบบ ภ.พ.30 ฉบับล่าสุด before relying on the numbers' positions (see CLAUDE.md / docs).
 */
import { badRequest, conflict, type Client } from '@erp/kernel';
import { round } from '@erp/thai';
import { EFFECTIVE, periodTh, todayTh } from './ledger.ts';
import { vatReport } from './reports.ts';

const r2 = (n: unknown) => round(Number(n ?? 0), 2);
/** a `date` column (pg returns 'YYYY-MM-DD' strings in this kernel) */
const isoDay = (v: unknown) => String(v).slice(0, 10);

/** 'YYYY-MM' + n months */
export function addMonths(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Filing deadlines of a tax month (§83: by the 15th of the following month). Filing and paying through e-Filing gets 8 more days
 * (the 23rd) under the Ministry of Finance's e-Filing extension measure, renewed periodically — check that it is still in force.
 * A deadline on a holiday moves to the next working day for paper filing; not modelled here.
 */
export function pp30Deadlines(period: string) {
  const next = addMonths(period, 1);
  return { paper: `${next}-15`, efiling: `${next}-23` };
}

/** WHT returns ภ.ง.ด.3 / 53: within 7 days of the following month (§59), e-Filing +8 days (the 15th). */
export function whtDeadlines(period: string) {
  const next = addMonths(period, 1);
  return { paper: `${next}-07`, efiling: `${next}-15` };
}

/**
 * Months (each part of a month counts as a whole month) from the day after `deadline` to `filed` — for เงินเพิ่ม 1.5% per month (§89/1).
 * 0 when filed on or before the deadline.
 */
export function lateMonths(deadline: string, filed: string): number {
  if (filed <= deadline) return 0;
  const [y, m, d] = deadline.split('-').map(Number);
  let n = 0;
  for (;;) {
    n += 1;
    const end = new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10);
    if (filed <= end || n > 600) return n;
  }
}

export interface Pp30Inputs {
  /** box 2 — sales taxed at 0% (exports, §80/1); not derivable from the VAT register (no VAT line is posted) */
  zeroRated?: number;
  /** box 3 — VAT-exempt sales (§81) */
  exempt?: number;
  /** box 13 — เงินเพิ่ม (§89/1), entered by the user */
  surcharge?: number;
  /** box 14 — เบี้ยปรับ (§89 + ระเบียบ ท.ป.4/2528 reductions for voluntary late filing), entered by the user */
  penalty?: number;
  filedDate?: string;
  channel?: 'efiling' | 'paper';
}

type BoxKey = 'box1' | 'box2' | 'box3' | 'box4' | 'box5' | 'box6' | 'box7' | 'box8' | 'box9' | 'box10' | 'box11' | 'box12' | 'box13' | 'box14' | 'box15' | 'box16';
export const PP30_BOXES: { no: number; key: BoxKey; label: string }[] = [
  { no: 1, key: 'box1', label: 'ยอดขายแล้วในเดือนนี้' },
  { no: 2, key: 'box2', label: 'หัก ยอดขายที่เสียภาษีในอัตราร้อยละ 0 (ถ้ามี)' },
  { no: 3, key: 'box3', label: 'หัก ยอดขายที่ได้รับยกเว้น (ถ้ามี)' },
  { no: 4, key: 'box4', label: 'ยอดขายที่ต้องเสียภาษี (1. − 2. − 3.)' },
  { no: 5, key: 'box5', label: 'ภาษีขายเดือนนี้' },
  { no: 6, key: 'box6', label: 'ยอดซื้อที่มีสิทธิ์นำภาษีซื้อมาหักในการคำนวณภาษีเดือนนี้' },
  { no: 7, key: 'box7', label: 'ภาษีซื้อเดือนนี้ (ตามหลักฐานในรายงานภาษีซื้อ)' },
  { no: 8, key: 'box8', label: 'ภาษีที่ต้องชำระเดือนนี้ (ถ้า 5. มากกว่า 7.)' },
  { no: 9, key: 'box9', label: 'ภาษีที่ชำระเกินเดือนนี้ (ถ้า 5. น้อยกว่า 7.)' },
  { no: 10, key: 'box10', label: 'ภาษีที่ชำระเกินยกมา' },
  { no: 11, key: 'box11', label: 'ต้องชำระ (ถ้า 8. มากกว่า 10.)' },
  { no: 12, key: 'box12', label: 'ชำระเกิน (ถ้า 10. มากกว่า 8. หรือ 9. รวมกับ 10.)' },
  { no: 13, key: 'box13', label: 'เงินเพิ่ม' },
  { no: 14, key: 'box14', label: 'เบี้ยปรับ' },
  { no: 15, key: 'box15', label: 'รวมภาษี เงินเพิ่ม และเบี้ยปรับที่ต้องชำระ (11. + 13. + 14.)' },
  { no: 16, key: 'box16', label: 'รวมภาษีที่ชำระเกินหลังคำนวณเงินเพิ่มและเบี้ยปรับ (12. − 13. − 14.)' },
];

const STATUS_TH: Record<string, string> = { not_filed: 'ยังไม่บันทึกการยื่น', filed: 'ยื่นแล้ว', amended: 'ยื่นแล้ว (มี ภ.พ.30 เพิ่มเติม)' };
const CHANNEL_TH: Record<string, string> = { efiling: 'ยื่นทางอินเทอร์เน็ต (e-Filing)', paper: 'ยื่นแบบกระดาษ' };

export async function filingsOf(c: Client, period: string) {
  const rows = (await c.query(`select * from vat_returns where period = $1 order by seq`, [period])).rows;
  return rows.map((f) => ({
    ...f, id: f.id, filed_date: f.filed_date, paid_amount: r2(f.paid_amount), surcharge: r2(f.surcharge), penalty: r2(f.penalty),
    zero_rated: r2(f.zero_rated), exempt: r2(f.exempt), channel_label: CHANNEL_TH[f.channel], kind_label: f.amend ? `ภ.พ.30 เพิ่มเติม ครั้งที่ ${f.seq}` : 'ภ.พ.30 ปกติ',
    refund_or_carry_label: f.refund_or_carry === 'refund' ? 'ขอคืนเป็นเงินสด' : f.refund_or_carry === 'carry' ? 'ขอนำไปชำระภาษีเดือนถัดไป' : '-',
  }));
}

/** cache of vatReport(year) within one request */
export type VatCache = Map<string, Awaited<ReturnType<typeof vatReport>>>;

/** The ภ.พ.30 of a month from the posted VAT registers + the user's inputs (defaults: the latest recorded filing's inputs, else 0). */
export async function computePp30(c: Client, period: string, inputs: Pp30Inputs = {}, cache: VatCache = new Map()) {
  const yearOf = async (y: string) => {
    if (!cache.has(y)) cache.set(y, await vatReport(c, y));
    return cache.get(y)!;
  };
  const month = (await yearOf(period.slice(0, 4))).rows.find((r) => r.month === period)!;
  const filings = await filingsOf(c, period);
  const latest = filings.at(-1) ?? null;
  const warnings: string[] = [];

  // box 10: the excess the previous month's RECORDED return carried forward (box 16 when the taxpayer chose to carry, 0 when refunded);
  // when the previous month has no recorded filing, the ledger's own carry chain (C11) is used and flagged
  const prevPeriod = addMonths(period, -1);
  const prevFiled = (await c.query(`select refund_or_carry, figures, seq from vat_returns where period = $1 order by seq desc limit 1`, [prevPeriod])).rows[0];
  let carriedIn = 0;
  let carriedInSource: 'filed' | 'computed' | 'refund' = 'computed';
  if (prevFiled) {
    carriedInSource = prevFiled.refund_or_carry === 'refund' ? 'refund' : 'filed';
    carriedIn = prevFiled.refund_or_carry === 'carry' ? r2(prevFiled.figures?.box16) : 0;
  } else {
    carriedIn = r2(month.carried_in);
    if (carriedIn > 0) warnings.push(`เดือน ${periodTh(prevPeriod)} ยังไม่บันทึกการยื่น ภ.พ.30 — ภาษีชำระเกินยกมา ${carriedIn.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท คำนวณจากบัญชี ตรวจกับแบบที่ยื่นจริง`);
  }

  const pick = (k: 'zeroRated' | 'exempt' | 'surcharge' | 'penalty', col: string) => r2(inputs[k] ?? (latest ? latest[col] : 0));
  const zeroRated = pick('zeroRated', 'zero_rated');
  const exempt = pick('exempt', 'exempt');
  const surcharge = pick('surcharge', 'surcharge');
  const penalty = pick('penalty', 'penalty');

  const b = {} as Record<BoxKey, number>;
  b.box4 = r2(month.output_base);
  b.box2 = zeroRated;
  b.box3 = exempt;
  b.box1 = r2(b.box4 + zeroRated + exempt);
  b.box5 = r2(month.output_vat);
  b.box6 = r2(month.input_base);
  b.box7 = r2(month.input_vat);
  b.box8 = Math.max(r2(b.box5 - b.box7), 0);
  b.box9 = Math.max(r2(b.box7 - b.box5), 0);
  b.box10 = carriedIn;
  const net = r2(b.box8 - b.box9 - b.box10);
  b.box11 = Math.max(net, 0);
  b.box12 = Math.max(-net, 0);
  b.box13 = surcharge;
  b.box14 = penalty;
  const total = r2(b.box11 + b.box13 + b.box14 - b.box12);
  b.box15 = Math.max(total, 0);
  b.box16 = Math.max(-total, 0);

  const deadlines = pp30Deadlines(period);
  const channel = inputs.channel ?? latest?.channel ?? 'efiling';
  const filedDate = inputs.filedDate ?? (latest ? isoDay(latest.filed_date) : null);
  const today = todayTh();
  const deadline = channel === 'paper' ? deadlines.paper : deadlines.efiling;
  const months = lateMonths(deadline, filedDate ?? today);
  // §89/1: 1.5% per month or part of a month on the tax payable, not more than the tax — a suggestion only, the user fills box 13
  const surchargeSuggested = Math.min(r2(b.box11 * 0.015 * months), b.box11);
  const late = months > 0;
  if (late && b.box11 > 0 && !surcharge && !penalty) {
    warnings.push(`${filedDate ? 'ยื่น' : 'ยังไม่ยื่น —'} เกินกำหนด (${CHANNEL_TH[channel]} ภายใน ${deadline}) ${months} เดือน: เงินเพิ่ม 1.5% ต่อเดือน (มาตรา 89/1) ประมาณ ${surchargeSuggested.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท และเบี้ยปรับ — กรอกในช่อง 13/14`);
  }

  const periodStatus = (await c.query(`select status from fiscal_periods where period = $1`, [period])).rows[0]?.status ?? 'open';
  const changed = latest ? PP30_BOXES.some((x) => x.no <= 12 && r2(latest.figures?.[x.key]) !== b[x.key]) : false;
  if (changed) warnings.push('ตัวเลขในบัญชีเปลี่ยนไปจากที่บันทึกการยื่นไว้ — ถ้าแบบที่ยื่นผิด ให้ยื่น ภ.พ.30 เพิ่มเติม');
  // revenue booked this month without output VAT: candidates for box 2 / 3 (or not subject to VAT at all) — the user decides
  const rev = (await c.query(
    `select coalesce(sum(l.credit - l.debit), 0) as v from journal_lines l join journal_entries j on j.id = l.journal_id and j.status in ${EFFECTIVE}
     join accounts a on a.id = l.account_id and a.category = 'revenue'
     where j.entry_date between $1::date and (date_trunc('month', $1::date) + interval '1 month - 1 day')::date`, [`${period}-01`])).rows[0].v;
  const revenueWithoutVat = Math.max(r2(r2(rev) - b.box4), 0);

  const status = !latest ? 'not_filed' : latest.amend ? 'amended' : 'filed';
  return {
    id: period, period, period_th: periodTh(period), title: `แบบ ภ.พ.30 เดือนภาษี ${periodTh(period)}`,
    ...b,
    boxes: PP30_BOXES.map((x) => ({ no: x.no, label: `${x.no}. ${x.label}`, amount: b[x.key] })),
    output_count: month.output_count, input_count: month.input_count,
    carried_in_source: carriedInSource,
    carried_in_source_label: { filed: `จากแบบที่บันทึกการยื่นเดือน ${periodTh(prevPeriod)}`, refund: `เดือน ${periodTh(prevPeriod)} ขอคืนเป็นเงินสด (ไม่ยกมา)`, computed: 'คำนวณจากบัญชี (เดือนก่อนยังไม่บันทึกการยื่น)' }[carriedInSource],
    zero_rated: zeroRated, exempt, surcharge, penalty, revenue_without_vat: revenueWithoutVat,
    deadline_paper: deadlines.paper, deadline_efiling: deadlines.efiling,
    filed_date: filedDate, channel, channel_label: CHANNEL_TH[channel],
    late, late_months: months, surcharge_suggested: surchargeSuggested,
    overdue: !latest && today > deadlines.efiling,
    period_status: periodStatus, period_status_label: periodStatus === 'closed' ? 'ปิดงวดแล้ว' : 'งวดบัญชียังเปิด',
    status, status_label: STATUS_TH[status], filed: !!latest, can_amend: !!latest,
    receipt_no: latest?.receipt_no ?? null, paid_amount: latest ? latest.paid_amount : null,
    filings, latest_filing: latest, changed_since_filing: changed,
    warnings, warnings_text: warnings.join(' · ') || null,
    boundary: 'ระบบนี้คำนวณตัวเลขและบันทึกว่ายื่นแล้วเท่านั้น — ยื่นแบบและชำระภาษีจริงที่ efiling.rd.go.th หรือที่สำนักงานสรรพากร',
  };
}

/** 12 months of a year: what each ภ.พ.30 comes to and whether it was recorded as filed. */
export async function pp30Year(c: Client, year: string) {
  const cache: VatCache = new Map();
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const p = `${year}-${String(m).padStart(2, '0')}`;
    const x = await computePp30(c, p, {}, cache);
    rows.push({
      id: p, period: p, period_th: x.period_th, box4: x.box4, box5: x.box5, box6: x.box6, box7: x.box7, box10: x.box10, box11: x.box11, box12: x.box12, box15: x.box15, box16: x.box16,
      status: x.status, status_label: x.overdue ? 'เกินกำหนด — ยังไม่บันทึกการยื่น' : x.status_label, overdue: x.overdue,
      deadline_efiling: x.deadline_efiling, filed_date: x.latest_filing?.filed_date ?? null, receipt_no: x.receipt_no, paid_amount: x.paid_amount,
      changed_since_filing: x.changed_since_filing,
    });
  }
  return { year, rows };
}

export interface FileInput {
  filedDate: string;
  channel: 'efiling' | 'paper';
  receiptNo?: string;
  refundOrCarry: 'carry' | 'refund';
  paidAmount: number;
  zeroRated?: number;
  exempt?: number;
  surcharge?: number;
  penalty?: number;
  amend: boolean;
  reason?: string;
}

/**
 * Record that the return was filed (the user filed it on rd.go.th / on paper). Refuses a second ordinary filing; a ภ.พ.30 เพิ่มเติม
 * (`amend` + reason) is stored as the next `seq` with the additional tax against the previous filing. Closes nothing; warns instead.
 */
export async function recordFiling(c: Client, period: string, b: FileInput, by: { id: string; name: string | null }) {
  if (b.filedDate < `${addMonths(period, 1)}-01`) throw badRequest(`ยื่นแบบ ภ.พ.30 เดือน ${periodTh(period)} ได้ตั้งแต่วันที่ 1 ของเดือนถัดไป`, { fieldErrors: { filedDate: ['ก่อนสิ้นเดือนภาษี'] } });
  if (b.filedDate > todayTh()) throw badRequest('วันที่ยื่นต้องไม่เกินวันนี้ — บันทึกหลังยื่นจริงแล้วเท่านั้น', { fieldErrors: { filedDate: ['วันที่ในอนาคต'] } });
  await c.query(`select pg_advisory_xact_lock(hashtext('accounting.pp30:' || current_setting('app.tenant_id', true) || $1))`, [period]);
  const prev = (await c.query(`select * from vat_returns where period = $1 order by seq desc limit 1`, [period])).rows[0];
  if (prev && !b.amend) {
    throw conflict(`เดือน ${periodTh(period)} บันทึกการยื่นแล้ว (${isoDay(prev.filed_date)}${prev.receipt_no ? ` ใบเสร็จ ${prev.receipt_no}` : ''}) — ถ้าต้องแก้ ให้ยื่น ภ.พ.30 เพิ่มเติม พร้อมเหตุผล`);
  }
  if (b.amend && !prev) throw conflict(`เดือน ${periodTh(period)} ยังไม่มีการบันทึกการยื่นแบบปกติ — บันทึกแบบปกติก่อน`);
  if (b.amend && !b.reason?.trim()) throw badRequest('ภ.พ.30 เพิ่มเติม ต้องระบุเหตุผล', { fieldErrors: { reason: ['ระบุเหตุผล'] } });
  if (b.amend && b.filedDate < isoDay(prev.filed_date)) throw badRequest('วันที่ยื่นเพิ่มเติมต้องไม่ก่อนวันที่ยื่นครั้งก่อน');

  const x = await computePp30(c, period, { zeroRated: b.zeroRated, exempt: b.exempt, surcharge: b.surcharge ?? 0, penalty: b.penalty ?? 0, filedDate: b.filedDate, channel: b.channel });
  const warnings = x.warnings.filter((w) => !w.startsWith('ตัวเลขในบัญชีเปลี่ยนไป'));
  const figures: Record<string, unknown> = Object.fromEntries(PP30_BOXES.map((k) => [k.key, x[k.key]]));
  let due = x.box15;
  if (prev) {
    // ภ.พ.30 เพิ่มเติม: the additional tax is the difference to what the previous filing declared (box 11), plus this filing's surcharge/penalty
    const additional = r2(x.box11 - r2(prev.figures?.box11));
    figures.previous_box11 = r2(prev.figures?.box11);
    figures.additional_tax = additional;
    due = r2(Math.max(additional, 0) + x.box13 + x.box14);
  }
  figures.due = due;
  figures.carried_in_source = x.carried_in_source;
  if (x.period_status !== 'closed') warnings.push(`งวดบัญชี ${periodTh(period)} ยังเปิดอยู่ — รายการที่ลงเพิ่มภายหลังจะทำให้ตัวเลขต่างจากแบบที่ยื่น ควรปิดงวด`);
  if (Math.abs(r2(b.paidAmount) - due) > 0.01) warnings.push(`ยอดที่ชำระ ${r2(b.paidAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ไม่เท่ากับยอดที่ต้องชำระตามแบบ ${due.toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท`);
  const refundOrCarry = x.box16 > 0 ? b.refundOrCarry : null;
  const row = (await c.query(
    `insert into vat_returns (period, seq, amend, reason, filed_date, channel, receipt_no, refund_or_carry, paid_amount, zero_rated, exempt, surcharge, penalty, figures, filed_by, filed_by_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning *`,
    [period, prev ? prev.seq + 1 : 0, !!prev, b.reason?.trim() || null, b.filedDate, b.channel, b.receiptNo?.trim() || null, refundOrCarry, r2(b.paidAmount),
      x.zero_rated, x.exempt, x.surcharge, x.penalty, JSON.stringify(figures), by.id, by.name])).rows[0];
  const after = await computePp30(c, period);
  return {
    ...after, filing: row, warnings, warnings_text: warnings.join(' · ') || null,
    message: `บันทึกการยื่น ${prev ? `ภ.พ.30 เพิ่มเติม ครั้งที่ ${row.seq}` : 'ภ.พ.30'} เดือน ${periodTh(period)} แล้ว (บันทึกเท่านั้น — ไม่ได้ส่งแบบไปกรมสรรพากร)${warnings.length ? ` · ${warnings.join(' · ')}` : ''}`,
  };
}

/** CSV of the boxes (UTF-8 BOM, CRLF — opens in Thai Excel): ช่อง, รายการ, จำนวนเงิน */
export function pp30Csv(x: Awaited<ReturnType<typeof computePp30>>): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['ช่อง', 'รายการ', 'จำนวนเงิน (บาท)'].join(',')];
  lines.push(['', cell(`แบบ ภ.พ.30 เดือนภาษี ${x.period_th} (${x.period})`), ''].join(','));
  for (const bx of PP30_BOXES) lines.push([String(bx.no), cell(bx.label), x[bx.key].toFixed(2)].join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/* ---------------- WHT payable (ภ.ง.ด.3 / ภ.ง.ด.53) ---------------- */

const FORM_TH: Record<string, string> = { PND3: 'ภ.ง.ด.3', PND53: 'ภ.ง.ด.53' };

/**
 * WHT withheld on supplier payments by month and form, from the posted WHT lines (`wht_form` set by `purchasing.supplier_paid`;
 * a reversal shows negative). Totals per month/form are what the ภ.ง.ด.3 / ภ.ง.ด.53 return of that month should declare —
 * reconcile against purchasing's ภ.ง.ด.3/53 report; `accounts` = balance still owed on the WHT-payable accounts of the posting rules.
 */
export async function whtPayable(c: Client, q: { year: string; month?: string; form?: 'PND3' | 'PND53' }) {
  const lines = (await c.query(
    `select j.id, j.id as journal_id, j.no, j.entry_date, to_char(j.entry_date, 'YYYY-MM') as month, j.ref, l.partner_name, l.tax_party_tax_id as party_tax_id,
       l.wht_form as form, l.wht_income_type as income_type, l.wht_rate as rate, l.wht_certificate_no as certificate_no, l.description,
       case when l.credit > 0 then l.tax_base else -l.tax_base end as base, l.credit - l.debit as amount
     from journal_lines l join journal_entries j on j.id = l.journal_id and j.status in ${EFFECTIVE}
     where l.wht_form is not null and extract(year from j.entry_date) = $1::int
       and ($2::text is null or to_char(j.entry_date, 'YYYY-MM') = $2) and ($3::text is null or l.wht_form = $3)
     order by j.entry_date, j.no, l.line_no`, [Number(q.year), q.month ?? null, q.form ?? null])).rows
    .map((x) => ({ ...x, form_label: FORM_TH[x.form], base: x.base === null ? null : r2(x.base), amount: r2(x.amount), rate: x.rate === null ? null : Number(x.rate),
      rate_pct: x.rate === null ? null : `${round(Number(x.rate) * 100, 2)}%` }));
  const groups = new Map<string, { id: string; month: string; month_th: string; form: string; form_label: string; count: number; base: number; amount: number; due_paper: string; due_efiling: string }>();
  for (const l of lines) {
    const k = `${l.month}:${l.form}`;
    const dl = whtDeadlines(l.month);
    const g = groups.get(k) ?? { id: k, month: l.month, month_th: periodTh(l.month), form: l.form, form_label: FORM_TH[l.form], count: 0, base: 0, amount: 0, due_paper: dl.paper, due_efiling: dl.efiling };
    g.count += 1; g.base = r2(g.base + (l.base ?? 0)); g.amount = r2(g.amount + l.amount);
    groups.set(k, g);
  }
  const accounts = (await c.query(
    `select r.leg, a.id, a.code, a.name, coalesce((select sum(l.credit - l.debit) from journal_lines l join journal_entries j on j.id = l.journal_id and j.status in ${EFFECTIVE}
        where l.account_id = a.id), 0) as balance
     from posting_rules r join accounts a on a.id = r.account_id
     where r.event_type = 'purchasing.supplier_paid' and r.leg in ('wht_pnd3', 'wht_pnd53') order by r.leg`)).rows
    .map((a) => ({ form: a.leg === 'wht_pnd3' ? 'PND3' : 'PND53', form_label: a.leg === 'wht_pnd3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53', code: a.code, name: a.name, balance: r2(a.balance) }));
  const summary = [...groups.values()].sort((a, b) => a.month.localeCompare(b.month) || a.form.localeCompare(b.form));
  const total = (form?: string) => r2(lines.filter((l) => !form || l.form === form).reduce((s, l) => s + l.amount, 0));
  return {
    year: q.year, month: q.month ?? null, form: q.form ?? null, title: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย (ภ.ง.ด.3 / ภ.ง.ด.53)',
    totals: { amount: total(), pnd3: total('PND3'), pnd53: total('PND53'), count: lines.length },
    summary, lines, accounts,
  };
}
