/**
 * Demo data for the wave-9 Thai-tax features — all through the real HTTP APIs, as the people who would do it:
 *
 * - `seedTaxDocuments` (before the books are closed — documents of past months must be dated before the lock):
 *   - Sales (acc@): ใบลดหนี้ — a price reduction (powder coat under spec), goods returned to stock (dented cases) and, this month,
 *     a small transport-damage discount; ใบเพิ่มหนี้ — goods delivered over the order and kept by the customer.
 *   - Purchasing: the buyer records the supplier tax invoice of every received PO (goods bills, matched against the receipts);
 *     accounting records service bills — freight (ภ.ง.ด.53 1%), machine repair / overhaul (3%), warehouse rent from an
 *     individual landlord (no VAT, ภ.ง.ด.3 5%) — and supplies bills (expense, no WHT). Older bills are paid around their due
 *     date (with WHT → 50 ทวิ), last month's are mostly open, the press overhaul is half paid (retention), so payables and aging look alive.
 * - `seedTaxFilings` (after closeBooks): closes the earlier months, records the ภ.พ.30 filed for every past month with VAT
 *   (efiling, fictional "RD-DEMO-…" receipt numbers, paid = due; the overhaul month carries its excess forward) — only this month stays
 *   unfiled — and sets up e-Tax: seller profile, XML generated for recent documents (NOT signed: no company certificate in the demo;
 *   the test fixture certificate is not labelled as a test certificate by the module, so it is not uploaded), two recorded as sent
 *   through e-Tax Invoice by Email.
 *
 * Idempotent like the rest of the seed (runs once per fresh company; DEMO_RESET=1 starts over): each part checks for its own data.
 * Dates are relative to "today" in Asia/Bangkok (the clock helpers of demo-finance.ts), so the demo always looks current.
 */
import { addDays, monthEnd, monthStart, today, waitFor, weekdayOnOrBefore } from './demo-finance.ts';

type Call = <T = any>(method: string, path: string, body?: unknown) => Promise<T>;
export interface TaxCtx {
  call: Call;
  as: Record<string, Call>;
  partners: Record<string, any>;
  has: (module: string) => boolean;
}

/* ------------------------------------------------------------------ dates ------------------------------------------------------------------ */

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const monthTh = (date: string) => `${TH_MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(0, 4)) + 543}`;
const be = (date: string) => Number(date.slice(0, 4)) + 543;
const minDate = (...d: string[]) => d.sort()[0];
const maxDate = (...d: string[]) => d.sort().at(-1)!;
/** day `day` of month `n` (0 = this month, -1 = last month), clamped to that month's end and to today */
const on = (n: number, day: number) => minDate(addDays(monthStart(n), day - 1), monthEnd(n), today());
/** month offset of a date relative to this month (0 = this month, -1 = last month …) */
const offsetOf = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  const [ty, tm] = today().split('-').map(Number);
  return (y - ty) * 12 + (m - tm);
};
/** a payment date for a past month: a weekday, on/after the bill, never after last month's end (that month is closed next) */
const payDay = (wanted: string, billDate: string) => maxDate(billDate, weekdayOnOrBefore(minDate(wanted, monthEnd(-1), today())));

/* ------------------------------------------------------------------ parties ------------------------------------------------------------------ */

/** Service suppliers of the demo factory. Tax IDs are made up (valid check digit); the landlord's starts with 3 (a person → ภ.ง.ด.3, province 99 = fictitious). */
const SERVICE_SUPPLIERS: [string, string, string, string][] = [
  ['S-004', 'บริษัท ขนส่งด่วนบางนา จำกัด', '0115556013577', '19/5 หมู่ 6 ถนนเทพารักษ์ ตำบลบางเสาธง อำเภอบางเสาธง จังหวัดสมุทรปราการ 10570'],
  ['S-005', 'บริษัท ไฮดรอลิก แอนด์ แมชชีน เซอร์วิส จำกัด', '0105539045679', '120 ถนนพุทธบูชา แขวงบางมด เขตจอมทอง กรุงเทพมหานคร 10150'],
  ['S-006', 'นายสมบัติ เจริญทรัพย์', '3999900012344', '88/2 หมู่ 4 ตำบลแพรกษา อำเภอเมืองสมุทรปราการ จังหวัดสมุทรปราการ 10280'],
  ['S-007', 'บริษัท เซฟตี้ แอนด์ ทูลส์ ซัพพลาย จำกัด', '0105559031410', '210 ถนนศรีนครินทร์ ตำบลบางเมือง อำเภอเมืองสมุทรปราการ จังหวัดสมุทรปราการ 10270'],
];

async function ensureSuppliers(x: TaxCtx): Promise<Record<string, any>> {
  const who = x.as.buyer ?? x.call;
  const all = await who<any[]>('GET', '/api/master-data/partners?limit=500');
  const byCode: Record<string, any> = Object.fromEntries(all.map((p) => [p.code, p]));
  for (const [code, name, taxId, address] of SERVICE_SUPPLIERS) {
    if (!byCode[code]) byCode[code] = await who('POST', '/api/master-data/partners', { code, name, kind: 'supplier', taxId, branch: '00000', address });
  }
  return byCode;
}

const supplierOf = (p: any) => ({
  supplierId: p.id, supplierCode: p.code, supplierName: p.name, ...(p.tax_id ? { supplierTaxId: p.tax_id, supplierBranch: p.branch ?? '00000' } : {}),
  ...(p.address ? { supplierAddress: p.address } : {}),
});

/* ------------------------------------------------------------------ entry points ------------------------------------------------------------------ */

/** Credit / debit notes, supplier bills and supplier payments (with WHT) of the past months and this one. Before closeBooks. */
export async function seedTaxDocuments(x: TaxCtx): Promise<string> {
  const out: string[] = [];
  if (x.has('sales')) out.push(await seedNotes(x));
  if (x.has('purchasing')) out.push(await seedPayables(x));
  return out.join(' · ');
}

/** ภ.พ.30 filing records + e-Tax set-up. After closeBooks (every event has posted, last month is closed). */
export async function seedTaxFilings(x: TaxCtx): Promise<string> {
  const out: string[] = [];
  if (x.has('accounting')) out.push(await seedPp30(x));
  if (x.has('etax') && x.has('sales')) out.push(await seedEtax(x));
  return out.join(' · ');
}

/* ------------------------------------------------------------------ sales: credit / debit notes ------------------------------------------------------------------ */

async function seedNotes(x: TaxCtx): Promise<string> {
  const acc = x.as.acc ?? x.call;
  if ((await acc<any[]>('GET', '/api/sales/notes?limit=5')).length) return 'notes: already there';
  const invoices = await acc<any[]>('GET', '/api/sales/invoices?limit=500');
  /** the customer's invoice issued in month n */
  const invoiceOf = (code: string, n: number) => invoices
    .filter((i) => i.customer_id === x.partners[code]?.id && String(i.issue_date).slice(0, 7) === monthStart(n).slice(0, 7))
    .sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date)))[0];
  const warehouses = x.has('inventory') ? await x.call<any[]>('GET', '/api/inventory/warehouses').catch(() => []) : [];
  const hold = warehouses.some((w) => w.code === 'QC-HOLD') ? 'QC-HOLD' : undefined;
  const notes: string[] = [];
  const issue = async (kind: 'credit' | 'debit', inv: any, date: string, body: Record<string, unknown>) => {
    if (!inv) return;
    const issueDate = maxDate(date, String(inv.issue_date).slice(0, 10));
    const r = await acc('POST', `/api/sales/invoices/${inv.id}/${kind}-notes`, { issueDate, ...body });
    notes.push(r.no);
  };

  // last month but one: the powder coat of a BRK-100 lot was thinner than spec — คูลแอร์ kept it, 2 baht a piece off (price reduction, no goods back)
  const coolAug = invoiceOf('C-001', -2);
  if (coolAug) {
    const detail = await acc('GET', `/api/sales/invoices/${coolAug.id}`);
    const qty = Number(detail.lines?.[0]?.qty ?? 0) || 1000;
    await issue('credit', coolAug, on(-2, 27), {
      reasonCode: 'spec', reasonText: `ความหนาสีฝุ่นเฉลี่ย 55 ไมครอน ต่ำกว่าสเปก 60 ไมครอน (NCR ฝ่าย QC) ลูกค้ายอมรับใช้งาน ตกลงลดราคาชิ้นละ 2 บาท`,
      lines: [{ description: `ส่วนลดขายึดแอร์ BRK-100 ล็อตสีฝุ่นบางกว่าสเปก ${qty.toLocaleString('en-US')} ชิ้น × 2 บาท`, qty, unitPrice: 2 }],
      note: 'ตามบันทึกตกลงกับฝ่ายจัดซื้อคูลแอร์ — ลูกค้าหักจากยอดชำระของใบกำกับเดิม',
    });
  }
  // last month: อีสเทิร์น returned 6 dented control boxes (back to stock, into QC-HOLD for checking)
  await issue('credit', invoiceOf('C-002', -2), on(-1, 8), {
    reasonCode: 'returned', reasonText: 'กล่องตู้ควบคุม CASE-01 จำนวน 6 ใบ บุบจากการขนส่ง บานประตูปิดไม่สนิท — รับคืนเข้าคลังกักกันเพื่อตรวจซ่อม',
    lines: [{ lineNo: 1, qty: 6, returnToStock: true }], ...(hold ? { warehouseCode: hold } : {}),
    note: 'ลูกค้าส่งคืนพร้อมใบส่งคืนสินค้าเลขที่ RT-EE-0912',
  });
  // last month: 150 brackets more than คูลแอร์ ordered were delivered and kept → ใบเพิ่มหนี้ on that invoice
  await issue('debit', invoiceOf('C-001', -1), on(-1, 22), {
    reasonCode: 'excess', reasonText: 'ส่งขายึด BRK-100 เกินจำนวนในใบสั่งซื้อ 150 ชิ้น ลูกค้าแจ้งรับไว้ใช้ในรอบผลิตถัดไป', lines: [{ lineNo: 1, qty: 150 }],
  });
  // this month: two RACK-08 sets scratched in transport, โฮมสโตร์ kept them for 300 baht a set off
  await issue('credit', invoiceOf('C-003', 0), today(), {
    reasonCode: 'damaged', reasonText: 'ชั้นวาง RACK-08 จำนวน 2 ชุด สีถลอกจากการขนส่ง ลูกค้ารับไว้ใช้งาน ลดราคาชุดละ 300 บาท',
    lines: [{ description: 'ส่วนลดชั้นวางเหล็ก RACK-08 สีถลอก 2 ชุด × 300 บาท', qty: 2, unitPrice: 300 }],
  });
  return `notes ${notes.join(', ') || 'none'}`;
}

/* ------------------------------------------------------------------ purchasing: bills & payments ------------------------------------------------------------------ */

async function seedPayables(x: TaxCtx): Promise<string> {
  const acc = x.as.acc ?? x.call;
  const buyer = x.as.buyer ?? x.call;
  if ((await acc<any[]>('GET', '/api/purchasing/bills?limit=5')).length) return 'bills: already there';
  const sup = await ensureSuppliers(x);
  const byId: Record<string, any> = Object.fromEntries(Object.values(sup).map((p: any) => [p.id, p]));
  let bills = 0, payments = 0, wht = 0;
  const pay = async (bill: any, paymentDate: string, body: Record<string, unknown>) => {
    const r = await acc('POST', `/api/purchasing/bills/${bill.id}/payments`, { method: 'transfer', paymentDate, ...body });
    payments++;
    if (r.has_wht) wht++;
    return r;
  };

  // Everything is planned first and then keyed in in calendar order (bills before payments on the same day), so AP / PV / 50 ทวิ
  // numbers run with the dates as they would in a real company's books.
  type Bill = { current?: any };
  const steps: { date: string; rank: number; run: () => Promise<void> }[] = [];
  const later = (date: string, rank: number, run: () => Promise<void>) => steps.push({ date, rank, run });
  const payLater = (b: Bill, date: string, body: Record<string, unknown> | ((bill: any) => Record<string, unknown>)) =>
    later(date, 1, async () => { if (b.current) await pay(b.current, date, typeof body === 'function' ? body(b.current) : body); });

  // ---- goods: the buyer records each received PO's supplier tax invoice (the one that came with the goods — same number as at receipt)
  const pos = (await buyer<any[]>('GET', '/api/purchasing/purchase-orders?limit=200'))
    .filter((p) => ['received', 'partially_received'].includes(p.status))
    .sort((a, b) => String(a.order_date).localeCompare(String(b.order_date)) || String(a.no).localeCompare(String(b.no)));
  const credit: Record<string, number> = { 'S-001': 30, 'S-002': 45, 'S-003': 30 };
  for (const po of pos) {
    const p = byId[po.supplier_id];
    const received = String(po.order_date).slice(0, 10);
    const billDate = minDate(addDays(received, 1), today());
    const days = credit[p?.code] ?? 30;
    const h: Bill = {};
    later(billDate, 0, async () => {
      h.current = await buyer('POST', `/api/purchasing/purchase-orders/${po.id}/bills`, {
        ...(p ? supplierOf(p) : {}), supplierInvoiceNo: `IV${String(po.no).slice(-7).replace('-', '')}`, supplierInvoiceDate: received,
        billDate, creditDays: days, note: `ใบกำกับภาษีมากับสินค้า — ตรวจราคาตรงใบสั่งซื้อ ${po.no}`,
      }).catch((e) => { console.error(`  demo tax: goods bill ${po.no} skipped — ${e.message}`); return null; });
      if (h.current) bills++;
    });
    const n = offsetOf(billDate);
    const due = addDays(billDate, days);
    const ref = (bill: any, k: string) => `KBANK ${k}-${String(bill.no).slice(-4)}`;
    if (p?.code === 'S-002' && n === -2) {
      // cash flow: half now, the rest with the next payment run → partially paid
      payLater(h, payDay(on(-1, 29), billDate), (bill) => ({ amount: Math.round(Number(bill.gross) * 50) / 100, whtIncomeType: 'none', bankRef: ref(bill, '0021-88'), note: 'จ่ายบางส่วน 50% — ส่วนที่เหลือรอบจ่ายถัดไป' }));
    } else if (n <= -2 && due <= monthEnd(-1)) {
      payLater(h, payDay(due, billDate), (bill) => ({ whtIncomeType: 'none', bankRef: ref(bill, '0021-77'), note: 'ค่าสินค้า (ไม่หักภาษี ณ ที่จ่าย)' }));
    }
  }

  // ---- services & expenses: accounting keys in the supplier's tax invoice
  const svc = (code: string, kind: 'service' | 'expense', date: string, invoiceNo: string, lines: [string, number, number][], opts: Record<string, unknown> = {}): Bill => {
    const h: Bill = {};
    later(date, 0, async () => {
      h.current = await acc('POST', '/api/purchasing/bills', {
        kind, ...supplierOf(sup[code]), supplierInvoiceNo: invoiceNo, supplierInvoiceDate: date, billDate: date, vatMode: 'exclusive',
        lines: lines.map(([description, qty, unitPrice]) => ({ description, qty, unitPrice })), ...opts,
      });
      bills++;
    });
    return h;
  };
  const yymm = (d: string) => `${String(be(d)).slice(2)}${d.slice(5, 7)}`;

  // freight to customers: a monthly bill at month end, paid about 25 days later with 1% WHT (ค่าขนส่ง → ภ.ง.ด.53); last month's is still open
  const FREIGHT = [8650, 9420, 9180, 11250, 12380];
  for (let n = -5; n <= -1; n++) {
    const date = weekdayOnOrBefore(monthEnd(n));
    const trips = Math.round(FREIGHT[n + 5] / 650);
    const b = svc('S-004', 'service', date, `BNT-${yymm(date)}-${String(310 + (n + 5) * 47).padStart(4, '0')}`,
      [[`ค่าขนส่งสินค้าไปลูกค้า (อมตะซิตี้ / ปลวกแดง / ลาดกระบัง) ${trips} เที่ยว เดือน${monthTh(date)}`, 1, FREIGHT[n + 5]]],
      { creditDays: 30, whtIncomeType: 'transport', note: 'วางบิลรายเดือน แนบใบส่งของที่ลูกค้าเซ็นรับ' });
    if (n <= -2) payLater(b, payDay(addDays(date, 25), date), { whtIncomeType: 'transport', bankRef: `KBANK 0021-9${String(n + 5).padStart(3, '0')}`, note: 'หักภาษี ณ ที่จ่าย 1% ค่าขนส่ง' });
  }

  // warehouse rent from an individual landlord: no VAT, paid on the 5th with 5% WHT (ค่าเช่า, ภ.ง.ด.3); this month's is still due
  for (let n = -5; n <= 0; n++) {
    const date = on(n, 1);
    if (offsetOf(date) !== n) continue;
    const b = svc('S-006', 'service', date, `เช่า-${be(date)}/${date.slice(5, 7)}`,
      [[`ค่าเช่าโกดังเก็บสินค้าสำเร็จรูป อาคาร 2 (พื้นที่ 480 ตร.ม.) เดือน${monthTh(date)}`, 1, 25000]],
      { vatMode: 'none', vatClaimable: false, dueDate: addDays(monthStart(n), 4), whtIncomeType: 'rent', note: 'สัญญาเช่า 3 ปี ผู้ให้เช่าเป็นบุคคลธรรมดา ไม่จดทะเบียน VAT' });
    if (n <= -1) payLater(b, payDay(on(n, 5), date), { whtIncomeType: 'rent', bankRef: `SCB 4410-${String(5100 + n + 5)}`, note: 'หักภาษี ณ ที่จ่าย 5% ค่าเช่า (ภ.ง.ด.3)' });
  }

  // press overhaul (big job): half paid with 3% WHT, the other half held until 90 days of running without leaks → partially paid
  const overhaulDate = on(-4, 20);
  const overhaul = svc('S-005', 'service', overhaulDate, `HMS-${be(overhaulDate)}-0457`, [
    ['ยกเครื่องระบบไฮดรอลิกเครื่องปั๊ม 200 ตัน (PRESS-03) — ค่าแรงช่าง 4 คน 6 วัน และทดสอบเดินเครื่อง', 1, 68000],
    ['ปั๊มไฮดรอลิก วาล์วควบคุมทิศทาง และชุดซีลกระบอกสูบ (ติดตั้งในงานบริการ)', 1, 118000],
  ], { creditDays: 30, whtIncomeType: 'service', note: 'ใบเสนอราคา HMS-Q-2569-112 อนุมัติโดยกรรมการผู้จัดการ — งวด 2 จ่ายหลังเดินเครื่องครบ 90 วันไม่รั่ว' });
  payLater(overhaul, payDay(on(-3, 20), overhaulDate), (bill) => ({
    amount: Math.round(Number(bill.gross) * 50) / 100, whtIncomeType: 'service', bankRef: 'KBANK 0021-70457', note: 'งวดที่ 1 (50%) หักภาษี ณ ที่จ่าย 3% ค่าบริการ',
  }));
  // PRESS-02 cylinder seal job (the repair in the asset register), paid a month later with 3% WHT
  const sealDate = minDate(maxDate(addDays(today(), -55), monthStart(-2)), monthEnd(-2));
  const seal = svc('S-003', 'service', sealDate, `ชท-${yymm(sealDate)}/118`,
    [['เปลี่ยนซีลกระบอกไฮดรอลิก PRESS-02 (ค่าแรงและชุดซีล NOK)', 1, 6800]], { creditDays: 30, whtIncomeType: 'service' });
  payLater(seal, payDay(addDays(sealDate, 30), sealDate), { whtIncomeType: 'service', bankRef: 'KBANK 0021-80118', note: 'หักภาษี ณ ที่จ่าย 3% ค่าบริการซ่อม' });
  // last month's quarterly hydraulic check: open
  svc('S-005', 'service', on(-1, 12), `HMS-${be(on(-1, 12))}-0611`,
    [['ตรวจเช็คระบบไฮดรอลิกประจำไตรมาส PRESS-01 ถึง PRESS-03 พร้อมรายงานผล', 1, 12500]], { creditDays: 30, whtIncomeType: 'service' });

  // shop-floor supplies (goods, no WHT): the one three months ago is paid, last month's open
  const supplies: [string, number, number][] = [['ถุงมือผ้าเคลือบยาง (โหล)', 20, 145], ['แว่นตานิรภัยใส', 30, 65], ['ผ้าเช็ดเครื่องจักร (กก.)', 50, 38], ['ใบตัดเหล็ก 4 นิ้ว', 100, 18]];
  const sup1 = svc('S-007', 'expense', on(-3, 8), `ST${yymm(on(-3, 8))}0215`, supplies, { creditDays: 15, note: 'วัสดุสิ้นเปลืองโรงงาน' });
  payLater(sup1, payDay(addDays(on(-3, 8), 15), on(-3, 8)), { whtIncomeType: 'none', bankRef: 'KBANK 0021-60215', note: 'ซื้อสินค้า ไม่หักภาษี ณ ที่จ่าย' });
  svc('S-007', 'expense', on(-1, 16), `ST${yymm(on(-1, 16))}0388`, [['ถุงมือผ้าเคลือบยาง (โหล)', 25, 145], ['หน้ากากกันฝุ่น N95', 200, 12], ['ใบตัดเหล็ก 4 นิ้ว', 150, 18]],
    { creditDays: 15, note: 'วัสดุสิ้นเปลืองโรงงาน' });

  steps.sort((p, q) => p.date.localeCompare(q.date) || p.rank - q.rank);
  for (const st of steps) await st.run();

  const open = (await acc<any[]>('GET', '/api/purchasing/bills?status=unpaid&limit=200')).length;
  return `bills ${bills} (open/partly paid ${open}) · supplier payments ${payments} (with WHT / 50 ทวิ ${wht})`;
}

/* ------------------------------------------------------------------ accounting: ภ.พ.30 filing records ------------------------------------------------------------------ */

async function seedPp30(x: TaxCtx): Promise<string> {
  const acc = x.as.acc ?? x.call;
  const current = monthStart(0).slice(0, 7);
  const years = [...new Set([monthStart(-12).slice(0, 4), current.slice(0, 4)])];
  const months = (await Promise.all(years.map((y) => acc<any>('GET', `/api/accounting/pp30?year=${y}`)))).flatMap((r) => r.rows as any[]);
  const first = months.find((r) => r.box5 || r.box7)?.period;
  if (!first) return 'pp30: no VAT activity';
  const todo = months.filter((r) => r.period >= first && r.period < current);
  // the accountant closes each month before filing it (last month is already closed by closeBooks)
  const periods = await acc<any[]>(`GET`, `/api/accounting/periods?year=${current.slice(0, 4)}`).catch(() => []);
  for (const r of todo) {
    if (periods.find((p) => p.period === r.period)?.status === 'closed') continue;
    await acc('POST', `/api/accounting/periods/${r.period}/close`, { note: 'ปิดงวดหลังกระทบยอดภาษีขาย/ภาษีซื้อ ก่อนยื่น ภ.พ.30' }).catch(() => undefined);
  }
  const DAYS = [18, 20, 15, 21, 19, 17, 22, 16, 20, 18, 21, 19];
  let filed = 0, carried = 0, paid = 0;
  for (const [i, r] of todo.entries()) {
    if (r.status !== 'not_filed' && r.status !== 'no_activity') continue;
    const x30 = await acc<any>('GET', `/api/accounting/pp30/${r.period}`);
    if (x30.filed) continue;
    const next = addDays(`${r.period}-28`, 5).slice(0, 7);
    const filedDate = minDate(`${next}-${String(DAYS[i % DAYS.length]).padStart(2, '0')}`, today());
    const res = await acc<any>('POST', `/api/accounting/pp30/${r.period}/file`, {
      filedDate, channel: 'efiling', receiptNo: `RD-DEMO-${be(`${r.period}-01`)}${r.period.slice(5, 7)}-${String(40213 + i * 1379).padStart(7, '0')}`,
      refundOrCarry: 'carry', paidAmount: x30.box15,
    });
    filed++;
    paid += Number(x30.box15);
    if (Number(res.box16) > 0) carried++;
  }
  return `ภ.พ.30 filed ${filed} month(s) (${first} → last month, paid ${paid.toLocaleString('en-US', { minimumFractionDigits: 2 })}, excess carried forward ${carried}) · ${current} open`;
}

/* ------------------------------------------------------------------ e-Tax ------------------------------------------------------------------ */

async function seedEtax(x: TaxCtx): Promise<string> {
  const acc = x.as.acc ?? x.call;
  const company = await x.call<any>('GET', '/api/identity/company').catch(() => ({}));
  await acc('PUT', '/api/etax/settings', {
    sellerName: company.legalName ?? company.legal_name ?? 'บริษัท สยามพาร์ท เมทัลเวิร์ค จำกัด', taxId: company.taxId ?? company.tax_id ?? '0105559012342', branch: '00000',
    buildingNumber: '88/8', addressLine1: 'หมู่ 4 ถนนสุขุมวิท', subdistrict: 'แพรกษา', subdistrictCode: '110110', district: 'เมืองสมุทรปราการ', districtCode: '1101',
    province: 'สมุทรปราการ', provinceCode: '11', postcode: '10280', email: company.email ?? 'account@siampart.example.co.th', phone: company.phone ?? '02-123-4567', invoiceTypeCode: 'T02',
  });
  // documents arrive from Sales' events: wait for the notes issued above (they come last)
  const notes = x.has('sales') ? (await acc<any[]>('GET', '/api/sales/notes?limit=50')).length : 0;
  const docs = await waitFor('e-Tax documents of every note', async () => {
    const rows = await acc<any[]>('GET', '/api/etax/documents?limit=500');
    return rows.filter((d) => d.kind !== 'invoice').length >= notes ? rows : undefined;
  }, 40, 300).catch(() => acc<any[]>('GET', '/api/etax/documents?limit=500'));
  // XML for last month's and this month's tax invoices and every note; older invoices stay "พร้อมสร้าง" (paper copies were issued then)
  const from = monthStart(-1);
  const pick = docs.filter((d) => d.status === 'draft' && (d.kind !== 'invoice' || String(d.issue_date).slice(0, 10) >= from))
    .sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date)));
  let generated = 0;
  for (const d of pick) {
    const r = await acc('POST', `/api/etax/documents/${d.id}/generate`, {}).catch((e) => { console.error(`  demo tax: e-Tax ${d.doc_no} not generated — ${e.message}`); return null; });
    if (r && !r.error) generated++;
  }
  // two of last month's invoices were sent through e-Tax Invoice by Email (ETDA) — recorded here with the reply reference
  const sent = (await acc<any[]>('GET', '/api/etax/documents?status=generated&kind=invoice&limit=100'))
    .filter((d) => String(d.issue_date).slice(0, 10) < monthStart(0)).sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date))).slice(0, 2);
  for (const [i, d] of sent.entries()) {
    await acc('POST', `/api/etax/documents/${d.id}/mark-sent`, {
      channel: 'email_etda', sentDate: minDate(addDays(String(d.issue_date).slice(0, 10), 1), today()), reference: `DEMO-ETDA-MAIL-${String(i + 1).padStart(4, '0')}`,
      note: 'ส่ง XML ทางอีเมล e-Tax Invoice by Email และได้อีเมลตอบกลับพร้อมประทับเวลา (ข้อมูลตัวอย่างในระบบเดโม)',
    });
  }
  return `e-Tax settings · XML generated ${generated} (unsigned — no company certificate in the demo) · recorded as sent by e-Tax by Email ${sent.length}`;
}
