/** Wave 9: credit/debit notes, supplier bills, supplier payments with WHT, ภ.พ.30 return + filing record, WHT-payable report. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';
import { lateMonths, pp30Deadlines } from '../src/tax.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

function tenant(perms = ['*']) {
  const id = randomUUID();
  const token = t.token(perms, id, { userId: randomUUID(), userName: 'คุณบัญชี ภาษี' });
  const api = (m: string, url: string, body?: unknown, tok = token) => t.api(m, url, body, { token: tok });
  const deliver = async (type: any, data: unknown, eventId?: string) => {
    parseEvent(type, data);
    const r = await t.deliver(type, data, { tenantId: id, id: eventId });
    expect(r.status).toBe(200);
    return r;
  };
  const journals = async (source: string) => (await api('GET', `/journals?source=${source}`)).body as any[];
  const detail = async (jid: string) => (await api('GET', `/journals/${jid}`)).body;
  const only = async (source: string) => { const js = await journals(source); expect(js).toHaveLength(1); return detail(js[0].id); };
  const lines = (d: any, code: string) => d.lines.filter((l: any) => l.account_code === code);
  const errors = async () => (await api('GET', '/posting-errors')).body as any[];
  return { id, token, api, deliver, journals, detail, only, lines, errors, tok: (p: string[]) => t.token(p, id) };
}

const customer = { customerId: randomUUID(), customerName: 'บริษัท คูลแอร์ แมนูแฟคเจอริ่ง จำกัด', customerTaxId: '0105556123453', customerBranch: '00001' };
const supplier = { supplierId: randomUUID(), supplierName: 'บริษัท เหล็กสยาม จำกัด', supplierTaxId: '0105537000015', supplierBranch: '00000' };
const item = { itemId: randomUUID(), itemCode: 'RM-STEEL', itemName: 'เหล็กแผ่น' };

const invoice = (no: string, date: string, net: number, vat: number, extra: Record<string, unknown> = {}) => ({
  invoiceId: randomUUID(), invoiceNo: no, orderId: randomUUID(), net, vat, gross: Math.round((net + vat) * 100) / 100, issueDate: date, ...customer, ...extra,
});
const note = (kind: 'credit' | 'debit', no: string, date: string, inv: { invoiceId: string; invoiceNo: string; issueDate: string }, net: number, vat: number, extra: Record<string, unknown> = {}) => ({
  noteId: randomUUID(), noteNo: no, kind, issueDate: date, invoiceId: inv.invoiceId, invoiceNo: inv.invoiceNo, invoiceDate: inv.issueDate,
  ...customer, reason: kind === 'credit' ? 'รับคืนสินค้าชำรุด 2 ชิ้น' : 'คิดราคาต่ำกว่าที่ตกลง', originalNet: 10_000, correctNet: kind === 'credit' ? 10_000 - net : 10_000 + net,
  net, vat, gross: Math.round((net + vat) * 100) / 100, warehouseCode: 'MAIN',
  lines: [{ itemId: item.itemId, itemCode: item.itemCode, description: item.itemName, qty: 2, unitPrice: net / 2, amount: net, returnToStock: kind === 'credit' ? 2 : 0 }],
  ...extra,
});
const receipt = (po: string, date: string, net: number, vat: number | null, extra: Record<string, unknown> = {}) => ({
  poId: randomUUID(), poNo: po, supplierId: supplier.supplierId, supplierName: supplier.supplierName, warehouseCode: 'MAIN',
  lines: [{ ...item, qty: 1, unitPrice: net, vatRate: 0.07 }], receivedDate: date,
  ...(vat === null ? {} : { vatMode: 'exclusive', net, vat, gross: Math.round((net + vat) * 100) / 100 }), ...extra,
});
const bill = (no: string, date: string, kind: 'goods' | 'service' | 'expense', net: number, vat: number, extra: Record<string, unknown> = {}) => ({
  billId: randomUUID(), billNo: no, billDate: date, dueDate: '2025-12-31', ...supplier, supplierCode: 'S-001',
  supplierInvoiceNo: `IV-${no}`, supplierInvoiceDate: date, kind, poId: null, poNo: null,
  net, vat, gross: Math.round((net + vat) * 100) / 100, vatClaimable: true, ...extra,
});
const payment = (no: string, date: string, gross: number, netPaid: number, wht: any[], extra: Record<string, unknown> = {}) => ({
  paymentId: randomUUID(), paymentNo: no, paymentDate: date, method: 'transfer', supplierId: supplier.supplierId, supplierName: supplier.supplierName,
  supplierTaxId: supplier.supplierTaxId, bills: [{ billId: randomUUID(), billNo: 'BL-2568-0001', amount: gross }], gross, netPaid, wht, ...extra,
});

const balanced = (d: any) => {
  const dr = d.lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
  const cr = d.lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
  expect(Math.round(dr * 100)).toBe(Math.round(cr * 100));
  expect(Number(d.total_debit)).toBe(Number(d.total_credit));
};

describe('sales.note_issued — ใบลดหนี้ / ใบเพิ่มหนี้ (§86/9, §86/10)', () => {
  it('credit note: Dr 41900 net + Dr 21200 vat / Cr 11300 gross, satang-exact; register row negative in the note month with the original invoice', async () => {
    const x = tenant();
    const inv = invoice('INV-2568-0101', '2025-05-03', 10_000, 700);
    await x.deliver('sales.invoiced', inv);
    const cn = note('credit', 'CN-2568-0001', '2025-06-10', inv, 1_234.56, 86.42);
    const evId = randomUUID();
    await x.deliver('sales.note_issued', cn, evId);
    await x.deliver('sales.note_issued', cn, evId); // same event again (bus retry)
    await x.deliver('sales.note_issued', cn); // same note, new event id
    const d = await x.only('sales.note_issued');
    balanced(d);
    expect(d.entry_date).toBe('2025-06-10');
    expect(x.lines(d, '41900').map((l: any) => [l.debit, l.credit])).toEqual([[1_234.56, 0]]);
    expect(x.lines(d, '21200').map((l: any) => [l.debit, l.tax_base, l.tax_invoice_no, l.tax_ref_invoice_no])).toEqual([[86.42, 1_234.56, 'CN-2568-0001', 'INV-2568-0101']]);
    expect(x.lines(d, '11300').map((l: any) => [l.credit, l.partner_name])).toEqual([[1_320.98, customer.customerName]]);
    expect(d.note).toContain('รับคืนสินค้าชำรุด');

    const reg = (await x.api('GET', '/reports/vat/lines?month=2025-06&kind=output')).body;
    expect(reg.rows.map((r: any) => [r.document_no, r.tax_invoice_date, r.ref_invoice_no, r.ref_invoice_date, r.party_tax_id, r.party_branch_label, r.tax_base, r.vat])).toEqual([
      ['CN-2568-0001', '2025-06-10', 'INV-2568-0101', '2025-05-03', '0105556123453', 'สาขา 00001', -1_234.56, -86.42],
    ]);
    // the May register is untouched — the note reduces output VAT of the month it is issued
    expect((await x.api('GET', '/reports/vat/lines?month=2025-05&kind=output')).body.totals).toMatchObject({ base: 10_000, vat: 700 });
    const tb = (await x.api('GET', '/reports/trial-balance?asOf=2025-06-30')).body;
    expect(tb.totals.difference).toBe(0);
  });

  it('debit note: Dr 11300 / Cr 41000 + Cr 21200 (positive register row)', async () => {
    const x = tenant();
    const inv = invoice('INV-2568-0102', '2025-05-03', 10_000, 700);
    await x.deliver('sales.note_issued', note('debit', 'DN-2568-0001', '2025-05-20', inv, 500.05, 35));
    const d = await x.only('sales.note_issued');
    balanced(d);
    expect(x.lines(d, '11300').map((l: any) => l.debit)).toEqual([535.05]);
    expect(x.lines(d, '41000').map((l: any) => l.credit)).toEqual([500.05]);
    expect(x.lines(d, '21200').map((l: any) => [l.credit, l.tax_base])).toEqual([[35, 500.05]]);
    const reg = (await x.api('GET', '/reports/vat/lines?month=2025-05&kind=output')).body;
    expect(reg.rows[0]).toMatchObject({ document_no: 'DN-2568-0001', ref_invoice_no: 'INV-2568-0102', tax_base: 500.05, vat: 35 });
  });

  it('an unmapped rule is a posting error, not a crash — retry posts it after the rule is fixed', async () => {
    const x = tenant();
    const rules = (await x.api('GET', '/posting-rules')).body as any[];
    const rule = rules.find((r) => r.event_type === 'sales.note_issued' && r.leg === 'returns');
    const acc = rule.account_id;
    expect((await x.api('PUT', `/posting-rules/${rule.id}`, { accountId: null })).status).toBe(200);
    const inv = invoice('INV-2568-0103', '2025-05-03', 10_000, 700);
    await x.deliver('sales.note_issued', note('credit', 'CN-2568-0003', '2025-05-25', inv, 100, 7));
    const [err] = await x.errors();
    expect(err).toMatchObject({ event_type: 'sales.note_issued', source_no: 'CN-2568-0003' });
    await x.api('PUT', `/posting-rules/${rule.id}`, { accountId: acc });
    expect((await x.api('POST', `/posting-errors/${err.id}/retry`)).body).toMatchObject({ ok: true, status: 'resolved' });
    balanced(await x.only('sales.note_issued'));
  });
});

describe('purchasing.bill_recorded — ตั้งหนี้', () => {
  it('service bill: Dr 53400 net + Dr 11500 vat (supplier tax invoice in the register) / Cr 21100 gross', async () => {
    const x = tenant();
    await x.deliver('purchasing.bill_recorded', bill('BL-2568-0001', '2025-07-05', 'service', 12_345.67, 864.2));
    const d = await x.only('purchasing.bill_recorded');
    balanced(d);
    expect(x.lines(d, '53400').map((l: any) => l.debit)).toEqual([12_345.67]);
    expect(x.lines(d, '11500').map((l: any) => [l.debit, l.tax_base, l.tax_invoice_no, l.tax_party_tax_id])).toEqual([[864.2, 12_345.67, 'IV-BL-2568-0001', '0105537000015']]);
    expect(x.lines(d, '21100').map((l: any) => l.credit)).toEqual([13_209.87]);
    const reg = (await x.api('GET', '/reports/vat/lines?month=2025-07&kind=input')).body;
    expect(reg.rows[0]).toMatchObject({ document_no: 'IV-BL-2568-0001', party_branch_label: 'สำนักงานใหญ่', tax_base: 12_345.67, vat: 864.2 });
    const bills = (await x.api('GET', '/supplier-bills')).body;
    expect(bills[0]).toMatchObject({ bill_no: 'BL-2568-0001', treatment: 'posted', journal_no: d.no, kind_label: 'บริการ' });
  });

  it('expense bill with non-claimable VAT (§82/5): VAT goes into the expense, no ภาษีซื้อ', async () => {
    const x = tenant();
    await x.deliver('purchasing.bill_recorded', bill('BL-2568-0002', '2025-07-06', 'expense', 2_000, 140, { vatClaimable: false }));
    const d = await x.only('purchasing.bill_recorded');
    balanced(d);
    expect(x.lines(d, '53900').map((l: any) => l.debit)).toEqual([2_140]);
    expect(x.lines(d, '11500')).toEqual([]);
    expect(x.lines(d, '21100').map((l: any) => l.credit)).toEqual([2_140]);
    expect(d.note).toContain('82/5');
  });

  it('goods bill after a receipt that booked VAT: no second AP / ภาษีซื้อ — matched, and the receipt VAT line gets the supplier tax invoice', async () => {
    const x = tenant();
    await x.deliver('purchasing.goods_received', receipt('PO-2568-0201', '2025-08-04', 30_000, 2_100));
    await x.deliver('purchasing.bill_recorded', bill('BL-2568-0003', '2025-08-06', 'goods', 30_000, 2_100, { poNo: 'PO-2568-0201', supplierInvoiceDate: '2025-08-05' }));
    expect(await x.journals('purchasing.bill_recorded')).toEqual([]);
    expect(await x.errors()).toEqual([]);
    const [b] = (await x.api('GET', '/supplier-bills')).body;
    expect(b).toMatchObject({ treatment: 'matched', journal_id: null, po_no: 'PO-2568-0201' });
    const reg = (await x.api('GET', '/reports/vat/lines?month=2025-08&kind=input')).body;
    expect(reg.rows.map((r: any) => [r.document_no, r.tax_invoice_date, r.party_tax_id, r.vat])).toEqual([['IV-BL-2568-0003', '2025-08-05', '0105537000015', 2_100]]);
    expect(reg.totals.vat).toBe(2_100); // not 4,200
    const ap = (await x.api('GET', '/summary')).body.apBalance;
    expect(ap).toBe(32_100);
    // the same bill again (new event id) changes nothing
    await x.deliver('purchasing.bill_recorded', { ...bill('BL-2568-0003', '2025-08-06', 'goods', 30_000, 2_100, { poNo: 'PO-2568-0201' }), billId: b.bill_id });
    expect((await x.api('GET', '/supplier-bills')).body).toHaveLength(1);
  });

  it('goods bill before its receipt: posting error; retry after the receipt resolves it (matched)', async () => {
    const x = tenant();
    await x.deliver('purchasing.bill_recorded', bill('BL-2568-0004', '2025-08-06', 'goods', 1_000, 70, { poNo: 'PO-2568-0202' }));
    const [err] = await x.errors();
    expect(err.reason).toContain('PO-2568-0202');
    await x.deliver('purchasing.goods_received', receipt('PO-2568-0202', '2025-08-07', 1_000, 70));
    expect((await x.api('POST', `/posting-errors/${err.id}/retry`)).body).toMatchObject({ ok: true, status: 'resolved' });
    expect((await x.api('GET', '/posting-errors?status=resolved')).body).toHaveLength(1);
    expect((await x.api('GET', '/supplier-bills')).body[0]).toMatchObject({ treatment: 'matched' });
  });

  it('goods bill, VAT not claimable but booked at receipt: Dr 11400 / Cr 11500 (cost of the goods)', async () => {
    const x = tenant();
    await x.deliver('purchasing.goods_received', receipt('PO-2568-0203', '2025-08-04', 5_000, 350));
    await x.deliver('purchasing.bill_recorded', bill('BL-2568-0005', '2025-08-08', 'goods', 5_000, 350, { poNo: 'PO-2568-0203', vatClaimable: false }));
    const d = await x.only('purchasing.bill_recorded');
    balanced(d);
    expect(x.lines(d, '11400').map((l: any) => l.debit)).toEqual([350]);
    expect(x.lines(d, '11500').map((l: any) => [l.credit, l.tax_base])).toEqual([[350, 5_000]]);
    expect((await x.api('GET', '/reports/vat/lines?month=2025-08&kind=input')).body.totals).toMatchObject({ base: 0, vat: 0 });
    expect((await x.api('GET', '/supplier-bills')).body[0]).toMatchObject({ treatment: 'vat_reclassed', journal_no: d.no });
  });

  it('goods bill after an old receipt without a VAT split: VAT taken out of stock (gross receipt) or added to AP (net receipt)', async () => {
    const x = tenant();
    await x.deliver('purchasing.goods_received', receipt('PO-2568-0204', '2025-08-04', 10_700, null)); // stock booked at 10,700 incl. VAT
    await x.deliver('purchasing.bill_recorded', bill('BL-2568-0006', '2025-08-09', 'goods', 10_000, 700, { poNo: 'PO-2568-0204' }));
    const d1 = await x.only('purchasing.bill_recorded');
    balanced(d1);
    expect(x.lines(d1, '11500').map((l: any) => l.debit)).toEqual([700]);
    expect(x.lines(d1, '11400').map((l: any) => l.credit)).toEqual([700]);

    const y = tenant();
    await y.deliver('purchasing.goods_received', receipt('PO-2568-0205', '2025-08-04', 10_000, null)); // AP booked before VAT
    await y.deliver('purchasing.bill_recorded', bill('BL-2568-0007', '2025-08-09', 'goods', 10_000, 700, { poNo: 'PO-2568-0205' }));
    const d2 = await y.only('purchasing.bill_recorded');
    expect(y.lines(d2, '11500').map((l: any) => l.debit)).toEqual([700]);
    expect(y.lines(d2, '21100').map((l: any) => l.credit)).toEqual([700]);
    expect((await y.api('GET', '/summary')).body.apBalance).toBe(10_700);
  });

  it('notes a bill above the received amount and a tax invoice older than 6 months (§82/3) without posting the difference', async () => {
    const x = tenant();
    await x.deliver('purchasing.goods_received', receipt('PO-2568-0206', '2025-08-04', 1_000, 70));
    await x.deliver('purchasing.bill_recorded', bill('BL-2568-0008', '2025-08-09', 'goods', 1_000, 70, { poNo: 'PO-2568-0206', gross: 1_170 }));
    expect((await x.api('GET', '/supplier-bills')).body[0].note).toContain('เกินเจ้าหนี้ที่ตั้งไว้');
    await x.deliver('purchasing.bill_recorded', bill('BL-2568-0009', '2025-09-01', 'service', 100, 7, { supplierInvoiceDate: '2025-02-20' }));
    expect((await x.only('purchasing.bill_recorded')).note).toContain('82/3');
  });
});

describe('purchasing.supplier_paid — จ่ายชำระพร้อมหัก ณ ที่จ่าย', () => {
  it('Dr 21100 gross / Cr 11200 net paid / Cr 21320 ภ.ง.ด.53 (satang) and Cr 21310 ภ.ง.ด.3 — WHT-payable report by month and form', async () => {
    const x = tenant();
    // 3% on 12,345.67 = 370.37 (ภ.ง.ด.53, juristic person); paid 13,209.87 − 370.37 = 12,839.50
    await x.deliver('purchasing.supplier_paid', payment('PV-2568-0001', '2025-09-05', 13_209.87, 12_839.5, [
      { form: 'PND53', incomeType: '40(8)', description: 'ค่าจ้างทำของ', rate: 0.03, base: 12_345.67, amount: 370.37, certificateNo: 'WHT-2568-0001' }]));
    const d = await x.only('purchasing.supplier_paid');
    balanced(d);
    expect(x.lines(d, '21100').map((l: any) => l.debit)).toEqual([13_209.87]);
    expect(x.lines(d, '11200').map((l: any) => l.credit)).toEqual([12_839.5]);
    expect(x.lines(d, '21320').map((l: any) => [l.credit, l.tax_base, l.wht_form, l.wht_income_type, Number(l.wht_rate), l.wht_certificate_no])).toEqual([[370.37, 12_345.67, 'PND53', '40(8)', 0.03, 'WHT-2568-0001']]);
    expect(d.note).toBeNull();
    // an individual paid in cash: 5% rent (ภ.ง.ด.3) + 3% service on one payment
    await x.deliver('purchasing.supplier_paid', payment('PV-2568-0002', '2025-09-20', 15_000, 14_350, [
      { form: 'PND3', incomeType: '40(5)', description: 'ค่าเช่า', rate: 0.05, base: 10_000, amount: 500, certificateNo: 'WHT-2568-0002' },
      { form: 'PND3', incomeType: '40(8)', description: 'ค่าบริการ', rate: 0.03, base: 5_000, amount: 150, certificateNo: 'WHT-2568-0002' }], { method: 'cash', supplierName: 'นายสมชาย ใจดี', supplierTaxId: '1100100100101' }));
    const d2 = await x.detail((await x.journals('purchasing.supplier_paid')).find((j: any) => j.ref === 'PV-2568-0002').id);
    balanced(d2);
    expect(x.lines(d2, '11100').map((l: any) => l.credit)).toEqual([14_350]);
    expect(x.lines(d2, '21310').map((l: any) => l.credit)).toEqual([500, 150]);

    const r = (await x.api('GET', '/reports/wht-payable?year=2025')).body;
    expect(r.summary.map((s: any) => [s.month, s.form, s.count, s.base, s.amount, s.due_paper, s.due_efiling])).toEqual([
      ['2025-09', 'PND3', 2, 15_000, 650, '2025-10-07', '2025-10-15'],
      ['2025-09', 'PND53', 1, 12_345.67, 370.37, '2025-10-07', '2025-10-15'],
    ]);
    expect(r.totals).toMatchObject({ amount: 1_020.37, pnd3: 650, pnd53: 370.37, count: 3 });
    expect(r.accounts).toEqual([
      expect.objectContaining({ form: 'PND3', code: '21310', balance: 650 }),
      expect.objectContaining({ form: 'PND53', code: '21320', balance: 370.37 }),
    ]);
    expect((await x.api('GET', '/reports/wht-payable?month=2025-09&form=PND53')).body.lines.map((l: any) => [l.certificate_no, l.rate_pct, l.party_tax_id])).toEqual([['WHT-2568-0001', '3%', '0105537000015']]);

    // a reversal keeps the WHT details and shows as a negative row
    expect((await x.api('POST', `/journals/${d.id}/reverse`, { entryDate: '2025-09-30', reason: 'จ่ายผิดเจ้าหนี้' })).status).toBe(201);
    const after = (await x.api('GET', '/reports/wht-payable?year=2025&form=PND53')).body;
    expect(after.lines.map((l: any) => [l.certificate_no, l.base, l.amount])).toEqual([['WHT-2568-0001', 12_345.67, 370.37], ['WHT-2568-0001', -12_345.67, -370.37]]);
    expect(after.totals.pnd53).toBe(0);
  });

  it('pays and notes when net paid + WHT ≠ gross (AP cleared by what was really paid)', async () => {
    const x = tenant();
    await x.deliver('purchasing.supplier_paid', payment('PV-2568-0003', '2025-09-05', 1_000, 950, []));
    const d = await x.only('purchasing.supplier_paid');
    balanced(d);
    expect(x.lines(d, '21100').map((l: any) => l.debit)).toEqual([950]);
    expect(d.note).toContain('ไม่เท่ากับยอดตัดหนี้');
  });
});

describe('ภ.พ.30 — boxes 1–16, carry-forward from the previous recorded filing, filing record + amendment', () => {
  it('computes a month with sales, purchases, a credit note and 700 carried in from January\'s filed return', async () => {
    const x = tenant();
    // January: output 700 / input 1,400 → excess 700 (box 9 / 12 / 16)
    await x.deliver('sales.invoiced', invoice('INV-2568-0301', '2025-01-10', 10_000, 700));
    await x.deliver('purchasing.goods_received', receipt('PO-2568-0301', '2025-01-12', 20_000, 1_400, { supplierInvoiceNo: 'A-1', supplierInvoiceDate: '2025-01-12' }));
    const jan = (await x.api('GET', '/pp30/2025-01')).body;
    expect(jan).toMatchObject({ box4: 10_000, box5: 700, box6: 20_000, box7: 1_400, box8: 0, box9: 700, box10: 0, box11: 0, box12: 700, box16: 700, status: 'not_filed' });
    const f1 = await x.api('POST', '/pp30/2025-01/file', { filedDate: '2025-02-20', channel: 'efiling', receiptNo: 'RD-6802-000111', refundOrCarry: 'carry', paidAmount: 0 });
    expect(f1.status).toBe(201);
    expect(f1.body).toMatchObject({ status: 'filed', filed: true, receipt_no: 'RD-6802-000111' });
    expect(f1.body.filing).toMatchObject({ seq: 0, refund_or_carry: 'carry', channel: 'efiling' });
    expect(f1.body.message).toContain('ไม่ได้ส่งแบบไปกรมสรรพากร');
    expect(f1.body.warnings.join(' ')).toContain('งวดบัญชี'); // January is still open

    // February: sales 50,000.50 + 3,500.04; credit note −1,000.10 / −70.01; service bill 12,345.67 + 864.20
    const inv = invoice('INV-2568-0302', '2025-02-03', 50_000.5, 3_500.04);
    await x.deliver('sales.invoiced', inv);
    await x.deliver('sales.note_issued', note('credit', 'CN-2568-0301', '2025-02-18', inv, 1_000.1, 70.01));
    await x.deliver('purchasing.bill_recorded', bill('BL-2568-0301', '2025-02-10', 'service', 12_345.67, 864.2));
    const feb = (await x.api('GET', '/reports/pp30?period=2025-02&zeroRated=5000')).body;
    expect(feb).toMatchObject({
      box1: 54_000.4, box2: 5_000, box3: 0, box4: 49_000.4, box5: 3_430.03, box6: 12_345.67, box7: 864.2,
      box8: 2_565.83, box9: 0, box10: 700, box11: 1_865.83, box12: 0, box13: 0, box14: 0, box15: 1_865.83, box16: 0,
      carried_in_source: 'filed', deadline_paper: '2025-03-15', deadline_efiling: '2025-03-23', status: 'not_filed',
    });
    expect(feb.boxes).toHaveLength(16);
    expect(feb.boxes[10]).toEqual({ no: 11, label: '11. ต้องชำระ (ถ้า 8. มากกว่า 10.)', amount: 1_865.83 });
    // registers agree with boxes 4–7
    expect((await x.api('GET', '/reports/vat/lines?month=2025-02&kind=output')).body.totals).toMatchObject({ base: 49_000.4, vat: 3_430.03 });

    // late: e-Filing deadline 23 Mar, filed 25 Apr → 2 months × 1.5% of 1,865.83 = 55.97 suggested (§89/1)
    const late = (await x.api('GET', '/reports/pp30?period=2025-02&filedDate=2025-04-25&channel=efiling')).body;
    expect(late).toMatchObject({ late: true, late_months: 2, surcharge_suggested: 55.97 });
    expect(late.warnings.join(' ')).toContain('89/1');
    expect((await x.api('GET', '/reports/pp30?period=2025-02&surcharge=55.97&penalty=200')).body).toMatchObject({ box13: 55.97, box14: 200, box15: 2_121.8 });

    // CSV export of the boxes
    const csv = await t.raw('GET', '/reports/pp30/csv?period=2025-02', undefined, { token: x.token });
    expect(csv.status).toBe(200);
    expect(String(csv.headers['content-type'])).toContain('text/csv');
    const text = csv.body.toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('11,ต้องชำระ (ถ้า 8. มากกว่า 10.),1865.83');

    // January amended → refund in cash: February no longer carries 700 in
    expect((await x.api('POST', '/pp30/2025-01/file', { filedDate: '2025-03-01', channel: 'efiling', refundOrCarry: 'refund', paidAmount: 0, amend: true })).status).toBe(400);
    const am = await x.api('POST', '/pp30/2025-01/file', { filedDate: '2025-03-01', channel: 'efiling', refundOrCarry: 'refund', paidAmount: 0, amend: true, reason: 'ขอคืนเป็นเงินสดแทนการยกไป' });
    expect(am.status).toBe(201);
    expect(am.body).toMatchObject({ status: 'amended' });
    expect(am.body.filing).toMatchObject({ seq: 1, amend: true, refund_or_carry: 'refund' });
    expect((await x.api('GET', '/pp30/2025-02')).body).toMatchObject({ box10: 0, box11: 2_565.83, carried_in_source: 'refund' });
  });

  it('records a filing once; refiling needs ภ.พ.30 เพิ่มเติม with a reason; validates dates; warns on open period and amount', async () => {
    const x = tenant();
    await x.deliver('sales.invoiced', invoice('INV-2568-0401', '2025-03-10', 20_000, 1_400));
    expect((await x.api('POST', '/pp30/2025-03/file', { filedDate: '2025-03-31', channel: 'paper', paidAmount: 1_400 })).status).toBe(400); // before month end
    expect((await x.api('POST', '/pp30/2025-03/file', { filedDate: '2099-04-10', channel: 'paper', paidAmount: 1_400 })).status).toBe(400); // future
    expect((await x.api('POST', '/pp30/2025-03/file', { filedDate: '2025-04-10', channel: 'paper', paidAmount: 1_400, amend: true, reason: 'x' })).status).toBe(409); // nothing to amend
    await x.api('POST', '/periods/2025-03/close', {});
    const ok = await x.api('POST', '/pp30/2025-03/file', { filedDate: '2025-04-10', channel: 'paper', receiptNo: 'P-1', paidAmount: 1_400 });
    expect(ok.status).toBe(201);
    expect(ok.body.warnings).toEqual([]); // period closed, paid = box 15, on time
    expect(ok.body.filing.refund_or_carry).toBeNull(); // tax was payable
    expect((await x.api('POST', '/pp30/2025-03/file', { filedDate: '2025-04-11', channel: 'paper', paidAmount: 1_400 })).status).toBe(409);

    // a sale found later: the ledger now differs from the filed return → amended return for the additional 70
    await x.api('POST', '/periods/2025-03/reopen', { note: 'พบใบกำกับตกหล่น' });
    await x.deliver('sales.invoiced', invoice('INV-2568-0402', '2025-03-28', 1_000, 70));
    const cur = (await x.api('GET', '/pp30/2025-03')).body;
    expect(cur.changed_since_filing).toBe(true);
    expect(cur.warnings.join(' ')).toContain('ภ.พ.30 เพิ่มเติม');
    const am = await x.api('POST', '/pp30/2025-03/file', { filedDate: '2025-04-20', channel: 'paper', paidAmount: 50, amend: true, reason: 'ใบกำกับภาษี INV-2568-0402 ตกหล่น' });
    expect(am.status).toBe(201);
    expect(am.body.filing.figures).toMatchObject({ box11: 1_470, previous_box11: 1_400, additional_tax: 70, due: 70 });
    expect(am.body.warnings.join(' ')).toContain('ไม่เท่ากับยอดที่ต้องชำระ');
    expect(am.body.warnings.join(' ')).toContain('ยังเปิดอยู่');
    expect(am.body.filings.map((f: any) => f.kind_label)).toEqual(['ภ.พ.30 ปกติ', 'ภ.พ.30 เพิ่มเติม ครั้งที่ 1']);

    const year = (await x.api('GET', '/pp30?year=2025')).body;
    expect(year.rows).toHaveLength(12);
    expect(year.rows[2]).toMatchObject({ period: '2025-03', status: 'amended', box11: 1_470, filed_date: '2025-04-20', receipt_no: null }); // the latest (amended) filing
    expect(year.rows[3]).toMatchObject({ period: '2025-04', status: 'not_filed', overdue: true });
  });

  it('permissions and tenant isolation of filings, bills and the tax reports', async () => {
    const x = tenant();
    await x.deliver('sales.invoiced', invoice('INV-2568-0501', '2025-04-10', 1_000, 70));
    await x.deliver('purchasing.bill_recorded', bill('BL-2568-0501', '2025-04-11', 'service', 100, 7));
    await x.deliver('purchasing.supplier_paid', payment('PV-2568-0501', '2025-04-12', 107, 104, [
      { form: 'PND53', incomeType: '40(8)', description: 'ค่าบริการ', rate: 0.03, base: 100, amount: 3, certificateNo: 'W-1' }]));
    const report = x.tok(['accounting.report.read', 'accounting.journal.read']);
    const reader = x.tok(['accounting.tax.read']);
    expect((await x.api('GET', '/pp30/2025-04', undefined, report)).status).toBe(403);
    expect((await x.api('GET', '/pp30?year=2025', undefined, report)).status).toBe(403);
    expect((await x.api('GET', '/reports/wht-payable?year=2025', undefined, report)).status).toBe(403);
    expect((await x.api('GET', '/pp30/2025-04', undefined, reader)).status).toBe(200);
    expect((await x.api('POST', '/pp30/2025-04/file', { filedDate: '2025-05-10', channel: 'efiling', paidAmount: 63 }, reader)).status).toBe(403);
    expect((await x.api('GET', '/supplier-bills', undefined, reader)).status).toBe(403);
    expect((await x.api('POST', '/pp30/2025-04/file', { filedDate: '2025-05-10', channel: 'efiling', paidAmount: 63 }, x.tok(['accounting.tax.file']))).status).toBe(201);

    const other = tenant();
    expect((await other.api('GET', '/pp30/2025-04')).body).toMatchObject({ status: 'not_filed', box5: 0, box7: 0, filings: [] });
    expect((await other.api('GET', '/supplier-bills')).body).toEqual([]);
    expect((await other.api('GET', '/reports/wht-payable?year=2025')).body.lines).toEqual([]);
    // the other company files its own April without a conflict
    expect((await other.api('POST', '/pp30/2025-04/file', { filedDate: '2025-05-12', channel: 'paper', paidAmount: 0 })).status).toBe(201);
    expect((await x.api('GET', '/pp30/2025-04')).body.filings).toHaveLength(1);
  });
});

describe('deadline arithmetic', () => {
  it('§83 deadlines and late months (part of a month = a month)', () => {
    expect(pp30Deadlines('2025-12')).toEqual({ paper: '2026-01-15', efiling: '2026-01-23' });
    expect(lateMonths('2025-03-23', '2025-03-23')).toBe(0);
    expect(lateMonths('2025-03-23', '2025-03-24')).toBe(1);
    expect(lateMonths('2025-03-23', '2025-04-23')).toBe(1);
    expect(lateMonths('2025-03-23', '2025-04-24')).toBe(2);
  });
});
