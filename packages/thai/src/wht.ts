/**
 * Withholding tax (ภาษีหัก ณ ที่จ่าย) on payments to suppliers — pure helpers (no I/O).
 *
 * Legal basis (ประมวลรัษฎากร):
 * - มาตรา 3 เตรส — the Director-General orders which payments are subject to WHT and at what rate:
 *   คำสั่งกรมสรรพากร ที่ ท.ป.4/2528 (as amended) — the rates in WHT_INCOME_TYPES below.
 * - มาตรา 50 (payee = individual / ordinary partnership → ภ.ง.ด.3) and มาตรา 69 ทวิ / 69 ตรี (payee = company or juristic
 *   partnership → ภ.ง.ด.53) — the payer withholds and remits.
 * - มาตรา 50 ทวิ — the payer issues a certificate (หนังสือรับรองการหักภาษี ณ ที่จ่าย) to the payee.
 * - มาตรา 52 / 59 / 69 ทวิ — the return and the tax are due within 7 days of the month after payment (paper);
 *   filing over the internet gets 8 more days (the 15th) under the Ministry of Finance's e-filing extension, which is renewed
 *   from time to time — check it is still in force for the period you file.
 * - Base: the income actually paid, NOT including VAT when the VAT is shown separately (ท.ป.4/2528 — WHT is computed on the
 *   price before value-added tax). Amount = round(base × rate) to the satang, half-up.
 *
 * Clause numbers inside ท.ป.4/2528 are given only where we are confident of them; rates are the standard ones. Reduced rates
 * (e.g. the temporary e-Withholding Tax rate) are entered as an override rate on the payment.
 */
import { round } from './index.ts';

export type WhtForm = 'PND3' | 'PND53';

export interface WhtIncomeType {
  code: string;
  /** printed on the 50 ทวิ, the ใบแนบ and the export file */
  nameTh: string;
  /** standard rate (fraction); null = the user must give one (other) */
  rate: number | null;
  /** มาตรา 40 category of the income when the payee is an individual */
  section40: string;
  /** legal note shown with the type */
  basis: string;
  /** ท.ป.4/2528: payments below 1,000 baht at a time are generally not subject to WHT for this type (warn, never block) */
  under1000Exempt: boolean;
}

export const WHT_INCOME_TYPES: Record<string, WhtIncomeType> = {
  service: { code: 'service', nameTh: 'ค่าบริการ', rate: 0.03, section40: '40(8)', basis: 'ค่าบริการ 3% — คำสั่งกรมสรรพากร ท.ป.4/2528', under1000Exempt: true },
  rent: { code: 'rent', nameTh: 'ค่าเช่า', rate: 0.05, section40: '40(5)', basis: 'ค่าเช่าทรัพย์สิน 5% — ท.ป.4/2528 ข้อ 5', under1000Exempt: false },
  transport: { code: 'transport', nameTh: 'ค่าขนส่ง', rate: 0.01, section40: '40(8)', basis: 'ค่าขนส่ง 1% (ไม่รวมค่าโดยสารสาธารณะ) — ท.ป.4/2528', under1000Exempt: true },
  advertising: { code: 'advertising', nameTh: 'ค่าโฆษณา', rate: 0.02, section40: '40(8)', basis: 'ค่าโฆษณา 2% — ท.ป.4/2528', under1000Exempt: true },
  hire_of_work: { code: 'hire_of_work', nameTh: 'ค่าจ้างทำของ', rate: 0.03, section40: '40(7)/40(8)', basis: 'ค่าจ้างทำของ / รับเหมา 3% — ท.ป.4/2528 ข้อ 8', under1000Exempt: true },
  promotion: {
    code: 'promotion', nameTh: 'รางวัล ส่วนลดหรือประโยชน์ใด ๆ เนื่องจากการส่งเสริมการขาย', rate: 0.03, section40: '40(8)',
    basis: 'รางวัล/ส่วนลด/ประโยชน์จากการส่งเสริมการขาย 3% — ท.ป.4/2528', under1000Exempt: true,
  },
  professional: { code: 'professional', nameTh: 'ค่าวิชาชีพอิสระ', rate: 0.03, section40: '40(6)', basis: 'วิชาชีพอิสระ (กฎหมาย บัญชี วิศวกรรม สถาปัตยกรรม ฯลฯ) 3% — ท.ป.4/2528 ข้อ 6', under1000Exempt: false },
  other: { code: 'other', nameTh: 'อื่น ๆ', rate: null, section40: '', basis: 'ระบุคำอธิบายและอัตราเอง', under1000Exempt: false },
};

export const WHT_INCOME_TYPE_CODES = Object.keys(WHT_INCOME_TYPES) as [string, ...string[]];

/** WHT amount in baht, exact to the satang: round(base × rate) half-up. */
export function whtAmount(base: number, rate: number): number {
  return round(base * rate, 2);
}

export interface WhtLineCheck {
  rate: number;
  description: string;
  amount: number;
  warnings: string[];
}

/**
 * Resolve and check one WHT line: rate defaults to the type's standard rate; `other` needs a rate and a description.
 * Throws an Error with a Thai message for a line that cannot be right (unknown type, rate ≤ 0 or ≥ 100%); returns warnings
 * for lines that are only unusual (rate differs from standard, base under 1,000 baht for a type that is usually exempt).
 */
export function checkWhtLine(input: { incomeType: string; base: number; rate?: number | null; description?: string | null }): WhtLineCheck {
  const t = WHT_INCOME_TYPES[input.incomeType];
  if (!t) throw new Error(`ไม่รู้จักประเภทเงินได้ "${input.incomeType}"`);
  const rate = input.rate ?? t.rate;
  if (rate === null || rate === undefined) throw new Error('ประเภท "อื่น ๆ" ต้องระบุอัตราภาษี');
  if (!(rate > 0 && rate < 1)) throw new Error('อัตราภาษีต้องมากกว่า 0% และน้อยกว่า 100%');
  if (!(input.base > 0)) throw new Error('ฐานเงินได้ต้องมากกว่า 0');
  const description = (input.description ?? '').trim() || t.nameTh;
  if (t.code === 'other' && !(input.description ?? '').trim()) throw new Error('ประเภท "อื่น ๆ" ต้องระบุคำอธิบายเงินได้');
  const warnings: string[] = [];
  if (t.rate !== null && Math.abs(rate - t.rate) > 1e-9) {
    warnings.push(`อัตรา ${pct(rate)} ต่างจากอัตราปกติของ${t.nameTh} (${pct(t.rate)}) — ตรวจว่ามีสิทธิ์ใช้อัตราลดหรือไม่ (เช่น e-Withholding Tax)`);
  }
  if (t.under1000Exempt && input.base < 1000) {
    warnings.push(`ฐาน${t.nameTh} ${input.base.toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท ต่ำกว่า 1,000 บาท — โดยทั่วไปการจ่ายครั้งหนึ่งต่ำกว่า 1,000 บาทไม่ต้องหัก (ท.ป.4/2528) เว้นแต่เป็นสัญญาเดียวที่แบ่งจ่าย — ตรวจก่อนบันทึก`);
  }
  return { rate, description, amount: whtAmount(input.base, rate), warnings };
}

const pct = (r: number) => `${round(r * 100, 4)}%`;

/** True for a juristic person's 13-digit tax ID (นิติบุคคล — starts with 0). */
export function isJuristicTaxId(taxId: string | null | undefined): boolean {
  return /^0\d{12}$/.test((taxId ?? '').replace(/[\s-]/g, ''));
}

const JURISTIC_NAME = /^(บริษัท|บจก\.?|บมจ\.?|ห้างหุ้นส่วนจำกัด|หจก\.?|ห้างหุ้นส่วนสามัญนิติบุคคล|มูลนิธิ|สมาคม|สหกรณ์)/;

/**
 * Which return the WHT goes on: ภ.ง.ด.53 when the payee is a juristic person (มาตรา 69 ทวิ), else ภ.ง.ด.3 (มาตรา 50).
 * Default from the 13-digit tax ID (juristic IDs start with 0); without a tax ID, from a company-looking name. The user may override.
 */
export function whtFormFor(taxId?: string | null, name?: string | null): WhtForm {
  const id = (taxId ?? '').replace(/[\s-]/g, '');
  if (/^\d{13}$/.test(id)) return id.startsWith('0') ? 'PND53' : 'PND3';
  return JURISTIC_NAME.test((name ?? '').trim()) ? 'PND53' : 'PND3';
}

export const WHT_FORM_TH: Record<WhtForm, string> = { PND3: 'ภ.ง.ด.3', PND53: 'ภ.ง.ด.53' };

/** Due dates of the monthly return for payments made in `period` (YYYY-MM): paper = the 7th, e-filing = the 15th of the next month. */
export function whtDueDates(period: string): { paper: string; efiling: string } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) throw new Error(`expected YYYY-MM, got ${period}`);
  let y = Number(m[1]);
  let mo = Number(m[2]) + 1;
  if (mo === 13) { mo = 1; y += 1; }
  const next = `${y}-${String(mo).padStart(2, '0')}`;
  return { paper: `${next}-07`, efiling: `${next}-15` };
}

/** "2026-09-05" → "05/09/2569" (day/month/Buddhist-era year), the date format of RD forms and RD Prep. */
export function thaiSlashDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${Number(y) + 543}`;
}

const INDIVIDUAL_TITLES = ['นางสาว', 'น.ส.', 'นาย', 'นาง', 'เด็กชาย', 'เด็กหญิง', 'ด.ช.', 'ด.ญ.', 'ดร.'];
const JURISTIC_TITLES = ['บริษัทมหาชนจำกัด', 'บริษัท', 'บจก.', 'บมจ.', 'ห้างหุ้นส่วนจำกัด', 'ห้างหุ้นส่วนสามัญนิติบุคคล', 'หจก.', 'มูลนิธิ', 'สมาคม', 'สหกรณ์'];

/** Split a payee name into คำนำหน้า / ชื่อ / ชื่อสกุล as the ใบแนบ asks ("นาย สมชาย ใจดี" → นาย · สมชาย · ใจดี; "บริษัท เอ จำกัด" → บริษัท · เอ จำกัด). */
export function splitThaiName(name: string, form: WhtForm): { title: string; firstName: string; lastName: string } {
  let rest = name.trim().replace(/\s+/g, ' ');
  const titles = form === 'PND53' ? JURISTIC_TITLES : INDIVIDUAL_TITLES;
  const title = titles.find((t) => rest.startsWith(t)) ?? '';
  rest = rest.slice(title.length).trim();
  if (form === 'PND53') return { title, firstName: rest, lastName: '' };
  const [first, ...last] = rest.split(' ');
  return { title, firstName: first ?? '', lastName: last.join(' ') };
}

/** One row of the ใบแนบ ภ.ง.ด.3 / ภ.ง.ด.53 (one income line of one payee). */
export interface WhtReturnRow {
  /** ลำดับที่ — one number per payee entry (50 ทวิ); several income lines of the same payment share it */
  seq: number;
  taxId: string | null;
  /** 5-digit branch, '00000' = สำนักงานใหญ่ */
  branch: string | null;
  name: string;
  address: string | null;
  /** YYYY-MM-DD */
  paidDate: string;
  /** income type in Thai, as printed */
  incomeType: string;
  /** fraction, 0.03 */
  rate: number;
  amount: number;
  tax: number;
  /** 1 = หัก ณ ที่จ่าย, 2 = ออกให้ตลอดไป, 3 = ออกให้ครั้งเดียว */
  condition: '1' | '2' | '3';
}

export function whtTotals(rows: WhtReturnRow[]) {
  return {
    payees: new Set(rows.map((r) => r.seq)).size,
    lines: rows.length,
    amount: round(rows.reduce((a, r) => a + r.amount, 0)),
    tax: round(rows.reduce((a, r) => a + r.tax, 0)),
  };
}

const money = (n: number) => round(n).toFixed(2);
const clean = (v: string | null | undefined) => (v ?? '').replace(/[|\r\n\t]+/g, ' ').trim();
const branch5 = (b: string | null | undefined) => (/^\d{1,5}$/.test((b ?? '').trim()) ? (b ?? '').trim().padStart(5, '0') : '00000');

/**
 * RD Prep text-file layout used by `buildRdPrepText` — ต้องตรวจกับโปรแกรม RD Prep เวอร์ชันล่าสุดก่อนยื่นจริง.
 * Written from our best knowledge of the "นำเข้าข้อมูลใบแนบ ภ.ง.ด.3 / ภ.ง.ด.53 จากไฟล์ข้อความ" import; it has NOT been verified against
 * RD Prep or accepted by the Revenue Department. One line per income line, fields separated by `|`, no header row, CRLF line ends,
 * no trailing `|`. Text fields never contain `|` or line breaks (replaced by a space).
 */
export const RD_PREP_COLUMNS: Record<WhtForm, { key: string; th: string; format: string }[]> = {
  PND3: [
    { key: 'seq', th: 'ลำดับที่', format: 'integer, 1… per payee entry' },
    { key: 'taxId', th: 'เลขประจำตัวผู้เสียภาษีอากร', format: '13 digits, no dashes (empty if unknown)' },
    { key: 'branch', th: 'สาขาที่', format: '5 digits, 00000 = สำนักงานใหญ่' },
    { key: 'title', th: 'คำนำหน้าชื่อ', format: 'นาย / นาง / นางสาว …' },
    { key: 'firstName', th: 'ชื่อ', format: 'text' },
    { key: 'lastName', th: 'ชื่อสกุล', format: 'text' },
    { key: 'address', th: 'ที่อยู่', format: 'text, one field' },
    { key: 'paidDate', th: 'วันเดือนปีที่จ่าย', format: 'dd/mm/yyyy, Buddhist era (05/09/2569)' },
    { key: 'incomeType', th: 'ประเภทเงินได้', format: 'text' },
    { key: 'rate', th: 'อัตราภาษีร้อยละ', format: 'decimal, 2 places (3.00)' },
    { key: 'amount', th: 'จำนวนเงินที่จ่าย', format: 'decimal, 2 places, no thousands separator' },
    { key: 'tax', th: 'จำนวนเงินภาษีที่หักและนำส่ง', format: 'decimal, 2 places' },
    { key: 'condition', th: 'เงื่อนไขการหักภาษี', format: '1 = หัก ณ ที่จ่าย, 2 = ออกให้ตลอดไป, 3 = ออกให้ครั้งเดียว' },
  ],
  PND53: [
    { key: 'seq', th: 'ลำดับที่', format: 'integer, 1… per payee entry' },
    { key: 'taxId', th: 'เลขประจำตัวผู้เสียภาษีอากร', format: '13 digits, no dashes' },
    { key: 'branch', th: 'สาขาที่', format: '5 digits, 00000 = สำนักงานใหญ่' },
    { key: 'title', th: 'คำนำหน้าชื่อ', format: 'บริษัท / ห้างหุ้นส่วนจำกัด …' },
    { key: 'firstName', th: 'ชื่อ', format: 'text (rest of the juristic name, e.g. "เอบีซี จำกัด")' },
    { key: 'address', th: 'ที่อยู่', format: 'text, one field' },
    { key: 'paidDate', th: 'วันเดือนปีที่จ่าย', format: 'dd/mm/yyyy, Buddhist era' },
    { key: 'incomeType', th: 'ประเภทเงินได้', format: 'text' },
    { key: 'rate', th: 'อัตราภาษีร้อยละ', format: 'decimal, 2 places' },
    { key: 'amount', th: 'จำนวนเงินที่จ่าย', format: 'decimal, 2 places' },
    { key: 'tax', th: 'จำนวนเงินภาษีที่หักและนำส่ง', format: 'decimal, 2 places' },
    { key: 'condition', th: 'เงื่อนไขการหักภาษี', format: '1 / 2 / 3' },
  ],
};

export const RD_PREP_DISCLAIMER = 'ต้องตรวจกับโปรแกรม RD Prep เวอร์ชันล่าสุดก่อนยื่นจริง — รูปแบบไฟล์นี้จัดทำตามความเข้าใจของเรา ยังไม่ได้ทดสอบนำเข้ากับ RD Prep และไม่ได้รับรองโดยกรมสรรพากร';

function rowValues(r: WhtReturnRow, form: WhtForm): Record<string, string> {
  const n = splitThaiName(r.name, form);
  return {
    seq: String(r.seq), taxId: clean(r.taxId).replace(/\D/g, ''), branch: branch5(r.branch), title: clean(n.title), firstName: clean(n.firstName), lastName: clean(n.lastName),
    address: clean(r.address), paidDate: thaiSlashDate(r.paidDate), incomeType: clean(r.incomeType), rate: round(r.rate * 100, 2).toFixed(2),
    amount: money(r.amount), tax: money(r.tax), condition: r.condition,
  };
}

/** Pipe-delimited text for RD Prep (see RD_PREP_COLUMNS) — UNVERIFIED layout, check before filing. */
export function buildRdPrepText(rows: WhtReturnRow[], form: WhtForm): string {
  const cols = RD_PREP_COLUMNS[form];
  return rows.map((r) => { const v = rowValues(r, form); return cols.map((c) => v[c.key]).join('|'); }).join('\r\n') + (rows.length ? '\r\n' : '');
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV of the ใบแนบ (UTF-8 with BOM so Excel shows Thai), Thai headers, same values as the RD Prep text plus a total row. */
export function buildWhtCsv(rows: WhtReturnRow[], form: WhtForm): string {
  const cols = RD_PREP_COLUMNS[form];
  const lines = [cols.map((c) => csvCell(c.th)).join(',')];
  for (const r of rows) { const v = rowValues(r, form); lines.push(cols.map((c) => csvCell(v[c.key])).join(',')); }
  const t = whtTotals(rows);
  lines.push(cols.map((c) => (c.key === 'seq' ? 'รวม' : c.key === 'amount' ? money(t.amount) : c.key === 'tax' ? money(t.tax) : '')).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/**
 * Encode text as TIS-620 (Thai Windows/ANSI, what older Thai desktop programs read). Thai letters U+0E01–U+0E5B map to
 * 0xA1–0xFB; ASCII stays; anything else becomes "?".
 */
export function toTis620(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out[n++] = cp;
    else if (cp >= 0x0e01 && cp <= 0x0e5b) out[n++] = cp - 0x0e01 + 0xa1;
    else if (cp === 0xfeff) continue;
    else out[n++] = 0x3f;
  }
  return out.slice(0, n);
}
