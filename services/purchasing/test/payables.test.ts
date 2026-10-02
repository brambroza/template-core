/** Wave 9: supplier bills, payables/aging, supplier payments with WHT, 50 ทวิ, monthly ภ.ง.ด.3 / ภ.ง.ด.53. */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '@erp/kernel';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { WHT_INCOME_TYPES } from '@erp/thai';
import { definition } from '../src/service.ts';
import ui, { whtTypeOptions } from '../src/ui.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });
beforeEach(() => setClock('2026-10-20T03:00:00Z'));
afterEach(() => setClock(null));

const JURISTIC = '0105537000015';
const PERSON = '1101700203450';
const item = { itemId: randomUUID(), itemCode: 'RM-01', itemName: 'วัตถุดิบ' };

function tenant(perms = ['*']) {
  const id = randomUUID();
  const token = t.token(perms, id, { userId: randomUUID(), userName: 'คุณบัญชี' });
  const api = (m: string, url: string, body?: unknown, tok = token) => t.api(m, url, body, { token: tok });
  const supplier = (over: Record<string, unknown> = {}) => ({
    supplierId: randomUUID(), supplierCode: 'SUP-01', supplierName: 'บริษัท บริการดี จำกัด', supplierTaxId: JURISTIC, supplierBranch: '00000', supplierAddress: '1 ถ.บางนา สมุทรปราการ', ...over,
  });
  const serviceBill = async (net: number, over: Record<string, unknown> = {}) => {
    const r = await api('POST', '/bills', {
      kind: 'service', ...supplier(), supplierInvoiceNo: `INV-${randomUUID().slice(0, 8)}`, supplierInvoiceDate: '2026-09-01', billDate: '2026-09-01',
      lines: [{ description: 'ค่าบริการซ่อมเครื่อง', qty: 1, unitPrice: net }], ...over,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body;
  };
  return { id, token, api, supplier, serviceBill };
}

describe('supplier bills (ตั้งหนี้)', () => {
  it('goods bill against a PO: VAT from the receipts, never more than received − returned − billed', async () => {
    const x = tenant();
    await x.api('PUT', '/settings', { creatorCannotApprove: false });
    const po = (await x.api('POST', '/purchase-orders', { supplierId: randomUUID(), supplierName: 'บริษัท เหล็กสยาม จำกัด', lines: [{ ...item, qty: 10, unitPrice: 100 }] })).body;
    // nothing received yet
    expect((await x.api('POST', `/purchase-orders/${po.id}/bills`, { supplierInvoiceNo: 'IV-1', supplierInvoiceDate: '2026-10-01' })).status).toBe(409);
    await x.api('POST', `/purchase-orders/${po.id}/approve`);
    await x.api('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ lineId: po.lines[0].id, qty: 4 }] });
    await x.api('POST', `/purchase-orders/${po.id}/returns`, { lines: [{ itemId: item.itemId, qty: 1 }] });
    const b = await x.api('POST', `/purchase-orders/${po.id}/bills`, { supplierInvoiceNo: 'IV-1', supplierInvoiceDate: '2026-10-01', supplierTaxId: JURISTIC, creditDays: 30 });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body).toMatchObject({ kind: 'goods', po_no: po.no, supplier_id: po.supplier_id, supplier_name: 'บริษัท เหล็กสยาม จำกัด', net: 300, vat: 21, gross: 321,
      vat_claimable: true, bill_date: '2026-10-20', due_date: '2026-11-19', status: 'open', outstanding: 321 });
    expect(b.body.no).toBe('AP-2569-0001');
    expect(b.body.lines[0]).toMatchObject({ qty: 3, unit_price: 100, amount: 300 });
    // all received goods are billed now
    expect((await x.api('POST', `/purchase-orders/${po.id}/bills`, { supplierInvoiceNo: 'IV-2', supplierInvoiceDate: '2026-10-01' })).status).toBe(409);
    await x.api('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ lineId: po.lines[0].id, qty: 6 }] });
    const over = await x.api('POST', `/purchase-orders/${po.id}/bills`, { supplierInvoiceNo: 'IV-2', supplierInvoiceDate: '2026-10-01', lines: [{ lineId: po.lines[0].id, qty: 7 }] });
    expect(over.status).toBe(409);
    expect(over.body.error.message).toContain('เกินจำนวนที่รับแล้วค้างตั้งหนี้ 6');
    // the same supplier invoice twice → 409
    const dup = await x.api('POST', `/purchase-orders/${po.id}/bills`, { supplierInvoiceNo: 'iv-1', supplierInvoiceDate: '2026-10-01' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toContain('AP-2569-0001');
    // a different supplier than the PO's → 400
    expect((await x.api('POST', `/purchase-orders/${po.id}/bills`, { supplierInvoiceNo: 'IV-3', supplierInvoiceDate: '2026-10-01', supplierId: randomUUID() })).status).toBe(400);
    const ev = (await t.published('purchasing.bill_recorded')).find((e) => e.data.billId === b.body.id)!.data;
    expect(ev).toMatchObject({ billNo: 'AP-2569-0001', kind: 'goods', poNo: po.no, net: 300, vat: 21, gross: 321, vatClaimable: true, supplierTaxId: JURISTIC, supplierBranch: '00000', dueDate: '2026-11-19' });
    expect(() => parseEvent('purchasing.bill_recorded', ev)).not.toThrow();
  });

  it('service / expense bills: VAT modes and the claimable flag (§86/4)', async () => {
    const x = tenant();
    const b = await x.serviceBill(10000);
    expect(b).toMatchObject({ kind: 'service', net: 10000, vat: 700, gross: 10700, vat_claimable: true, vat_mode: 'exclusive' });
    const inc = await x.serviceBill(1070, { vatMode: 'inclusive' });
    expect(inc).toMatchObject({ net: 1000, vat: 70, gross: 1070 });
    const none = await x.serviceBill(500, { vatMode: 'none', supplierTaxId: undefined, kind: 'expense' });
    expect(none).toMatchObject({ net: 500, vat: 0, gross: 500, vat_claimable: false });
    // no tax ID → VAT is not claimable by default; asking for claimable without one → 400
    const noId = await x.serviceBill(1000, { supplierTaxId: undefined });
    expect(noId.vat_claimable).toBe(false);
    const bad = await x.api('POST', '/bills', { kind: 'service', ...x.supplier({ supplierTaxId: undefined }), supplierInvoiceNo: 'X1', supplierInvoiceDate: '2026-09-01', vatClaimable: true,
      lines: [{ description: 'x', unitPrice: 100 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fieldErrors.supplierTaxId[0]).toContain('86/4');
    // abbreviated tax invoice: user says not claimable
    expect((await x.serviceBill(1000, { vatClaimable: 'false' })).vat_claimable).toBe(false);
    // service bills cannot reference a PO; lines are required; future dates refused
    expect((await x.api('POST', '/bills', { kind: 'service', ...x.supplier(), supplierInvoiceNo: 'X2', supplierInvoiceDate: '2026-09-01' })).status).toBe(400);
    expect((await x.api('POST', '/bills', { kind: 'service', ...x.supplier(), supplierInvoiceNo: 'X3', supplierInvoiceDate: '2026-12-01', lines: [{ description: 'x', unitPrice: 1 }] })).status).toBe(400);
  });

  it('payables list and aging buckets as of a day', async () => {
    const x = tenant();
    const a = await x.serviceBill(1000, { dueDate: '2026-10-25' }); // not due
    const b = await x.serviceBill(2000, { dueDate: '2026-09-30' }); // 20 days
    const c = await x.serviceBill(3000, { billDate: '2026-06-01', supplierInvoiceDate: '2026-06-01', dueDate: '2026-07-01' }); // 111 days
    const list = (await x.api('GET', '/payables')).body;
    expect(list.map((r: any) => [r.no, r.days_overdue, r.bucket])).toEqual([[c.no, 111, 'เกิน 90 วัน'], [b.no, 20, '1–30 วัน'], [a.no, -5, 'ยังไม่ครบกำหนด']]);
    expect((await x.api('GET', '/payables?overdue=true')).body).toHaveLength(2);
    const aging = (await x.api('GET', '/payables/aging')).body;
    expect(aging.asOf).toBe('2026-10-20');
    expect(aging.totals).toEqual({ not_due: 1070, d1_30: 2140, d31_60: 0, d61_90: 0, over_90: 3210, total: 6420 });
    // as of before bill c existed's due date
    expect((await x.api('GET', '/payables/aging?asOf=2026-06-15')).body.totals).toMatchObject({ not_due: 3210, total: 3210 });
  });
});

describe('supplier payments with WHT', () => {
  it('partial payments, WHT on the pre-VAT part, cannot overpay; event + certificate', async () => {
    const x = tenant();
    const bill = await x.serviceBill(10000, { whtIncomeType: 'service' });
    const p1 = await x.api('POST', '/supplier-payments', { paymentDate: '2026-10-05', method: 'transfer', bills: [{ billId: bill.id, amount: 5350 }], wht: [{ incomeType: 'service' }] });
    expect(p1.status, JSON.stringify(p1.body)).toBe(201);
    expect(p1.body).toMatchObject({ no: 'PV-2569-0001', gross: 5350, wht_total: 150, net_paid: 5200, form: 'PND53', certificate_no: 'WHT-2569-0001', has_wht: true });
    expect(p1.body.wht[0]).toMatchObject({ income_type: 'service', description: 'ค่าบริการ', rate: 0.03, base: 5000, amount: 150, rate_percent: 3 });
    const after1 = (await x.api('GET', `/bills/${bill.id}`)).body;
    expect(after1).toMatchObject({ status: 'partially_paid', paid: 5350, outstanding: 5350 });
    // overpay → 409
    const over = await x.api('POST', `/bills/${bill.id}/payments`, { amount: 5350.01 });
    expect(over.status).toBe(409);
    expect(over.body.error.message).toContain('จ่ายเกินยอดค้าง');
    // pay the rest from the bill (form-style flat fields) — no WHT given → warning that the bill says service
    const p2 = await x.api('POST', `/bills/${bill.id}/payments`, { paymentDate: '2026-10-06', method: 'cheque', whtIncomeType: 'none', amount: '', bankRef: 'CHQ-001' });
    expect(p2.status).toBe(201);
    expect(p2.body).toMatchObject({ gross: 5350, wht_total: 0, net_paid: 5350, form: null, certificate_no: null, has_wht: false });
    expect(p2.body.warnings_text).toContain('ไม่ได้หักภาษี ณ ที่จ่าย');
    expect((await x.api('GET', `/bills/${bill.id}`)).body).toMatchObject({ status: 'paid', outstanding: 0 });
    expect((await x.api('POST', `/bills/${bill.id}/payments`, {})).status).toBe(409);
    const ev = (await t.published('purchasing.supplier_paid')).find((e) => e.data.paymentId === p1.body.id)!.data;
    expect(ev).toMatchObject({ paymentNo: 'PV-2569-0001', paymentDate: '2026-10-05', gross: 5350, netPaid: 5200, supplierTaxId: JURISTIC,
      bills: [{ billId: bill.id, billNo: bill.no, amount: 5350 }],
      wht: [{ form: 'PND53', incomeType: 'service', description: 'ค่าบริการ', rate: 0.03, base: 5000, amount: 150, certificateNo: 'WHT-2569-0001' }] });
    expect(() => parseEvent('purchasing.supplier_paid', ev)).not.toThrow();
  });

  it('exact satang: 12,345.67 + VAT, 3% → 370.37; several bills and WHT lines', async () => {
    const x = tenant();
    const b1 = await x.serviceBill(12345.67);
    expect(b1).toMatchObject({ net: 12345.67, vat: 864.2, gross: 13209.87 });
    const p = (await x.api('POST', '/supplier-payments', { bills: [{ billId: b1.id }], whtIncomeType: 'service' })).body;
    expect(p).toMatchObject({ gross: 13209.87, wht_total: 370.37, net_paid: 12839.5, payment_date: '2026-10-20' });
    // two bills of the same supplier, two WHT types (bases required)
    const sup = x.supplier();
    const b2 = await x.serviceBill(20000, { ...sup });
    const b3 = await x.serviceBill(1500.5, { ...sup });
    const missing = await x.api('POST', '/supplier-payments', { bills: [{ billId: b2.id }, { billId: b3.id }], wht: [{ incomeType: 'rent', base: 20000 }, { incomeType: 'transport' }] });
    expect(missing.status).toBe(400);
    const two = await x.api('POST', '/supplier-payments', { bills: [{ billId: b2.id }, { billId: b3.id }], wht: [{ incomeType: 'rent', base: 20000 }, { incomeType: 'transport', base: 1500.5 }] });
    expect(two.status, JSON.stringify(two.body)).toBe(201);
    // 21,400 + 1,605.54 = 23,005.54; rent 1,000.00 + transport 15.005 → 15.01
    expect(two.body).toMatchObject({ gross: 23005.54, wht_total: 1015.01, net_paid: 21990.53 });
    // WHT base above what is paid → 400
    const b4 = await x.serviceBill(1000);
    expect((await x.api('POST', '/supplier-payments', { bills: [{ billId: b4.id }], wht: [{ incomeType: 'service', base: 1070.01 }] })).status).toBe(400);
    // bills of different suppliers in one payment → 400
    const other = await x.serviceBill(1000);
    expect((await x.api('POST', '/supplier-payments', { bills: [{ billId: b4.id }, { billId: other.id }] })).status).toBe(400);
  });

  it('ภ.ง.ด.3 for an individual, ภ.ง.ด.53 for a company, override with a warning; under-1,000 warning', async () => {
    const x = tenant();
    const person = await x.serviceBill(1500, { ...x.supplier({ supplierName: 'นาย ช่างดี มีฝีมือ', supplierTaxId: PERSON }), vatMode: 'none' });
    const p = (await x.api('POST', '/supplier-payments', { bills: [{ billId: person.id }], whtIncomeType: 'hire_of_work' })).body;
    expect(p).toMatchObject({ form: 'PND3', form_label: 'ภ.ง.ด.3', wht_total: 45, net_paid: 1455 });
    const co = await x.serviceBill(900);
    const p2 = (await x.api('POST', '/supplier-payments', { bills: [{ billId: co.id }], whtIncomeType: 'service', form: 'PND3' })).body;
    expect(p2.form).toBe('PND3');
    expect(p2.warnings_text).toContain('ภ.ง.ด.53');
    expect(p2.warnings_text).toContain('ต่ำกว่า 1,000 บาท'); // warning, not a block
    expect(p2.wht_total).toBe(27);
    // form override "auto" from the form = default; rate override in percent
    const co2 = await x.serviceBill(5000);
    const p3 = (await x.api('POST', '/supplier-payments', { bills: [{ billId: co2.id }], whtIncomeType: 'service', whtRatePercent: 1, form: 'auto' })).body;
    expect(p3).toMatchObject({ form: 'PND53', wht_total: 50 });
    expect(p3.warnings_text).toContain('ต่างจากอัตราปกติ');
    // "other" needs a rate and a description
    const co3 = await x.serviceBill(5000);
    expect((await x.api('POST', '/supplier-payments', { bills: [{ billId: co3.id }], whtIncomeType: 'other' })).status).toBe(400);
  });

  it('respects the purchasing lock date for bills and payments', async () => {
    const x = tenant(['purchasing.bill.write', 'purchasing.bill.read', 'purchasing.payment.write', 'purchasing.payment.read', 'purchasing.lock.write']);
    const bill = await x.serviceBill(1000, { billDate: '2026-10-01' });
    expect((await x.api('POST', '/lock', { lockDate: '2026-09-30' })).status).toBe(200);
    const locked = await x.api('POST', '/bills', { kind: 'service', ...x.supplier(), supplierInvoiceNo: 'L1', supplierInvoiceDate: '2026-09-15', billDate: '2026-09-15', lines: [{ description: 'x', unitPrice: 1 }] });
    expect(locked.status).toBe(409);
    expect(locked.body.error.message).toContain('ปิดแล้ว');
    expect((await x.api('POST', '/supplier-payments', { bills: [{ billId: bill.id }], paymentDate: '2026-09-30' })).status).toBe(409);
    expect((await x.api('POST', '/supplier-payments', { bills: [{ billId: bill.id }], paymentDate: '2026-10-01' })).status).toBe(201);
    expect((await x.api('POST', '/supplier-payments', { bills: [{ billId: bill.id }], paymentDate: '2026-12-01' })).status).toBe(400); // future
  });
});

describe('50 ทวิ certificates', () => {
  it('numbered per tenant (เล่มที่ = BE year), with the legally required content; print log', async () => {
    const a = tenant();
    const b = tenant();
    const pay = async (x: ReturnType<typeof tenant>, net: number, date = '2026-10-10') => {
      const bill = await x.serviceBill(net);
      return (await x.api('POST', '/supplier-payments', { bills: [{ billId: bill.id }], whtIncomeType: 'service', paymentDate: date })).body;
    };
    const a1 = await pay(a, 1000);
    const a2 = await pay(a, 2000, '2026-10-02');
    const b1 = await pay(b, 3000);
    expect([a1.certificate_no, a2.certificate_no, b1.certificate_no]).toEqual(['WHT-2569-0001', 'WHT-2569-0002', 'WHT-2569-0001']);
    const cert = (await a.api('GET', `/wht-certificates/${a1.id}`)).body;
    expect(cert).toMatchObject({
      book_no: '2569', number: '0001', payee_name: 'บริษัท บริการดี จำกัด', payee_tax_id: JURISTIC, payee_branch: 'สำนักงานใหญ่', payee_address: '1 ถ.บางนา สมุทรปราการ',
      form: 'PND53', paid_date_text: '10/10/2569', total_paid: 1000, total_tax: 30, total_tax_text: 'สามสิบบาทถ้วน',
      // a2 was paid earlier in the month → a1 is the 2nd entry of October's ภ.ง.ด.53
      seq_in_form: 2, signer_name: 'คุณบัญชี',
    });
    expect(cert.form_boxes).toContain('☑ ภ.ง.ด.53');
    expect(cert.form_boxes).toContain('☐ ภ.ง.ด.3 ');
    expect(cert.condition_boxes.startsWith('☑ (1) หัก ณ ที่จ่าย')).toBe(true);
    expect(cert.lines[0]).toMatchObject({ amount: 1000, tax: 30, rate_percent: 3, paid_date: '2026-10-10' });
    expect(cert.lines[0].income_type).toContain('มาตรา 3 เตรส — ค่าบริการ');
    expect(cert.copy_1).toContain('ฉบับที่ 1');
    expect(cert.copy_2).toContain('ฉบับที่ 2');
    expect(cert.warning_text).toContain('มาตรา 35');
    expect((await a.api('POST', `/wht-certificates/${a1.id}/print`)).body.print_count).toBe(1);
    expect((await a.api('POST', `/wht-certificates/${a1.id}/print`)).body.print_count).toBe(2);
    // the list
    const list = (await a.api('GET', '/wht-certificates?period=2026-10')).body;
    expect(list.map((r: any) => r.certificate_no)).toEqual(['WHT-2569-0001', 'WHT-2569-0002']);
    // a payment without WHT has no certificate
    const nb = await a.serviceBill(100);
    const none = (await a.api('POST', '/supplier-payments', { bills: [{ billId: nb.id }] })).body;
    expect((await a.api('GET', `/wht-certificates/${none.id}`)).status).toBe(404);
  });
});

describe('monthly ภ.ง.ด.3 / ภ.ง.ด.53', () => {
  it('report totals by period and form, due dates, exports', async () => {
    const x = tenant();
    const pay = async (net: number, date: string, sup: Record<string, unknown> = {}, wht = 'service') => {
      const bill = await x.serviceBill(net, { ...x.supplier(sup), billDate: '2026-08-01', supplierInvoiceDate: '2026-08-01' });
      const r = await x.api('POST', '/supplier-payments', { bills: [{ billId: bill.id }], whtIncomeType: wht, paymentDate: date });
      expect(r.status).toBe(201);
      return r.body;
    };
    await pay(10000, '2026-09-05');
    await pay(12345.67, '2026-09-30', { supplierName: 'ห้างหุ้นส่วนจำกัด ช่างดี', supplierTaxId: '0994000161239', supplierBranch: '1', supplierAddress: null });
    await pay(5000, '2026-10-01'); // October
    await pay(1500, '2026-09-15', { supplierName: 'นาย สมชาย ใจดี', supplierTaxId: PERSON, supplierAddress: '9 ม.2 ต.บางพลี' }, 'hire_of_work');
    const list = (await x.api('GET', '/wht/returns?year=2569')).body;
    expect(list.map((r: any) => [r.id, r.payees, r.total_amount, r.total_tax])).toEqual([
      ['2026-10_PND53', 1, 5000, 150], ['2026-09_PND3', 1, 1500, 45], ['2026-09_PND53', 2, 22345.67, 670.37],
    ]);
    expect(list[2]).toMatchObject({ due_paper: '2026-10-07', due_efiling: '2026-10-15', period_label: 'กันยายน 2569', form_label: 'ภ.ง.ด.53' });
    const r = (await x.api('GET', '/wht/returns/2026-09_PND53')).body;
    expect(r).toMatchObject({ title: 'ภ.ง.ด.53 เดือนกันยายน 2569', payees: 2, lines: 2, total_amount: 22345.67, total_tax: 670.37, total_tax_text: 'หกร้อยเจ็ดสิบบาทสามสิบเจ็ดสตางค์' });
    expect(r.rows.map((w: any) => [w.seq, w.tax_id, w.branch, w.paid_date, w.income_type, w.rate_percent, w.amount, w.tax, w.condition])).toEqual([
      [1, JURISTIC, '00000', '2026-09-05', 'ค่าบริการ', 3, 10000, 300, '1'],
      [2, '0994000161239', '00001', '2026-09-30', 'ค่าบริการ', 3, 12345.67, 370.37, '1'],
    ]);
    expect(r.rd_note).toContain('ต้องตรวจกับโปรแกรม RD Prep เวอร์ชันล่าสุดก่อนยื่นจริง');
    expect(r.rd_text).toBe(
      '1|0105537000015|00000|บริษัท|บริการดี จำกัด|1 ถ.บางนา สมุทรปราการ|05/09/2569|ค่าบริการ|3.00|10000.00|300.00|1\r\n' +
      '2|0994000161239|00001|ห้างหุ้นส่วนจำกัด|ช่างดี||30/09/2569|ค่าบริการ|3.00|12345.67|370.37|1\r\n');
    expect((await x.api('GET', '/wht/returns/2026-09_PND3')).body.rd_text).toBe('1|1101700203450|00000|นาย|สมชาย|ใจดี|9 ม.2 ต.บางพลี|15/09/2569|ค่าจ้างทำของ|3.00|1500.00|45.00|1\r\n');
    // exports
    const csv = await t.raw('GET', '/wht/returns/2026-09_PND53/export?format=csv', undefined, { token: x.token });
    expect(csv.status).toBe(200);
    expect(String(csv.headers['content-type'])).toContain('text/csv');
    expect(String(csv.headers['content-disposition'])).toContain('PND53_256909.csv');
    expect(csv.body.toString('utf8')).toContain('รวม,,,,,,,,,22345.67,670.37,');
    const txt = await t.raw('GET', '/wht/returns/2026-09_PND53/export?format=rd', undefined, { token: x.token });
    expect(String(txt.headers['content-type'])).toContain('tis-620');
    expect(txt.headers['x-rd-prep-layout']).toBe('unverified');
    expect(new TextDecoder('windows-874').decode(txt.body)).toBe(r.rd_text);
    const utf = await t.raw('GET', '/wht/returns/2026-09_PND53/export?format=rd&encoding=utf8', undefined, { token: x.token });
    expect(utf.body.toString('utf8')).toBe(r.rd_text);
    // attachment rows list (web CSV export) defaults to this month, PND53
    expect((await x.api('GET', '/wht/attachment-rows')).body.map((w: any) => w.amount)).toEqual([5000]);
    expect((await x.api('GET', '/wht/attachment-rows?period=2026-09&form=PND3')).body).toHaveLength(1);
    expect((await x.api('GET', '/wht/returns/2026-13_PND53')).status).toBe(400);
  });
});

describe('permissions & tenant isolation', () => {
  it('each endpoint needs its permission', async () => {
    const x = tenant();
    const bill = await x.serviceBill(1000);
    const p = (await x.api('POST', '/supplier-payments', { bills: [{ billId: bill.id }], whtIncomeType: 'service' })).body;
    const as = (perms: string[]) => t.token(perms, x.id);
    const body = { kind: 'service', ...x.supplier(), supplierInvoiceNo: 'P1', supplierInvoiceDate: '2026-09-01', lines: [{ description: 'x', unitPrice: 1 }] };
    expect((await x.api('POST', '/bills', body, as(['purchasing.bill.read']))).status).toBe(403);
    expect((await x.api('GET', '/bills', undefined, as(['purchasing.po.read']))).status).toBe(403);
    expect((await x.api('GET', '/payables', undefined, as(['purchasing.payment.read']))).status).toBe(403);
    expect((await x.api('GET', '/payables/aging', undefined, as(['purchasing.bill.read']))).status).toBe(200);
    expect((await x.api('POST', '/supplier-payments', { bills: [{ billId: bill.id }] }, as(['purchasing.bill.write', 'purchasing.payment.read']))).status).toBe(403);
    expect((await x.api('POST', `/bills/${bill.id}/payments`, {}, as(['purchasing.bill.write']))).status).toBe(403);
    expect((await x.api('GET', `/supplier-payments/${p.id}`, undefined, as(['purchasing.bill.read']))).status).toBe(403);
    expect((await x.api('GET', '/wht/returns', undefined, as(['purchasing.payment.read']))).status).toBe(403);
    expect((await x.api('GET', '/wht/returns/2026-10_PND53', undefined, as(['purchasing.payment.read']))).status).toBe(403);
    expect((await t.raw('GET', '/wht/returns/2026-10_PND53/export', undefined, { token: as(['purchasing.payment.read']) })).status).toBe(403);
    expect((await x.api('GET', '/wht/attachment-rows', undefined, as(['purchasing.bill.read']))).status).toBe(403);
    expect((await x.api('GET', '/wht/returns', undefined, as(['purchasing.wht.read']))).status).toBe(200);
    // certificates: wht.read or payment.read
    expect((await x.api('GET', `/wht-certificates/${p.id}`, undefined, as(['purchasing.bill.read']))).status).toBe(403);
    expect((await x.api('GET', `/wht-certificates/${p.id}`, undefined, as(['purchasing.wht.read']))).status).toBe(200);
    expect((await x.api('POST', `/wht-certificates/${p.id}/print`, undefined, as(['purchasing.payment.read']))).status).toBe(200);
    expect((await x.api('GET', '/wht-certificates', undefined, as(['purchasing.po.read']))).status).toBe(403);
  });

  it('another tenant sees none of the bills, payments, WHT lines or certificates', async () => {
    const a = tenant();
    const b = tenant();
    const bill = await a.serviceBill(4000);
    const p = (await a.api('POST', '/supplier-payments', { bills: [{ billId: bill.id }], whtIncomeType: 'service', paymentDate: '2026-10-01' })).body;
    expect((await b.api('GET', `/bills/${bill.id}`)).status).toBe(404);
    expect((await b.api('GET', '/bills')).body).toEqual([]);
    expect((await b.api('GET', '/payables')).body).toEqual([]);
    expect((await b.api('GET', '/payables/aging')).body.rows).toEqual([]);
    expect((await b.api('GET', `/supplier-payments/${p.id}`)).status).toBe(404);
    expect((await b.api('GET', '/supplier-payments')).body).toEqual([]);
    expect((await b.api('GET', `/wht-certificates/${p.id}`)).status).toBe(404);
    expect((await b.api('POST', `/wht-certificates/${p.id}/print`)).status).toBe(404);
    expect((await b.api('GET', '/wht-certificates')).body).toEqual([]);
    expect((await b.api('GET', '/wht/returns')).body).toEqual([]);
    expect((await b.api('GET', '/wht/returns/2026-10_PND53')).body.rows).toEqual([]);
    // b cannot pay a's bill
    expect((await b.api('POST', '/supplier-payments', { bills: [{ billId: bill.id }] })).status).toBe(404);
    expect((await b.api('POST', `/bills/${bill.id}/payments`, {})).status).toBe(404);
    // a still sees everything
    expect((await a.api('GET', `/supplier-payments/${p.id}`)).body.wht).toHaveLength(1);
    expect((await a.api('GET', `/bills/${bill.id}`)).body.lines).toHaveLength(1);
  });
});

describe('screens', () => {
  it('WHT type options in ui.ts match @erp/thai', () => {
    expect(whtTypeOptions.map((o) => o.value).sort()).toEqual(Object.keys(WHT_INCOME_TYPES).sort());
    for (const o of whtTypeOptions) expect(o.label.startsWith(WHT_INCOME_TYPES[o.value].nameTh)).toBe(true);
    expect(ui.screens.whtCert1.kind).toBe('detail');
  });
});
