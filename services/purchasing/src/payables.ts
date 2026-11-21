/**
 * Wave 9 — supplier bills (ตั้งหนี้), payables & aging, supplier payments (PV) with withholding tax,
 * 50 ทวิ certificates and the monthly ภ.ง.ด.3 / ภ.ง.ด.53 attachment (ใบแนบ) with CSV and RD Prep text exports.
 *
 * Legal basis (ประมวลรัษฎากร): input VAT needs a full tax invoice — มาตรา 82/3, 86/4 (otherwise `vat_claimable = false`);
 * WHT — มาตรา 3 เตรส + คำสั่งกรมสรรพากร ท.ป.4/2528 (rates), มาตรา 50 (ภ.ง.ด.3, individuals) / 69 ทวิ (ภ.ง.ด.53, juristic persons),
 * certificate มาตรา 50 ทวิ, return within 7 days of the next month (มาตรา 52 / 59; e-filing +8 days). See @erp/thai wht.ts.
 *
 * Nothing here files anything with the Revenue Department: the reports and exports are for the company to file itself.
 */
import {
  addDaysIso, auth, badRequest, conflict, guardLockDate, hasPerm, nextDocNo, notFound, one, parse, requirePerm, s, thaiToday, z,
  type AuthContext, type Client, type ServiceDefinition,
} from '@erp/kernel';
import {
  bahtText, buildRdPrepText, buildWhtCsv, checkWhtLine, documentTotals, formatThaiDate, formatThaiMonth, isValidThaiTaxId, RD_PREP_COLUMNS, RD_PREP_DISCLAIMER,
  round, thaiSlashDate, toTis620, WHT_FORM_TH, WHT_INCOME_TYPE_CODES, WHT_INCOME_TYPES, whtDueDates, whtFormFor, whtTotals, type WhtForm, type WhtReturnRow,
} from '@erp/thai';

import { checkOpeningDocs } from '@erp/ui-schema';

type App = Parameters<ServiceDefinition['routes']>[0];
type Kernel = Parameters<ServiceDefinition['routes']>[1];

const fieldError = (field: string, message: string) => badRequest('Validation failed', { fieldErrors: { [field]: [message] }, formErrors: [] });
const baht = (n: number) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 });

/** Form posts send '' / null for untouched optional fields: drop them (one level into arrays of objects too). */
function blankless(v: unknown): any {
  if (Array.isArray(v)) return v.map(blankless);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== null).map(([k2, x]) => [k2, blankless(x)]));
  return v;
}

const TaxId = z.string().trim().regex(/^\d{13}$/, 'เลขประจำตัวผู้เสียภาษี 13 หลัก').refine(isValidThaiTaxId, 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง');
const Branch = z.string().trim().regex(/^\d{1,5}$/, 'สาขาเป็นตัวเลข 5 หลัก (00000 = สำนักงานใหญ่)').transform((b) => b.padStart(5, '0'));
const IncomeType = z.enum(WHT_INCOME_TYPE_CODES);
const Form = z.enum(['PND3', 'PND53']);

const BillHead = z.object({
  /* supplier snapshot from master-data's partner lookup (never read from master-data's database) */
  supplierId: s.uuid.nullable().optional(),
  supplierCode: z.string().trim().max(50).optional(),
  supplierName: s.name.optional(),
  supplierTaxId: TaxId.optional(),
  supplierBranch: Branch.optional(),
  supplierAddress: z.string().trim().max(500).optional(),
  supplierInvoiceNo: z.string().trim().min(1, 'ระบุเลขที่ใบกำกับภาษี/ใบแจ้งหนี้ของผู้ขาย').max(100),
  supplierInvoiceDate: s.isoDate,
  /** the day we book the payable (default today in Bangkok) */
  billDate: s.isoDate.optional(),
  dueDate: s.isoDate.optional(),
  /** due = billDate + creditDays when dueDate is not given */
  creditDays: z.coerce.number().int().min(0).max(365).optional(),
  /** false = no full tax invoice (abbreviated / receipt only / seller not VAT-registered) — VAT is not ภาษีซื้อ */
  vatClaimable: z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v === 'auto' ? undefined : v), z.boolean().optional()),
  /** the WHT income type to suggest when paying (e.g. service) */
  whtIncomeType: IncomeType.optional(),
  note: z.string().max(1000).optional(),
  lockOverrideReason: z.string().trim().max(500).optional(),
});
const PoBillLines = z.array(z.object({ lineId: s.uuid, qty: s.positiveQty })).min(1);
const GoodsBillInput = BillHead.extend({ lines: PoBillLines.optional() });
const BillInput = BillHead.extend({
  kind: z.enum(['goods', 'service', 'expense']),
  /** goods: the PO, and optionally which received lines (default = everything received and not billed yet) */
  poId: s.uuid.optional(),
  poLines: PoBillLines.optional(),
  /** service / expense: free lines */
  vatMode: z.enum(['exclusive', 'inclusive', 'none']).default('exclusive'),
  lines: z.array(z.object({
    description: z.string().trim().min(1).max(500), qty: s.positiveQty.default(1), unitPrice: s.money,
    itemId: s.uuid.optional(), itemCode: z.string().trim().max(50).optional(),
  })).min(1).max(200).optional(),
});

const WhtLineInput = z.object({
  incomeType: IncomeType,
  description: z.string().trim().max(200).optional(),
  /** income before VAT (default: the pre-VAT part of what is paid now — only when there is one WHT line) */
  base: z.number().finite().positive().optional(),
  /** fraction 0.03; default = the type's standard rate */
  rate: z.number().finite().gt(0).lt(1).optional(),
});
const PayHead = z.object({
  paymentDate: s.isoDate.optional(),
  method: z.enum(['cash', 'transfer', 'cheque']).default('transfer'),
  wht: z.array(WhtLineInput).max(5).optional(),
  /* one-WHT-line shortcut for forms (ignored when `wht` is given): type, rate in percent (3 = 3%), base, description */
  whtIncomeType: z.enum([...WHT_INCOME_TYPE_CODES, 'none']).optional(),
  whtRatePercent: z.coerce.number().finite().gt(0).lt(100).optional(),
  whtBase: z.coerce.number().finite().positive().optional(),
  whtDescription: z.string().trim().max(200).optional(),
  /** override ภ.ง.ด.3 / ภ.ง.ด.53 (default from the supplier's tax ID) */
  form: z.preprocess((v) => (v === 'auto' ? undefined : v), Form.optional()),
  bankRef: z.string().trim().max(100).optional(),
  note: z.string().max(1000).optional(),
  lockOverrideReason: z.string().trim().max(500).optional(),
});
const PaymentInput = PayHead.extend({
  bills: z.array(z.object({ billId: s.uuid, amount: z.number().finite().positive().optional() })).min(1).max(50),
});
const BillPaymentInput = PayHead.extend({ amount: z.coerce.number().finite().positive().optional() });

const IdParam = z.object({ id: s.uuid });
const ReturnId = z.object({ id: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])_(PND3|PND53)$/, 'expected YYYY-MM_PND3 or YYYY-MM_PND53') });
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'งวดต้องเป็น YYYY-MM');

const KIND_TH: Record<string, string> = { goods: 'ค่าสินค้า (ตามใบสั่งซื้อ)', service: 'ค่าบริการ', expense: 'ค่าใช้จ่ายอื่น', opening: 'เจ้าหนี้ยกมา (จากระบบเดิม)' };
const METHOD_TH: Record<string, string> = { cash: 'เงินสด', transfer: 'โอนเงิน', cheque: 'เช็ค' };
const BILL_STATUS_TH: Record<string, string> = { open: 'ค้างจ่าย', partially_paid: 'จ่ายบางส่วน', paid: 'จ่ายครบ' };
const PND_BOXES = ['ภ.ง.ด.1ก', 'ภ.ง.ด.1ก พิเศษ', 'ภ.ง.ด.2', 'ภ.ง.ด.3', 'ภ.ง.ด.2ก', 'ภ.ง.ด.3ก', 'ภ.ง.ด.53'];
const CONDITIONS = ['(1) หัก ณ ที่จ่าย', '(2) ออกให้ตลอดไป', '(3) ออกให้ครั้งเดียว', '(4) อื่น ๆ'];
const box = (on: boolean) => (on ? '☑' : '☐');

function requireAny(a: AuthContext, perms: string[]) {
  if (!perms.some((p) => hasPerm(a, p))) requirePerm(a, perms[0]);
}

/* ------------------------------------------------ bills ------------------------------------------------ */

export async function loadBill(c: Client, id: string) {
  const b = await one(c, 'select * from supplier_bills where id = $1', [id], 'Supplier bill');
  b.lines = (await c.query('select * from supplier_bill_lines where bill_id = $1 order by line_no', [id])).rows;
  b.payments = (await c.query(
    `select p.id, p.no, p.payment_date, pb.amount, p.wht_total, p.method from supplier_payment_bills pb join supplier_payments p on p.id = pb.payment_id
     where pb.bill_id = $1 order by p.payment_date, p.no`, [id])).rows;
  return decorateBill(b);
}

function decorateBill(b: any) {
  return {
    ...b, outstanding: round(Number(b.gross) - Number(b.paid)), kind_label: KIND_TH[b.kind], status_label: BILL_STATUS_TH[b.status],
    wht_income_type_label: b.wht_income_type ? `${WHT_INCOME_TYPES[b.wht_income_type]?.nameTh ?? b.wht_income_type}${WHT_INCOME_TYPES[b.wht_income_type]?.rate ? ` ${round(WHT_INCOME_TYPES[b.wht_income_type].rate! * 100, 2)}%` : ''}` : null,
    vat_claimable_label: Number(b.vat) === 0 ? 'ไม่มี VAT' : b.vat_claimable ? 'ขอคืนได้ (ใบกำกับภาษีเต็มรูป)' : 'ขอคืนไม่ได้ — รวมเป็นต้นทุน',
  };
}

async function createBill(c: Client, k: Kernel, a: AuthContext, b: z.infer<typeof BillInput>) {
  const today = thaiToday();
  const billDate = b.billDate ?? today;
  if (billDate > today) throw fieldError('billDate', 'ลงวันที่ตั้งหนี้ล่วงหน้าไม่ได้');
  if (b.supplierInvoiceDate > today) throw fieldError('supplierInvoiceDate', 'วันที่ใบกำกับภาษีของผู้ขายเป็นวันในอนาคตไม่ได้');
  await guardLockDate(c, a, { module: 'purchasing', date: billDate, what: 'ตั้งหนี้', overrideReason: b.lockOverrideReason });

  let supplierId = b.supplierId ?? null;
  let supplierName = b.supplierName ?? null;
  let po: any = null;
  let vatMode: 'exclusive' | 'inclusive' | 'none' = b.vatMode;
  const lines: { poLineId: string | null; itemId: string | null; itemCode: string | null; description: string; qty: number; unitPrice: number }[] = [];

  if (b.kind === 'goods') {
    if (!b.poId) throw fieldError('poId', 'ค่าสินค้าต้องตั้งหนี้ตามใบสั่งซื้อ');
    if (b.lines) throw fieldError('lines', 'ค่าสินค้าตามใบสั่งซื้อ ใช้ poLines (รายการที่รับของแล้ว) ไม่ใช่ lines');
    po = await one(c, 'select * from purchase_orders where id = $1 for update', [b.poId], 'Purchase order');
    if (!['partially_received', 'received'].includes(po.status)) throw conflict(`ตั้งหนี้ไม่ได้: ${po.no} ยังไม่ได้รับของ — ตั้งหนี้ค่าสินค้าได้เฉพาะของที่รับแล้ว`);
    if (supplierId && po.supplier_id && supplierId !== po.supplier_id) throw fieldError('supplierId', `ผู้ขายไม่ตรงกับใบสั่งซื้อ ${po.no} (${po.supplier_name})`);
    supplierId = supplierId ?? po.supplier_id;
    supplierName = supplierName ?? po.supplier_name;
    vatMode = po.vat_mode;
    const poLines = (await c.query('select * from po_lines where po_id = $1 order by line_no for update', [po.id])).rows;
    const billable = (l: any) => round(Number(l.received_qty) - Number(l.returned_qty) - Number(l.billed_qty), 4);
    const wanted = b.poLines ?? poLines.filter((l) => billable(l) > 0).map((l) => ({ lineId: l.id, qty: billable(l) }));
    if (!wanted.length) throw conflict(`ไม่มีของที่รับแล้วค้างตั้งหนี้ใน ${po.no}`);
    for (const w of wanted) {
      const l = poLines.find((x) => x.id === w.lineId);
      if (!l) throw fieldError('poLines', `รายการที่เลือกไม่ได้อยู่ในใบสั่งซื้อ ${po.no}`);
      if (w.qty > billable(l) + 1e-9) {
        throw conflict(`รายการที่ ${l.line_no} (${l.item_code}): ตั้งหนี้ ${fmt(w.qty)} เกินจำนวนที่รับแล้วค้างตั้งหนี้ ${fmt(Math.max(0, billable(l)))} ` +
          `(รับ ${fmt(l.received_qty)} คืน ${fmt(l.returned_qty)} ตั้งหนี้แล้ว ${fmt(l.billed_qty)})`);
      }
      lines.push({ poLineId: l.id, itemId: l.item_id, itemCode: l.item_code, description: l.item_name ?? l.item_code, qty: w.qty, unitPrice: Number(l.unit_price) });
    }
  } else {
    if (b.poId || b.poLines) throw fieldError('poId', 'บิลค่าบริการ/ค่าใช้จ่ายไม่อ้างอิงใบสั่งซื้อ — ใช้ kind "goods" สำหรับค่าสินค้า');
    if (!b.lines?.length) throw fieldError('lines', 'ระบุรายการอย่างน้อย 1 รายการ');
    for (const l of b.lines) lines.push({ poLineId: null, itemId: l.itemId ?? null, itemCode: l.itemCode ?? null, description: l.description, qty: l.qty, unitPrice: l.unitPrice });
  }
  if (!supplierName) throw fieldError('supplierName', 'ระบุผู้ขาย');

  const t = vatMode === 'none' ? documentTotals(lines, 'exclusive', 0) : documentTotals(lines, vatMode);
  if (!(t.gross > 0)) throw fieldError('lines', 'ยอดรวมต้องมากกว่า 0');
  // input VAT is claimable only with a full tax invoice, which must show the seller's tax ID (มาตรา 86/4, 82/3)
  if (b.vatClaimable && t.vat > 0 && !b.supplierTaxId) throw fieldError('supplierTaxId', 'ใบกำกับภาษีเต็มรูปต้องมีเลขประจำตัวผู้เสียภาษีของผู้ขาย (มาตรา 86/4) — ไม่มีให้เลือก "ขอคืน VAT ไม่ได้"');
  const vatClaimable = t.vat > 0 && (b.vatClaimable ?? !!b.supplierTaxId);

  const dup = (await c.query(
    `select no from supplier_bills where lower(supplier_invoice_no) = lower($1)
       and (($2::uuid is not null and supplier_id = $2) or ($2::uuid is null and $3::text is not null and supplier_tax_id = $3 and coalesce(supplier_branch, '00000') = coalesce($4, '00000'))
            or ($2::uuid is null and $3::text is null and supplier_name = $5))`,
    [b.supplierInvoiceNo, supplierId, b.supplierTaxId ?? null, b.supplierBranch ?? null, supplierName])).rows[0];
  if (dup) throw conflict(`ใบกำกับภาษี/ใบแจ้งหนี้เลขที่ ${b.supplierInvoiceNo} ของผู้ขายนี้ตั้งหนี้แล้ว (${dup.no})`);

  const dueDate = b.dueDate ?? (b.creditDays !== undefined ? addDaysIso(billDate, b.creditDays) : null);
  const no = await nextDocNo(c, 'AP', new Date(billDate));
  const row = (await c.query(
    `insert into supplier_bills (no, kind, bill_date, due_date, supplier_id, supplier_code, supplier_name, supplier_tax_id, supplier_branch, supplier_address,
       supplier_invoice_no, supplier_invoice_date, po_id, po_no, vat_mode, net, vat, gross, vat_claimable, wht_income_type, note, created_by, created_by_name)
     values ($1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10,$11,$12::date,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) returning id`,
    [no, b.kind, billDate, dueDate, supplierId, b.supplierCode ?? null, supplierName, b.supplierTaxId ?? null, b.supplierBranch ?? (b.supplierTaxId ? '00000' : null),
      b.supplierAddress ?? null, b.supplierInvoiceNo, b.supplierInvoiceDate, po?.id ?? null, po?.no ?? null, vatMode, t.net, t.vat, t.gross, vatClaimable,
      b.whtIncomeType ?? null, b.note ?? null, a.userId, a.userName ?? null])).rows[0];
  for (const [i, l] of lines.entries()) {
    await c.query(
      `insert into supplier_bill_lines (bill_id, line_no, po_line_id, item_id, item_code, description, qty, unit_price, amount) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.id, i + 1, l.poLineId, l.itemId, l.itemCode, l.description, l.qty, l.unitPrice, t.amounts[i]]);
    if (l.poLineId) await c.query('update po_lines set billed_qty = billed_qty + $2 where id = $1', [l.poLineId, l.qty]);
  }
  await k.emit(c, 'purchasing.bill_recorded', {
    billId: row.id, billNo: no, billDate, dueDate,
    supplierId, supplierCode: b.supplierCode ?? null, supplierName, supplierTaxId: b.supplierTaxId ?? null, supplierBranch: b.supplierBranch ?? (b.supplierTaxId ? '00000' : null),
    supplierInvoiceNo: b.supplierInvoiceNo, supplierInvoiceDate: b.supplierInvoiceDate,
    kind: b.kind, poId: po?.id ?? null, poNo: po?.no ?? null, net: t.net, vat: t.vat, gross: t.gross, vatClaimable,
  });
  return loadBill(c, row.id);
}

/* ------------------------------------------------ payments ------------------------------------------------ */

export async function loadPayment(c: Client, id: string) {
  const p = await one(c, 'select * from supplier_payments where id = $1', [id], 'Supplier payment');
  p.bills = (await c.query(
    `select pb.bill_id, pb.bill_no, pb.amount, b.supplier_invoice_no, b.bill_date, b.gross as bill_gross, b.gross - b.paid as outstanding_now
     from supplier_payment_bills pb join supplier_bills b on b.id = pb.bill_id where pb.payment_id = $1 order by pb.bill_no`, [id])).rows;
  p.wht = (await c.query('select * from supplier_payment_wht where payment_id = $1 order by line_no', [id])).rows
    .map((w) => ({ ...w, rate_percent: round(Number(w.rate) * 100, 4), income_type_label: WHT_INCOME_TYPES[w.income_type]?.nameTh ?? w.income_type }));
  const cert = (await c.query('select certificate_no, print_count from wht_certificates where id = $1', [id])).rows[0];
  return {
    ...p, certificate_no: cert?.certificate_no ?? null, certificate_print_count: cert?.print_count ?? 0, has_wht: p.wht.length > 0,
    form_label: p.form ? WHT_FORM_TH[p.form as WhtForm] : 'ไม่หักภาษี ณ ที่จ่าย', method_label: METHOD_TH[p.method],
    warnings_text: (p.warnings as string[]).join(' · ') || null, net_paid_text: bahtText(Number(p.net_paid)),
  };
}

const supplierKey = (b: any) => b.supplier_id ?? (b.supplier_tax_id ? `tax:${b.supplier_tax_id}:${b.supplier_branch ?? '00000'}` : `name:${b.supplier_name}`);

async function pay(c: Client, k: Kernel, a: AuthContext, b: z.infer<typeof PaymentInput>) {
  const today = thaiToday();
  const paymentDate = b.paymentDate ?? today;
  if (paymentDate > today) throw fieldError('paymentDate', 'ลงวันที่จ่ายล่วงหน้าไม่ได้ — บันทึกเมื่อจ่ายจริง');
  await guardLockDate(c, a, { module: 'purchasing', date: paymentDate, what: 'จ่ายชำระหนี้', overrideReason: b.lockOverrideReason });
  if (new Set(b.bills.map((x) => x.billId)).size !== b.bills.length) throw fieldError('bills', 'เลือกบิลซ้ำ');

  const bills: any[] = [];
  for (const x of [...b.bills].sort((p, q) => p.billId.localeCompare(q.billId))) {
    bills.push(await one(c, 'select * from supplier_bills where id = $1 for update', [x.billId], 'Supplier bill'));
  }
  if (new Set(bills.map(supplierKey)).size > 1) throw fieldError('bills', 'ใบสำคัญจ่ายหนึ่งใบจ่ายได้เฉพาะบิลของผู้ขายรายเดียวกัน');
  const warnings: string[] = [];
  const settle: { bill: any; amount: number }[] = [];
  for (const x of b.bills) {
    const bill = bills.find((y) => y.id === x.billId)!;
    const outstanding = round(Number(bill.gross) - Number(bill.paid));
    if (outstanding <= 0) throw conflict(`${bill.no} จ่ายครบแล้ว`);
    const amount = round(x.amount ?? outstanding);
    if (amount > outstanding + 1e-9) throw conflict(`จ่ายเกินยอดค้าง: ${bill.no} ค้างจ่าย ${baht(outstanding)} บาท แต่จะจ่าย ${baht(amount)} บาท`);
    if (bill.bill_date > paymentDate) warnings.push(`${bill.no} ตั้งหนี้วันที่ ${bill.bill_date} หลังวันที่จ่าย`);
    settle.push({ bill, amount });
  }
  const gross = round(settle.reduce((s2, x) => s2 + x.amount, 0));
  // the part of what is paid now that is before VAT — the default WHT base (ท.ป.4/2528: WHT is not computed on VAT)
  const preVat = round(settle.reduce((s2, x) => s2 + round(x.amount * Number(x.bill.net) / Number(x.bill.gross)), 0));

  const lines = b.wht ?? (b.whtIncomeType && b.whtIncomeType !== 'none'
    ? [{ incomeType: b.whtIncomeType, rate: b.whtRatePercent !== undefined ? round(b.whtRatePercent / 100, 6) : undefined, base: b.whtBase, description: b.whtDescription }]
    : []);
  if (lines.length > 1 && lines.some((l) => l.base === undefined)) throw fieldError('wht', 'หักภาษีหลายประเภทในใบเดียว ต้องระบุฐานเงินได้ (base) ทุกบรรทัด');
  const wht = lines.map((l, i) => {
    const base = round(l.base ?? preVat);
    try {
      const r = checkWhtLine({ incomeType: l.incomeType, base, rate: l.rate, description: l.description });
      warnings.push(...r.warnings);
      return { lineNo: i + 1, incomeType: l.incomeType, description: r.description, rate: r.rate, base, amount: r.amount };
    } catch (e) {
      throw fieldError('wht', (e as Error).message);
    }
  });
  const baseTotal = round(wht.reduce((s2, w) => s2 + w.base, 0));
  if (baseTotal > gross + 1e-9) throw fieldError('wht', `ฐานเงินได้รวม ${baht(baseTotal)} บาท มากกว่ายอดที่จ่ายครั้งนี้ ${baht(gross)} บาท`);
  if (baseTotal > preVat + 0.005) warnings.push(`ฐานเงินได้ ${baht(baseTotal)} บาท มากกว่ายอดก่อน VAT ที่จ่ายครั้งนี้ (${baht(preVat)} บาท) — ภาษีหัก ณ ที่จ่ายคิดจากยอดก่อน VAT`);
  if (!wht.length) {
    const suggested = [...new Set(bills.map((x) => x.wht_income_type).filter(Boolean))];
    if (suggested.length) warnings.push(`บิลระบุว่าเป็น${suggested.map((t) => WHT_INCOME_TYPES[t]?.nameTh ?? t).join('/')} แต่ไม่ได้หักภาษี ณ ที่จ่าย`);
  }
  const whtTotal = round(wht.reduce((s2, w) => s2 + w.amount, 0));
  const netPaid = round(gross - whtTotal);

  // payee snapshot: the latest bill (tax ID from any bill that has one)
  const latest = [...bills].sort((p, q) => String(q.created_at).localeCompare(String(p.created_at)))[0];
  const withTax = bills.find((x) => x.supplier_tax_id);
  const payee = {
    id: latest.supplier_id, code: latest.supplier_code, name: latest.supplier_name, taxId: withTax?.supplier_tax_id ?? null,
    branch: withTax?.supplier_branch ?? null, address: bills.find((x) => x.supplier_address)?.supplier_address ?? null,
  };
  let form: WhtForm | null = null;
  if (wht.length) {
    const expected = whtFormFor(payee.taxId, payee.name);
    form = b.form ?? expected;
    if (form !== expected) warnings.push(`เลือก ${WHT_FORM_TH[form]} แต่${payee.taxId ? 'เลขผู้เสียภาษี' : 'ชื่อ'}ผู้ขายบ่งว่าเป็น ${WHT_FORM_TH[expected]} — ตรวจว่าผู้ถูกหักเป็นนิติบุคคลหรือบุคคลธรรมดา`);
    if (!payee.taxId) warnings.push('ผู้ขายไม่มีเลขประจำตัวผู้เสียภาษีในบิล — ใบแนบ ภ.ง.ด. และ 50 ทวิ ต้องมีเลขนี้ (เพิ่มในข้อมูลผู้ขายแล้วตั้งหนี้ใหม่ หรือกรอกเองตอนยื่น)');
  }

  const no = await nextDocNo(c, 'PV', new Date(paymentDate));
  const row = (await c.query(
    `insert into supplier_payments (no, payment_date, method, supplier_id, supplier_code, supplier_name, supplier_tax_id, supplier_branch, supplier_address,
       form, gross, wht_total, net_paid, bank_ref, note, warnings, created_by, created_by_name)
     values ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
    [no, paymentDate, b.method, payee.id, payee.code, payee.name, payee.taxId, payee.branch, payee.address, form, gross, whtTotal, netPaid,
      b.bankRef ?? null, b.note ?? null, JSON.stringify(warnings), a.userId, a.userName ?? null])).rows[0];
  for (const x of settle) {
    await c.query('insert into supplier_payment_bills (payment_id, bill_id, bill_no, amount) values ($1,$2,$3,$4)', [row.id, x.bill.id, x.bill.no, x.amount]);
    await c.query(
      `update supplier_bills set paid = paid + $2, status = case when paid + $2 >= gross - 0.00005 then 'paid' else 'partially_paid' end where id = $1`, [x.bill.id, x.amount]);
  }
  for (const w of wht) {
    await c.query(
      `insert into supplier_payment_wht (payment_id, line_no, income_type, description, rate, base, amount) values ($1,$2,$3,$4,$5,$6,$7)`,
      [row.id, w.lineNo, w.incomeType, w.description, w.rate, w.base, w.amount]);
  }
  let certificateNo = '';
  if (wht.length) {
    // 50 ทวิ numbering per tenant: เล่มที่ = Buddhist-era year, เลขที่ = running number in that year (WHT-2569-0001)
    certificateNo = await nextDocNo(c, 'WHT', new Date(paymentDate));
    const [, book, number] = certificateNo.split('-');
    await c.query('insert into wht_certificates (id, certificate_no, book_no, number, form) values ($1,$2,$3,$4,$5)', [row.id, certificateNo, book, number, form]);
  }
  await k.emit(c, 'purchasing.supplier_paid', {
    paymentId: row.id, paymentNo: no, paymentDate, method: b.method, supplierId: payee.id, supplierName: payee.name, supplierTaxId: payee.taxId,
    bills: settle.map((x) => ({ billId: x.bill.id, billNo: x.bill.no, amount: x.amount })), gross, netPaid,
    wht: wht.map((w) => ({ form: form!, incomeType: w.incomeType, description: w.description, rate: w.rate, base: w.base, amount: w.amount, certificateNo })),
  });
  return loadPayment(c, row.id);
}

/* ------------------------------------------------ WHT returns ------------------------------------------------ */

/** [first day, first day of the next month) of a YYYY-MM period */
const monthRange = (period: string) => [`${period}-01`, `${addDaysIso(`${period}-28`, 4).slice(0, 7)}-01`] as const;

/** The ใบแนบ rows of one month and form, in filing order (payment date, PV no); ลำดับที่ per payment (= per 50 ทวิ). */
async function returnRows(c: Client, period: string, form: WhtForm) {
  const [from, to] = monthRange(period);
  const raw = (await c.query(
    `select p.id as payment_id, p.no as payment_no, p.payment_date, p.supplier_name, p.supplier_tax_id, p.supplier_branch, p.supplier_address,
            w.line_no, w.income_type, w.description, w.rate, w.base, w.amount, w.condition, wc.certificate_no
     from supplier_payments p join supplier_payment_wht w on w.payment_id = p.id left join wht_certificates wc on wc.id = p.id
     where p.form = $1 and p.payment_date >= $2::date and p.payment_date < $3::date
     order by p.payment_date, p.no, w.line_no`, [form, from, to])).rows;
  let seq = 0;
  let last = '';
  return raw.map((r) => {
    if (r.payment_id !== last) { seq += 1; last = r.payment_id; }
    const row: WhtReturnRow = {
      seq, taxId: r.supplier_tax_id, branch: r.supplier_branch, name: r.supplier_name, address: r.supplier_address, paidDate: r.payment_date,
      incomeType: r.description, rate: Number(r.rate), amount: Number(r.base), tax: Number(r.amount), condition: r.condition,
    };
    return { row, view: {
      id: `${r.payment_id}_${r.line_no}`, payment_id: r.payment_id, payment_no: r.payment_no, certificate_no: r.certificate_no,
      seq, tax_id: r.supplier_tax_id ?? '', branch: r.supplier_branch ?? '', name: r.supplier_name, address: r.supplier_address ?? '',
      paid_date: r.payment_date, income_type: r.description, rate_percent: round(Number(r.rate) * 100, 4), amount: Number(r.base), tax: Number(r.amount),
      condition: r.condition, condition_label: r.condition === '1' ? 'หัก ณ ที่จ่าย' : r.condition === '2' ? 'ออกให้ตลอดไป' : 'ออกให้ครั้งเดียว',
    } };
  });
}

async function returnSummary(c: Client, period: string, form: WhtForm) {
  const rows = await returnRows(c, period, form);
  const t = whtTotals(rows.map((r) => r.row));
  const due = whtDueDates(period);
  return {
    id: `${period}_${form}`, period, period_label: formatThaiMonth(period), form, form_label: WHT_FORM_TH[form],
    title: `${WHT_FORM_TH[form]} เดือน${formatThaiMonth(period)}`,
    due_paper: due.paper, due_efiling: due.efiling,
    due_text: `ยื่นแบบกระดาษภายใน ${formatThaiDate(due.paper)} · ยื่นทางอินเทอร์เน็ต (e-Filing) ภายใน ${formatThaiDate(due.efiling)} — วันครบกำหนดตรงวันหยุดให้ตรวจประกาศกรมสรรพากร`,
    payees: t.payees, lines: t.lines, total_amount: t.amount, total_tax: t.tax, total_tax_text: bahtText(t.tax),
    filing_note: 'ระบบนี้ไม่ได้ยื่นแบบให้ — นำยอดและใบแนบไปยื่นเองทางกระดาษ หรือ RD Prep / e-Filing ของกรมสรรพากร',
    rd_note: RD_PREP_DISCLAIMER,
    rd_columns: RD_PREP_COLUMNS[form].map((col, i) => `${i + 1}. ${col.th} (${col.format})`).join(' | '),
    rows: rows.map((r) => r.view), _rows: rows.map((r) => r.row),
  };
}

/* ------------------------------------------------ routes ------------------------------------------------ */

export function payablesRoutes(app: App, k: Kernel) {
  /* ---- bills ---- */
  app.post('/bills', async (req, reply) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.bill.write');
    const b = parse(BillInput, blankless(req.body ?? {}));
    reply.code(201);
    return k.db.tx(a.tenantId, (c) => createBill(c, k, a, b));
  });

  /** Goods bill straight from a PO (the PO detail action): omit `lines` = everything received and not billed yet. */
  app.post('/purchase-orders/:id/bills', async (req, reply) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.bill.write');
    const { id } = parse(IdParam, req.params);
    const b = parse(GoodsBillInput, blankless(req.body ?? {}));
    reply.code(201);
    const { lines, ...head } = b;
    return k.db.tx(a.tenantId, (c) => createBill(c, k, a, { ...head, kind: 'goods', poId: id, poLines: lines, vatMode: 'exclusive' }));
  });

  app.get('/bills', async (req) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.bill.read');
    const q = parse(s.listQuery.extend({ status: z.enum(['open', 'partially_paid', 'paid', 'unpaid']).optional(), supplierId: s.uuid.optional(), kind: z.enum(['goods', 'service', 'expense', 'opening']).optional() }), req.query);
    return k.db.tx(a.tenantId, async (c) => (await c.query(
      `select * from supplier_bills
       where ($1::text is null or ($1 = 'unpaid' and status <> 'paid') or status = $1) and ($2::uuid is null or supplier_id = $2) and ($3::text is null or kind = $3)
         and ($4::text is null or no ilike $4 or supplier_name ilike $4 or supplier_invoice_no ilike $4 or po_no ilike $4)
       order by bill_date desc, no desc limit $5 offset $6`,
      [q.status ?? null, q.supplierId ?? null, q.kind ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows.map(decorateBill));
  });

  /** เจ้าหนี้ยกมา: supplier invoices carried over from the old system (bills of kind opening). */
  app.get('/opening-payables', async (req) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.bill.read');
    const q = parse(s.listQuery, req.query);
    return k.db.tx(a.tenantId, async (c) => (await c.query(
      `select * from supplier_bills where kind = 'opening' and ($1::text is null or no ilike $1 or supplier_name ilike $1 or supplier_invoice_no ilike $1)
       order by coalesce(due_date, bill_date), no limit $2 offset $3`, [q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows.map(decorateBill));
  });

  /**
   * เจ้าหนี้ยกมา from Excel: `{ rows: [{ partnerCode, partnerId…(resolved by master-data), docNo, docDate, dueDate, amount, note }], dryRun }`.
   * Each row becomes a bill of kind "opening" (own AP number, the supplier's invoice number kept); refused when that supplier's invoice
   * number is already on a bill. No event: no input VAT, no expense or stock posting — the ledger's payable comes from the accounting
   * opening balance. Paid with normal payment vouchers.
   */
  app.post('/opening-payables/import', async (req) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.bill.write');
    const body = parse(z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000), dryRun: z.boolean().default(false) }), req.body);
    return k.db.tx(a.tenantId, async (c) => {
      const { valid, errors } = checkOpeningDocs(body.rows, 'supplier', thaiToday());
      const taken = new Set((await c.query<{ k: string }>(
        `select supplier_id::text || '|' || lower(supplier_invoice_no) as k from supplier_bills where supplier_id = any($1::uuid[])`,
        [[...new Set(valid.map((v) => v.partnerId))]])).rows.map((r) => r.k));
      const ok = valid.filter((v) => {
        if (!taken.has(`${v.partnerId}|${v.docNo.toLowerCase()}`)) return true;
        errors.push({ row: v.row, field: 'docNo', message: `ใบแจ้งหนี้ ${v.docNo} ของ ${v.partnerName} ตั้งหนี้ไว้แล้ว` });
        return false;
      });
      errors.sort((x, y) => x.row - y.row);
      const result = { dryRun: body.dryRun || errors.length > 0, total: body.rows.length, created: ok.length, updated: 0, errors };
      if (result.dryRun) return result;
      for (const v of ok) {
        const no = await nextDocNo(c, 'AP', new Date(v.docDate));
        const bill = (await c.query(
          `insert into supplier_bills (no, kind, bill_date, due_date, supplier_id, supplier_code, supplier_name, supplier_tax_id, supplier_branch, supplier_address,
             supplier_invoice_no, supplier_invoice_date, vat_mode, net, vat, gross, vat_claimable, note, created_by, created_by_name)
           values ($1, 'opening', $2::date, $3::date, $4, $5, $6, $7, $8, $9, $10, $2::date, 'none', $11, 0, $11, false, $12, $13, $14) returning id`,
          [no, v.docDate, v.dueDate, v.partnerId, v.partnerCode, v.partnerName, v.taxId, v.branch, v.address, v.docNo, v.amount,
            v.note ?? 'เจ้าหนี้ยกมาจากระบบเดิม', a.userId, a.userName ?? null])).rows[0];
        await c.query(
          `insert into supplier_bill_lines (bill_id, line_no, description, qty, unit_price, amount) values ($1, 1, $2, 1, $3, $3)`,
          [bill.id, `ยอดยกมา ตามใบแจ้งหนี้ ${v.docNo}`, v.amount]);
      }
      return result;
    });
  });

  app.get('/bills/:id', async (req) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.bill.read');
    const { id } = parse(IdParam, req.params);
    return k.db.tx(a.tenantId, (c) => loadBill(c, id));
  });

  /** Open payables as of a day (default today) with days overdue and the aging bucket. */
  app.get('/payables', async (req) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.bill.read');
    const q = parse(s.listQuery.extend({ asOf: s.isoDate.optional(), supplierId: s.uuid.optional(), overdue: z.enum(['true', 'false', '1', '0']).optional() }), req.query);
    const asOf = q.asOf ?? thaiToday();
    return k.db.tx(a.tenantId, async (c) => (await c.query(
      `select * from (
         select b.*, b.gross - b.paid as outstanding, coalesce(b.due_date, b.bill_date) as due_on, $1::date - coalesce(b.due_date, b.bill_date) as days_overdue
         from supplier_bills b where b.status <> 'paid' and b.bill_date <= $1::date) x
       where ($2::uuid is null or supplier_id = $2) and ($3::text is null or no ilike $3 or supplier_name ilike $3 or supplier_invoice_no ilike $3)
         and ($4::boolean is null or (days_overdue > 0) = $4)
       order by due_on, no limit $5 offset $6`,
      [asOf, q.supplierId ?? null, q.q ? `%${q.q}%` : null, q.overdue === undefined ? null : q.overdue === 'true' || q.overdue === '1', q.limit, q.offset])).rows
      .map((r) => ({ ...decorateBill(r), outstanding: Number(r.outstanding), bucket: bucketOf(Number(r.days_overdue)) })));
  });

  /** Aging per supplier (ยังไม่ครบกำหนด / 1–30 / 31–60 / 61–90 / เกิน 90 วัน) as of a day. */
  app.get('/payables/aging', async (req) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.bill.read');
    const q = parse(z.object({ asOf: s.isoDate.optional() }), req.query);
    const asOf = q.asOf ?? thaiToday();
    return k.db.tx(a.tenantId, async (c) => {
      const rows = (await c.query(
        `with o as (select supplier_name, coalesce(supplier_id::text, supplier_tax_id, supplier_name) as sk, gross - paid as amt,
                           $1::date - coalesce(due_date, bill_date) as d from supplier_bills where status <> 'paid' and bill_date <= $1::date)
         select sk as id, min(supplier_name) as supplier_name, count(*)::int as bills,
                coalesce(sum(amt) filter (where d <= 0), 0) as not_due, coalesce(sum(amt) filter (where d between 1 and 30), 0) as d1_30,
                coalesce(sum(amt) filter (where d between 31 and 60), 0) as d31_60, coalesce(sum(amt) filter (where d between 61 and 90), 0) as d61_90,
                coalesce(sum(amt) filter (where d > 90), 0) as over_90, sum(amt) as total
         from o group by sk order by min(supplier_name)`, [asOf])).rows;
      const sum = (key: string) => round(rows.reduce((s2, r) => s2 + Number(r[key]), 0));
      return { asOf, rows, totals: { not_due: sum('not_due'), d1_30: sum('d1_30'), d31_60: sum('d31_60'), d61_90: sum('d61_90'), over_90: sum('over_90'), total: sum('total') } };
    });
  });

  /* ---- payments ---- */
  app.post('/supplier-payments', async (req, reply) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.payment.write');
    const b = parse(PaymentInput, blankless(req.body ?? {}));
    reply.code(201);
    return k.db.tx(a.tenantId, (c) => pay(c, k, a, b));
  });

  /** Pay one bill (the bill detail action); `amount` default = all outstanding. */
  app.post('/bills/:id/payments', async (req, reply) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.payment.write');
    const { id } = parse(IdParam, req.params);
    const { amount, ...rest } = parse(BillPaymentInput, blankless(req.body ?? {}));
    reply.code(201);
    return k.db.tx(a.tenantId, (c) => pay(c, k, a, { ...rest, bills: [{ billId: id, amount }] }));
  });

  app.get('/supplier-payments', async (req) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.payment.read');
    const q = parse(s.listQuery.extend({ period: Period.optional(), supplierId: s.uuid.optional(), form: Form.optional() }), req.query);
    return k.db.tx(a.tenantId, async (c) => (await c.query(
      `select p.*, wc.certificate_no, (select string_agg(bill_no, ', ' order by bill_no) from supplier_payment_bills pb where pb.payment_id = p.id) as bill_nos
       from supplier_payments p left join wht_certificates wc on wc.id = p.id
       where ($1::text is null or to_char(p.payment_date, 'YYYY-MM') = $1) and ($2::uuid is null or p.supplier_id = $2) and ($3::text is null or p.form = $3)
         and ($4::text is null or p.no ilike $4 or p.supplier_name ilike $4 or wc.certificate_no ilike $4)
       order by p.payment_date desc, p.no desc limit $5 offset $6`,
      [q.period ?? null, q.supplierId ?? null, q.form ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows
      .map((p) => ({ ...p, form_label: p.form ? WHT_FORM_TH[p.form as WhtForm] : '', method_label: METHOD_TH[p.method] })));
  });

  app.get('/supplier-payments/:id', async (req) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.payment.read');
    const { id } = parse(IdParam, req.params);
    return k.db.tx(a.tenantId, (c) => loadPayment(c, id));
  });

  /* ---- 50 ทวิ ---- */
  app.get('/wht-certificates', async (req) => {
    const a = auth(req);
    requireAny(a, ['purchasing.wht.read', 'purchasing.payment.read']);
    const q = parse(s.listQuery.extend({ period: Period.optional(), form: Form.optional() }), req.query);
    return k.db.tx(a.tenantId, async (c) => (await c.query(
      `select wc.id, wc.certificate_no, wc.book_no, wc.number, wc.form, wc.print_count, p.no as payment_no, p.payment_date, p.supplier_name, p.supplier_tax_id,
              p.gross, p.wht_total, p.net_paid, (select sum(base) from supplier_payment_wht w where w.payment_id = p.id) as wht_base
       from wht_certificates wc join supplier_payments p on p.id = wc.id
       where ($1::text is null or to_char(p.payment_date, 'YYYY-MM') = $1) and ($2::text is null or wc.form = $2)
         and ($3::text is null or wc.certificate_no ilike $3 or p.no ilike $3 or p.supplier_name ilike $3 or p.supplier_tax_id ilike $3)
       order by p.payment_date desc, wc.certificate_no desc limit $4 offset $5`,
      [q.period ?? null, q.form ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows
      .map((r) => ({ ...r, form_label: WHT_FORM_TH[r.form as WhtForm] })));
  });

  /** The certificate (id = the payment's id) with everything the 50 ทวิ form prints. The payer = the company letterhead (identity). */
  app.get('/wht-certificates/:id', async (req) => {
    const a = auth(req);
    requireAny(a, ['purchasing.wht.read', 'purchasing.payment.read']);
    const { id } = parse(IdParam, req.params);
    return k.db.tx(a.tenantId, async (c) => {
      const cert = (await c.query('select * from wht_certificates where id = $1', [id])).rows[0];
      if (!cert) throw notFound('WHT certificate');
      const p = await loadPayment(c, id);
      const period = String(p.payment_date).slice(0, 7);
      const seq = (await returnRows(c, period, cert.form)).find((r) => r.view.payment_id === id)?.view.seq ?? null;
      const formTh = WHT_FORM_TH[cert.form as WhtForm];
      return {
        id, heading: `${cert.certificate_no}`, certificate_no: cert.certificate_no, book_no: cert.book_no, number: cert.number,
        payer_text: 'ผู้มีหน้าที่หักภาษี ณ ที่จ่าย: ชื่อ ที่อยู่ และเลขประจำตัวผู้เสียภาษีอากรตามหัวกระดาษ',
        payee_name: p.supplier_name, payee_tax_id: p.supplier_tax_id ?? '', payee_branch: p.supplier_branch ? (p.supplier_branch === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${p.supplier_branch}`) : '',
        payee_address: p.supplier_address ?? '',
        seq_in_form: seq, seq_text: `ลำดับที่ ${seq ?? '…'} ในแบบ ${formTh} เดือน${formatThaiMonth(period)}`,
        form: cert.form, form_label: formTh,
        form_boxes: PND_BOXES.map((f) => `${box(f === formTh)} ${f}`).join('   '),
        payment_no: p.no, payment_date: p.payment_date, paid_date_text: thaiSlashDate(p.payment_date),
        lines: p.wht.map((w: any) => ({
          line_no: w.line_no,
          income_type: `5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส — ${w.description}`,
          rate_percent: w.rate_percent, paid_date: p.payment_date, amount: Number(w.base), tax: Number(w.amount),
        })),
        total_paid: round(p.wht.reduce((s2: number, w: any) => s2 + Number(w.base), 0)), total_tax: Number(p.wht_total), total_tax_text: bahtText(Number(p.wht_total)),
        condition_boxes: CONDITIONS.map((t, i) => `${box(i === 0)} ${t}`).join('   '),
        certify_text: 'ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ',
        warning_text: 'คำเตือน: ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร',
        signer_name: p.created_by_name ?? '', print_count: cert.print_count,
        copy_1: 'ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)',
        copy_2: 'ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)',
      };
    });
  });

  /** Log that a copy of the certificate is being printed (reprint count for the auditor); answers `{ id }` for the print screen. */
  app.post('/wht-certificates/:id/print', async (req) => {
    const a = auth(req);
    requireAny(a, ['purchasing.wht.read', 'purchasing.payment.read']);
    const { id } = parse(IdParam, req.params);
    return k.db.tx(a.tenantId, async (c) => {
      const r = (await c.query(
        'update wht_certificates set print_count = print_count + 1, last_printed_at = now(), last_printed_by_name = $2 where id = $1 returning id, print_count', [id, a.userName ?? null])).rows[0];
      if (!r) throw notFound('WHT certificate');
      return r;
    });
  });

  /* ---- monthly returns ---- */
  app.get('/wht/returns', async (req) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.wht.read');
    const q = parse(z.object({ year: z.coerce.number().int().optional() }), req.query);
    return k.db.tx(a.tenantId, async (c) => (await c.query(
      `select to_char(p.payment_date, 'YYYY-MM') as period, p.form, count(distinct p.id)::int as payees, sum(w.base) as total_amount, sum(w.amount) as total_tax
       from supplier_payments p join supplier_payment_wht w on w.payment_id = p.id
       where p.form is not null and ($1::int is null or extract(year from p.payment_date) = $1)
       group by 1, 2 order by 1 desc, 2`, [q.year ? (q.year > 2400 ? q.year - 543 : q.year) : null])).rows
      .map((r) => {
        const due = whtDueDates(r.period);
        return { ...r, id: `${r.period}_${r.form}`, period_label: formatThaiMonth(r.period), form_label: WHT_FORM_TH[r.form as WhtForm], due_paper: due.paper, due_efiling: due.efiling };
      }));
  });

  app.get('/wht/returns/:id', async (req) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.wht.read');
    const { id } = parse(ReturnId, req.params);
    const [period, form] = id.split('_') as [string, WhtForm];
    return k.db.tx(a.tenantId, async (c) => {
      const { _rows, ...r } = await returnSummary(c, period, form);
      return { ...r, rd_text: buildRdPrepText(_rows, form) };
    });
  });

  /**
   * Download the ใบแนบ: `format=csv` (UTF-8 BOM, Thai headers, total row) or `format=rd` — pipe-delimited text for RD Prep,
   * `encoding=tis620` (default) or `utf8`. The RD layout is UNVERIFIED (see RD_PREP_COLUMNS) — ต้องตรวจกับโปรแกรม RD Prep เวอร์ชันล่าสุดก่อนยื่นจริง.
   */
  app.get('/wht/returns/:id/export', async (req, reply) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.wht.read');
    const { id } = parse(ReturnId, req.params);
    const q = parse(z.object({ format: z.enum(['csv', 'rd']).default('csv'), encoding: z.enum(['tis620', 'utf8']).default('tis620') }), req.query);
    const [period, form] = id.split('_') as [string, WhtForm];
    const rows = await k.db.tx(a.tenantId, async (c) => (await returnRows(c, period, form)).map((r) => r.row));
    const base = `${form}_${Number(period.slice(0, 4)) + 543}${period.slice(5)}`;
    reply.header('cache-control', 'no-store');
    if (q.format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${base}.csv"`);
      return buildWhtCsv(rows, form);
    }
    const text = buildRdPrepText(rows, form);
    reply.header('x-rd-prep-layout', 'unverified');
    if (q.encoding === 'utf8') {
      reply.header('content-type', 'text/plain; charset=utf-8').header('content-disposition', `attachment; filename="${base}_rdprep.txt"`);
      return text;
    }
    reply.header('content-type', 'text/plain; charset=tis-620').header('content-disposition', `attachment; filename="${base}_rdprep.txt"`);
    return Buffer.from(toTis620(text));
  });

  /** The ใบแนบ rows as a plain list (period + form filters) — the web's list "ส่งออก CSV" button gives the spreadsheet. */
  app.get('/wht/attachment-rows', async (req) => {
    const a = auth(req);
    requirePerm(a, 'purchasing.wht.read');
    const q = parse(z.object({ period: Period.optional(), form: Form.default('PND53') }), req.query);
    const period = q.period ?? thaiToday().slice(0, 7);
    return k.db.tx(a.tenantId, async (c) => (await returnRows(c, period, q.form)).map((r) => r.view));
  });
}

function bucketOf(days: number) {
  if (days <= 0) return 'ยังไม่ครบกำหนด';
  if (days <= 30) return '1–30 วัน';
  if (days <= 60) return '31–60 วัน';
  if (days <= 90) return '61–90 วัน';
  return 'เกิน 90 วัน';
}
