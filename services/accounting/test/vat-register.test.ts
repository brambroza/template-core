/** Wave 8 (accountant round 2): C3 non-creditable input VAT, C7/C8 VAT registers with the tax invoice, C11 ภ.พ.30 carry-forward. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

function tenant(perms = ['*']) {
  const id = randomUUID();
  const token = t.token(perms, id, { userId: randomUUID(), userName: 'คุณบัญชี ทดสอบ' });
  const api = (m: string, url: string, body?: unknown, tok = token) => t.api(m, url, body, { token: tok });
  const deliver = async (type: any, data: unknown) => { parseEvent(type, data); const r = await t.deliver(type, data, { tenantId: id }); expect(r.status).toBe(200); return r; };
  const journals = async (source: string) => (await api('GET', `/journals?source=${source}`)).body as any[];
  const detail = async (jid: string) => (await api('GET', `/journals/${jid}`)).body;
  const lines = (d: any, code: string) => d.lines.filter((l: any) => l.account_code === code);
  return { id, token, api, deliver, journals, detail, lines };
}

const item = { itemId: randomUUID(), itemCode: 'RM-STEEL', itemName: 'เหล็กแผ่น' };
const supplierId = randomUUID();
const invoice = (no: string, date: string, net: number, extra: Record<string, unknown> = {}) => ({
  invoiceId: randomUUID(), invoiceNo: no, orderId: randomUUID(), net, vat: Math.round(net * 7) / 100, gross: Math.round(net * 107) / 100,
  customerId: randomUUID(), customerName: 'บริษัท คูลแอร์ แมนูแฟคเจอริ่ง จำกัด', issueDate: date, ...extra,
});
const receipt = (po: string, date: string, net: number, extra: Record<string, unknown> = {}) => ({
  poId: randomUUID(), poNo: po, supplierId, supplierName: 'บริษัท เหล็กสยาม จำกัด', warehouseCode: 'MAIN',
  lines: [{ ...item, qty: 1, unitPrice: net, vatRate: 0.07 }], vatMode: 'exclusive', net, vat: Math.round(net * 7) / 100, gross: Math.round(net * 107) / 100,
  receivedDate: date, ...extra,
});

describe('VAT registers carry the tax invoice (C7 / C8)', () => {
  it('purchase register: supplier invoice no/date, name, tax ID, branch; a return reduces base and tax so the register equals ภ.พ.30', async () => {
    const x = tenant();
    const gr = receipt('PO-2568-0001', '2025-01-10', 30_000, {
      supplierInvoiceNo: 'IV6801-0099', supplierInvoiceDate: '2025-01-09', supplierTaxId: '0105537000015', supplierBranch: '00000' });
    await x.deliver('purchasing.goods_received', gr);
    // the accountant's RT-2569-0001: 9,600 + 672 returned
    await x.deliver('purchasing.goods_returned', { returnId: randomUUID(), returnNo: 'RT-2568-0001', poId: gr.poId, poNo: gr.poNo, supplierId, supplierName: gr.supplierName,
      warehouseCode: 'QC-HOLD', lines: [{ ...item, qty: 1, unitPrice: 9_600 }], vatMode: 'exclusive', net: 9_600, vat: 672, gross: 10_272, returnDate: '2025-01-20' });
    const reg = (await x.api('GET', '/reports/vat/lines?month=2025-01&kind=input')).body;
    expect(reg.rows.map((r: any) => [r.document_no, r.tax_invoice_date, r.party_name, r.party_tax_id, r.party_branch_label, r.tax_base, r.vat])).toEqual([
      ['IV6801-0099', '2025-01-09', 'บริษัท เหล็กสยาม จำกัด', '0105537000015', 'สำนักงานใหญ่', 30_000, 2_100],
      ['RT-2568-0001', '2025-01-20', 'บริษัท เหล็กสยาม จำกัด', null, null, -9_600, -672],
    ]);
    expect(reg.rows[0].ref).toBe('PO-2568-0001'); // our PO stays as the reference, not as the invoice number
    expect(reg.totals).toMatchObject({ base: 20_400, vat: 1_428 });
    const m = (await x.api('GET', '/reports/vat?year=2025')).body.rows.find((r: any) => r.month === '2025-01');
    expect(m).toMatchObject({ input_base: reg.totals.base, input_vat: reg.totals.vat });
  });

  it('sales register: the buyer tax ID and branch from the invoice', async () => {
    const x = tenant();
    await x.deliver('sales.invoiced', invoice('INV-2568-0001', '2025-02-03', 14_800, { customerTaxId: '0105556123453', customerBranch: '00002' }));
    await x.deliver('sales.invoiced', invoice('INV-2568-0002', '2025-02-05', 1_000)); // old payload: no tax ID
    const reg = (await x.api('GET', '/reports/vat/lines?month=2025-02&kind=output')).body;
    expect(reg.rows.map((r: any) => [r.document_no, r.tax_invoice_date, r.party_tax_id, r.party_branch_label, r.tax_base, r.vat])).toEqual([
      ['INV-2568-0001', '2025-02-03', '0105556123453', 'สาขา 00002', 14_800, 1_036],
      ['INV-2568-0002', '2025-02-05', null, null, 1_000, 70],
    ]);
  });
});

describe('expense claims: non-creditable VAT goes into the expense (C3)', () => {
  it('posts 336 entertainment VAT and 70 abbreviated fuel VAT into the expense accounts; only the full tax invoice is ภาษีซื้อ with the seller in the register', async () => {
    const x = tenant();
    await x.deliver('expense.claim_paid', {
      claimId: randomUUID(), no: 'EXP-2568-0005', claimantName: 'สมศักดิ์ พนักงานขาย', claimantId: randomUUID(), total: 9_416, paidDate: '2025-03-05', payMethod: 'transfer',
      lines: [
        { categoryCode: 'ENTERTAIN', categoryName: 'ค่ารับรอง', amount: 4_800, vat: 336, vatClaimable: false, receiptType: 'full_tax_invoice', expenseDate: '2025-03-01',
          vendorName: 'ภัตตาคารริมน้ำ', vendorTaxId: '0105556123453', receiptNo: 'R-1' },
        { categoryCode: 'FUEL', categoryName: 'ค่าน้ำมัน', amount: 1_000, vat: 70, vatClaimable: false, receiptType: 'abbreviated', expenseDate: '2025-03-02' },
        { categoryCode: 'FUEL', categoryName: 'ค่าน้ำมัน', amount: 3_000, vat: 210, vatClaimable: true, receiptType: 'full_tax_invoice', expenseDate: '2025-03-03',
          vendorName: 'ปตท. สาขาบางนา', vendorTaxId: '0107544000108', vendorBranch: '00123', receiptNo: 'PTT-778' },
      ],
    });
    const d = await x.detail((await x.journals('expense.claim_paid'))[0].id);
    expect(x.lines(d, '52600').map((l: any) => l.debit)).toEqual([5_136]); // 4,800 + 336
    expect(x.lines(d, '52520').map((l: any) => l.debit)).toEqual([4_070]); // 1,000 + 70 + 3,000
    expect(x.lines(d, '11500').map((l: any) => [l.debit, l.tax_base, l.tax_invoice_no, l.tax_party_name])).toEqual([[210, 3_000, 'PTT-778', 'ปตท. สาขาบางนา']]);
    expect(x.lines(d, '11200').map((l: any) => l.credit)).toEqual([9_416]);
    expect(d.note).toContain('406.00');
    const reg = (await x.api('GET', '/reports/vat/lines?month=2025-03&kind=input')).body;
    expect(reg.rows).toHaveLength(1);
    expect(reg.rows[0]).toMatchObject({ document_no: 'PTT-778', tax_invoice_date: '2025-03-03', party_name: 'ปตท. สาขาบางนา', party_tax_id: '0107544000108',
      party_branch_label: 'สาขา 00123', tax_base: 3_000, vat: 210 });
    expect(reg.rows[0].party_name).not.toContain('สมศักดิ์'); // the seller, not the employee who paid
  });

  it('old payloads (no vatClaimable) still credit all VAT', async () => {
    const x = tenant();
    await x.deliver('expense.claim_paid', { claimId: randomUUID(), no: 'EXP-2568-0006', claimantName: 'ก', total: 1_070, paidDate: '2025-03-05', payMethod: 'cash',
      lines: [{ categoryCode: 'FUEL', categoryName: 'ค่าน้ำมัน', amount: 1_000, vat: 70 }] });
    const d = await x.detail((await x.journals('expense.claim_paid'))[0].id);
    expect(x.lines(d, '11500').map((l: any) => [l.debit, l.tax_base])).toEqual([[70, 1_000]]);
  });
});

describe('ภ.พ.30 summary carries excess input VAT forward (C11)', () => {
  it('never nets months: Jan excess 728 is used in Feb, Mar excess 3,500 is carried out of the year and into January next year', async () => {
    const x = tenant();
    // Jan 2025: output 700 (10,000); input 2,100 − return 672 = 1,428 → excess 728
    const gr = receipt('PO-2568-0010', '2025-01-10', 30_000, { supplierInvoiceNo: 'A-1', supplierInvoiceDate: '2025-01-10' });
    await x.deliver('purchasing.goods_received', gr);
    await x.deliver('purchasing.goods_returned', { returnId: randomUUID(), returnNo: 'RT-2568-0010', poId: gr.poId, poNo: gr.poNo, supplierId, supplierName: gr.supplierName,
      warehouseCode: 'MAIN', lines: [{ ...item, qty: 1, unitPrice: 9_600 }], vatMode: 'exclusive', net: 9_600, vat: 672, gross: 10_272, returnDate: '2025-01-20' });
    await x.deliver('sales.invoiced', invoice('INV-2568-0010', '2025-01-15', 10_000));
    // Feb: output 1,400 → 1,400 − 728 carried in = 672 to pay
    await x.deliver('sales.invoiced', invoice('INV-2568-0011', '2025-02-15', 20_000));
    // Mar: input 3,500 → excess 3,500 carried forward
    await x.deliver('purchasing.goods_received', receipt('PO-2568-0011', '2025-03-10', 50_000));
    const vat = (await x.api('GET', '/reports/vat?year=2025')).body;
    const row = (m: string) => vat.rows.find((r: any) => r.month === m);
    expect(row('2025-01')).toMatchObject({ output_vat: 700, input_base: 20_400, input_vat: 1_428, net: -728, carried_in: 0, payable: 0, carry_forward: 728, result: 'ภาษีซื้อเกิน (ยกไปเดือนถัดไป)' });
    expect(row('2025-02')).toMatchObject({ output_vat: 1_400, net: 1_400, carried_in: 728, payable: 672, carry_forward: 0, result: 'ชำระเพิ่ม' });
    expect(row('2025-03')).toMatchObject({ net: -3_500, carried_in: 0, payable: 0, carry_forward: 3_500 });
    expect(row('2025-12')).toMatchObject({ net: 0, carried_in: 3_500, payable: 0, carry_forward: 3_500 });
    expect(vat.totals).toMatchObject({ payable: 672, carryForward: 3_500, carriedIntoYear: 0 });
    expect(vat.table.at(-1)).toMatchObject({ net: null, payable: 672, carry_forward: 3_500 });
    const next = (await x.api('GET', '/reports/vat?year=2026')).body;
    expect(next.rows[0]).toMatchObject({ month: '2026-01', carried_in: 3_500 });
    expect(next.totals.carriedIntoYear).toBe(3_500);
    // another company sees none of it
    const other = tenant();
    expect((await other.api('GET', '/reports/vat?year=2025')).body.totals).toMatchObject({ payable: 0, carryForward: 0, inputVat: 0 });
    expect((await other.api('GET', '/reports/vat/lines?month=2025-01&kind=input')).body.rows).toEqual([]);
    // report permission
    expect((await x.api('GET', '/reports/vat/lines?month=2025-01&kind=input', undefined, t.token(['accounting.journal.read'], x.id))).status).toBe(403);
  });
});

describe('WHT received keeps its base (C4)', () => {
  it('books the whtAmount from the receipt and its base (services only) for the 50 ทวิ follow-up', async () => {
    const x = tenant();
    await x.deliver('sales.payment_received', { receiptId: randomUUID(), receiptNo: 'RC-2568-0014', kind: 'payment', customerId: null, customerName: 'บริษัท คูลแอร์',
      receiptDate: '2025-04-03', method: 'transfer', total: 15_836, whtAmount: 300, whtBase: 10_000, depositApplied: 0, received: 15_536,
      invoices: [{ invoiceId: randomUUID(), invoiceNo: 'INV-2568-0014', amount: 15_836, outstanding: 0 }] });
    const d = await x.detail((await x.journals('sales.payment_received'))[0].id);
    expect(x.lines(d, '11600').map((l: any) => [l.debit, l.tax_base])).toEqual([[300, 10_000]]);
    expect(x.lines(d, '11200').map((l: any) => l.debit)).toEqual([15_536]);
    const wht = (await x.api('GET', '/reports/wht-received?year=2025')).body;
    expect(wht.lines[0]).toMatchObject({ amount: 300, tax_base: 10_000 });
  });
});
