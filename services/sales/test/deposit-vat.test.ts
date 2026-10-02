import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setClock } from '@erp/kernel';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });
afterEach(() => setClock(null));

const goods = (unitPrice: number) => ({ description: 'แม่พิมพ์ฉีดพลาสติก', qty: 1, unitPrice });
const cust = () => ({ customerId: randomUUID(), customerName: `บริษัท ทดสอบมัดจำ ${randomUUID().slice(0, 4)} จำกัด`, customerTaxId: '0105558123451', customerBranch: '00001' });

async function confirmedOrder(c: object, lines: object[], token?: string) {
  const o = (await t.api('POST', '/orders', { ...c, creditDays: 30, lines }, { token })).body;
  expect((await t.api('POST', `/orders/${o.id}/confirm`, undefined, { token })).status).toBe(200);
  return o;
}

describe('C2 — output VAT on deposits (ใบกำกับภาษีเงินมัดจำ)', () => {
  it('a 30% deposit of 99,670.50 incl. VAT is a tax point: base 93,150.00 + VAT 6,520.50 on DT-…, deducted on the final invoice', async () => {
    const c = cust();
    const o = await confirmedOrder(c, [goods(310500)]); // exclusive: VAT 21,735 → gross 332,235
    expect(o).toMatchObject({ net: 310500, vat: 21735, gross: 332235 });
    const dep = await t.api('POST', '/receipts', { orderId: o.id, depositAmount: 99670.5, method: 'transfer', receiptDate: '2026-10-01' });
    expect(dep.status).toBe(201);
    expect(dep.body).toMatchObject({
      kind: 'deposit', title: 'ใบรับเงินมัดจำ / ใบกำกับภาษี', vat_mode: 'inclusive', total: 99670.5, net: 93150, vat: 6520.5,
      tax_invoice_no: 'DT-2569-0001', deposit_remaining: 99670.5, deposit_vat_remaining: 6520.5, received: 99670.5,
    });
    const ev = (await t.published('sales.payment_received')).find((e) => e.data.receiptId === dep.body.id)!.data;
    expect(ev).toMatchObject({ kind: 'deposit', total: 99670.5, net: 93150, vat: 6520.5, taxInvoiceNo: 'DT-2569-0001', receiptDate: '2026-10-01' });

    // the VAT deposit cannot be used on a receipt — it is deducted on the tax invoice
    const inv = await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-10-03' });
    expect(inv.status).toBe(201);
    // full value 310,500 − deposit base 93,150 = 217,350 → VAT only 15,214.50 (21,735 − 6,520.50); due 232,564.50
    expect(inv.body).toMatchObject({ net: 217350, vat: 15214.5, gross: 232564.5, deposit_net: 93150, deposit_vat: 6520.5, deposit_gross: 99670.5, outstanding: 232564.5 });
    expect(inv.body.depositDeductions).toMatchObject([{ deposit_no: dep.body.no, tax_invoice_no: 'DT-2569-0001', net: 93150, vat: 6520.5, gross: 99670.5 }]);
    const iev = (await t.published('sales.invoiced')).find((e) => e.data.invoiceId === inv.body.id)!.data;
    expect(iev).toMatchObject({
      net: 217350, vat: 15214.5, gross: 232564.5,
      depositApplied: { net: 93150, vat: 6520.5, gross: 99670.5, deposits: [{ depositId: dep.body.id, depositNo: dep.body.no, taxInvoiceNo: 'DT-2569-0001', net: 93150, vat: 6520.5, gross: 99670.5 }] },
    });
    const after = (await t.api('GET', `/receipts/${dep.body.id}`)).body;
    expect(after).toMatchObject({ deposit_remaining: 0, deposit_vat_remaining: 0, applications: [{ doc_no: inv.body.no, doc_kind: 'invoice', amount: 99670.5, vat: 6520.5 }] });

    // pay the rest: AR closes at the reduced gross
    const rc = (await t.api('POST', '/receipts', { method: 'transfer', receiptDate: '2026-10-03', lines: [{ invoiceId: inv.body.id, amount: 232564.5 }] })).body;
    expect(rc.received).toBe(232564.5);
    expect((await t.api('GET', `/invoices/${inv.body.id}`)).body.payment_status).toBe('paid');
  });

  it('accountant RC-0008: 5,000 deposit → VAT 327.10; invoice of 14,800 + VAT charges 708.90 VAT', async () => {
    const c = cust();
    const o = await confirmedOrder(c, [goods(4800), { description: 'ค่าบริการติดตั้ง', qty: 1, unitPrice: 10000 }]); // 14,800 + 1,036 = 15,836
    const dep = (await t.api('POST', '/receipts', { orderId: o.id, depositAmount: 5000, method: 'cash', receiptDate: '2026-10-01' })).body;
    expect(dep).toMatchObject({ net: 4672.9, vat: 327.1 });
    const inv = (await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-10-03' })).body;
    expect(inv).toMatchObject({ net: 10127.1, vat: 708.9, gross: 10836 });
  });

  it('receipt-time use of a VAT deposit is refused; applyDeposits:false keeps the deposit open', async () => {
    const c = cust();
    const o = await confirmedOrder(c, [goods(1000)]);
    const dep = (await t.api('POST', '/receipts', { orderId: o.id, depositAmount: 535, method: 'cash', receiptDate: '2026-10-01' })).body;
    const inv = (await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-10-02', applyDeposits: false })).body;
    expect(inv).toMatchObject({ net: 1000, vat: 70, gross: 1070, deposit_gross: 0, depositDeductions: [] });
    const r = await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 1070 }], deposits: [{ depositId: dep.id }] });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain('หักมัดจำในใบกำกับภาษี');
  });

  it('exclusive deposit mode adds VAT; explicit partial deduction is pro rata and the last use takes the exact rest', async () => {
    const c = cust();
    const ex = (await t.api('POST', '/receipts', { ...c, depositAmount: 93150, depositVatMode: 'exclusive', method: 'transfer', receiptDate: '2026-10-01' })).body;
    expect(ex).toMatchObject({ total: 99670.5, net: 93150, vat: 6520.5, received: 99670.5 });

    const dep = (await t.api('POST', '/receipts', { ...c, depositAmount: 1000, method: 'cash', receiptDate: '2026-10-01' })).body; // 934.58 + 65.42
    expect(dep).toMatchObject({ net: 934.58, vat: 65.42 });
    const o1 = await confirmedOrder(c, [goods(1000)]);
    const i1 = (await t.api('POST', `/orders/${o1.id}/invoice`, { issueDate: '2026-10-02', deposits: [{ depositId: dep.id, amount: 333.33 }] })).body;
    // 333.33 × 65.42 / 1,000 = 21.81 VAT
    expect(i1).toMatchObject({ deposit_gross: 333.33, deposit_vat: 21.81, deposit_net: 311.52, vat: 48.19, gross: 736.67, net: 688.48 });
    const o2 = await confirmedOrder(c, [goods(1000)]);
    const i2 = (await t.api('POST', `/orders/${o2.id}/invoice`, { issueDate: '2026-10-02', deposits: [{ depositId: dep.id }] })).body;
    expect(i2).toMatchObject({ deposit_gross: 666.67, deposit_vat: 43.61 }); // 65.42 − 21.81
    expect((await t.api('GET', `/receipts/${dep.id}`)).body).toMatchObject({ deposit_remaining: 0, deposit_vat_remaining: 0 });

    // errors: someone else's deposit, a non-VAT deposit, more than remains
    const o3 = await confirmedOrder(c, [goods(10)]);
    const stranger = (await t.api('POST', '/receipts', { ...cust(), depositAmount: 10, method: 'cash' })).body;
    const plain = (await t.api('POST', '/receipts', { ...c, depositAmount: 10, method: 'cash', depositVatMode: 'none' })).body;
    for (const deposits of [[{ depositId: stranger.id }], [{ depositId: plain.id }], [{ depositId: ex.id, amount: 99999 }]]) {
      expect((await t.api('POST', `/orders/${o3.id}/invoice`, { deposits })).status).toBe(400);
    }
  });

  it('a deposit deducted on an invoice counts as used in receivables as of the invoice date', async () => {
    const tid = randomUUID();
    const tok = t.token(['*'], tid);
    const c = cust();
    const o = await confirmedOrder(c, [goods(1000)], tok);
    await t.api('POST', '/receipts', { orderId: o.id, depositAmount: 535, method: 'cash', receiptDate: '2026-09-20' }, { token: tok });
    await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-09-25' }, { token: tok });
    expect((await t.api('GET', '/receivables?asOf=2026-09-22', undefined, { token: tok })).body.totals).toMatchObject({ outstanding: 0, deposits: 535 });
    expect((await t.api('GET', '/receivables?asOf=2026-09-30', undefined, { token: tok })).body.totals).toMatchObject({ outstanding: 535, deposits: 0 });
  });
});

describe('C5 — lock date (วันที่ปิดงวด)', () => {
  it('accounting.period_closed locks invoices and receipts on/before the period end; override needs perm + reason; reopen unlocks', async () => {
    const tid = randomUUID();
    const all = t.token(['sales.order.read', 'sales.order.write', 'sales.invoice.write', 'sales.receipt.write', 'sales.receivable.read'], tid);
    const c = cust();
    const o = await confirmedOrder(c, [goods(2000)], all);
    expect((await t.deliver('accounting.period_closed', { period: '2026-09', lastDate: '2026-09-30', closedByName: 'คุณบัญชี' }, { tenantId: tid })).status).toBe(200);
    expect((await t.api('GET', '/lock', undefined, { token: all })).body).toMatchObject({ lockDate: '2026-09-30', source: 'accounting', period: '2026-09', updatedByName: 'คุณบัญชี' });

    const back = await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-09-20' }, { token: all });
    expect(back.status).toBe(409);
    expect(back.body.error.message).toContain('30 กันยายน 2569 ปิดแล้ว');
    expect((await t.api('POST', '/receipts', { ...c, depositAmount: 100, method: 'cash', receiptDate: '2026-09-30' }, { token: all })).status).toBe(409);

    const boss = t.token(['sales.*'], tid, { userName: 'ผู้จัดการบัญชี' });
    expect((await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-09-20' }, { token: boss })).status).toBe(409); // no reason
    const ok = await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-09-20', lockOverrideReason: 'ส่งของ 20 ก.ย. ลืมออกใบกำกับ — ยื่น ภ.พ.30 เพิ่มเติม' }, { token: boss });
    expect(ok.status).toBe(201);
    const audit = (await t.api('GET', '/_audit', undefined, { token: boss })).body;
    expect(JSON.stringify(audit)).toContain('ยื่น ภ.พ.30 เพิ่มเติม');

    // October is open; an older close never moves the lock back; reopening September steps back to 31 Aug
    expect((await t.api('POST', '/receipts', { ...c, depositAmount: 100, method: 'cash', receiptDate: '2026-10-01' }, { token: all })).status).toBe(201);
    await t.deliver('accounting.period_closed', { period: '2026-08', lastDate: '2026-08-31' }, { tenantId: tid });
    expect((await t.api('GET', '/lock', undefined, { token: all })).body.lockDate).toBe('2026-09-30');
    await t.deliver('accounting.period_reopened', { period: '2026-09', firstDate: '2026-09-01' }, { tenantId: tid });
    expect((await t.api('GET', '/lock', undefined, { token: all })).body.lockDate).toBe('2026-08-31');
    expect((await t.api('POST', '/receipts', { ...c, depositAmount: 100, method: 'cash', receiptDate: '2026-09-15' }, { token: all })).status).toBe(201);

    // the lock belongs to this tenant only
    expect((await t.api('GET', '/lock', undefined, { token: t.token(['*'], randomUUID()) })).body.lockDate).toBeNull();
  });

  it('manual lock needs sales.lock.write, cannot be in the future, and null clears it', async () => {
    const tid = randomUUID();
    expect((await t.api('POST', '/lock', { lockDate: '2026-09-30' }, { token: t.token(['sales.invoice.write'], tid) })).status).toBe(403);
    expect((await t.api('GET', '/lock', undefined, { token: t.token(['sales.order.read'], tid) })).status).toBe(403);
    const acc = t.token(['sales.lock.write'], tid, { userName: 'คุณบัญชี' });
    expect((await t.api('POST', '/lock', { lockDate: '2099-01-01' }, { token: acc })).status).toBe(400);
    expect((await t.api('POST', '/lock', { lockDate: '2026-09-30' }, { token: acc })).body).toMatchObject({ lockDate: '2026-09-30', source: 'manual', updatedByName: 'คุณบัญชี' });
    expect((await t.api('POST', '/lock', { lockDate: null }, { token: acc })).body.lockDate).toBeNull();
    await t.api('POST', '/lock', { lockDate: '2026-09-30' }, { token: acc });
    expect((await t.api('POST', '/lock', { lockDate: '' }, { token: acc })).body.lockDate).toBeNull(); // the form's empty date clears it
  });
});

describe('round-2 #4 — business dates at 02:00 Bangkok (ERP clock)', () => {
  it('order / invoice / receipt / deposit default to the Thai day, not the database UTC day', async () => {
    setClock('2026-10-02T19:00:00Z'); // 02:00 on 3 Oct in Bangkok; UTC is still 2 Oct
    const c = cust();
    const o = await confirmedOrder(c, [goods(100)]);
    expect(o.order_date).toBe('2026-10-03');
    const dep = (await t.api('POST', '/receipts', { orderId: o.id, depositAmount: 10.7, method: 'cash' })).body;
    expect(dep.receipt_date).toBe('2026-10-03');
    const inv = (await t.api('POST', `/orders/${o.id}/invoice`)).body;
    expect(inv).toMatchObject({ issue_date: '2026-10-03', due_date: '2026-11-02' });
    const rc = (await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 1 }] })).body;
    expect(rc.receipt_date).toBe('2026-10-03');
  });

  it('02:00 on 1 Jan is already the new Thai year in document numbers', async () => {
    const tid = randomUUID();
    const tok = t.token(['*'], tid);
    setClock('2026-12-31T19:00:00Z');
    const c = cust();
    const o = await confirmedOrder(c, [goods(100)], tok);
    expect(o).toMatchObject({ no: 'SO-2570-0001', order_date: '2027-01-01' });
    const inv = (await t.api('POST', `/orders/${o.id}/invoice`, {}, { token: tok })).body;
    expect(inv).toMatchObject({ no: 'INV-2570-0001', issue_date: '2027-01-01' });
  });
});
