import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition, { PROMPTPAY_ID: '0105536000313' }); });
afterAll(async () => { await t?.close(); });

const svc = { description: 'ค่าบริการติดตั้ง', qty: 1 };
const custA = { customerId: randomUUID(), customerName: 'บริษัท ชลบุรีพลาสติก จำกัด' };
const custB = { customerId: randomUUID(), customerName: 'บริษัท ระยองเมทัล จำกัด' };

/** confirmed + invoiced service order of `net` baht (VAT exclusive) */
async function invoice(cust: { customerId: string | null; customerName: string }, net: number, issueDate = '2026-10-01', extra: Record<string, unknown> = {}, token?: string) {
  const o = (await t.api('POST', '/orders', { ...cust, creditDays: 30, lines: [{ ...svc, unitPrice: net }], ...extra }, { token })).body;
  await t.api('POST', `/orders/${o.id}/confirm`, undefined, { token });
  const inv = await t.api('POST', `/orders/${o.id}/invoice`, { issueDate }, { token });
  expect(inv.status).toBe(201);
  return { order: o, inv: inv.body };
}

describe('sales receivables — invoices', () => {
  it('due date = issue date + order credit days (or given), status outstanding', async () => {
    const { inv } = await invoice(custA, 1000, '2026-10-01');
    expect(inv).toMatchObject({ due_date: '2026-10-31', dueDateTh: '31 ตุลาคม 2569', paid_amount: 0, outstanding: 1070, payment_status: 'outstanding', receipts: [] });
    const o = (await t.api('POST', '/orders', { ...custA, lines: [{ ...svc, unitPrice: 10 }] })).body;
    await t.api('POST', `/orders/${o.id}/confirm`);
    expect((await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-10-01', dueDate: '2026-09-01' })).status).toBe(400);
    expect((await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-10-01', dueDate: '2026-11-15' })).body.due_date).toBe('2026-11-15');
    expect((await t.published('sales.invoiced')).at(-1)!.data).toMatchObject({ customerName: custA.customerName, dueDate: '2026-11-15' });
  });
});

describe('sales receivables — receipts', () => {
  it('partial payments move an invoice outstanding → partially_paid → paid; over-payment is 400', async () => {
    const { inv } = await invoice(custA, 1000);
    const r1 = await t.api('POST', '/receipts', { method: 'transfer', reference: 'KBANK 123', receiptDate: '2026-10-02', lines: [{ invoiceId: inv.id, amount: 500 }] });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({
      no: 'RC-2569-0001', kind: 'payment', title: 'ใบเสร็จรับเงิน', total: 500, wht_amount: 0, received: 500, method: 'transfer', methodLabel: 'โอนเงิน',
      customer: { name: custA.customerName, id: custA.customerId }, receiptDateTh: '2 ตุลาคม 2569', amountText: 'ห้าร้อยบาทถ้วน',
      lines: [{ invoice_no: inv.no, amount: 500 }],
    });
    expect((await t.api('GET', `/invoices/${inv.id}`)).body).toMatchObject({ payment_status: 'partially_paid', paid_amount: 500, outstanding: 570, receipts: [{ no: 'RC-2569-0001', amount: 500 }] });
    const over = await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 570.01 }] });
    expect(over.status).toBe(400);
    expect(over.body.error.message).toContain('เกินยอดค้าง 570.00');
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 570 }] })).body.received).toBe(570);
    const paid = (await t.api('GET', `/invoices/${inv.id}`)).body;
    expect(paid).toMatchObject({ payment_status: 'paid', outstanding: 0, promptPay: null });
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 1 }] })).status).toBe(400);
  });

  it('withholding tax is computed on the pre-VAT part of what is settled', async () => {
    const a = await invoice(custA, 10000); // gross 10,700
    const b = await invoice(custA, 2500); // gross 2,675
    const r = (await t.api('POST', '/receipts', { method: 'cheque', reference: 'BBL 0001234', whtPct: 3, lines: [{ invoiceId: a.inv.id, amount: 10700 }, { invoiceId: b.inv.id, amount: 1070 }] })).body;
    // base = 10,000 + 1,000 (1,070 × 2,500/2,675) = 11,000 → WHT 3% = 330 → received 11,770 − 330 = 11,440
    expect(r).toMatchObject({ total: 11770, wht_pct: 3, wht_amount: 330, received: 11440, receivedText: 'หนึ่งหมื่นหนึ่งพันสี่ร้อยสี่สิบบาทถ้วน' });
    expect(r.lines.map((l: any) => l.wht_base)).toEqual([10000, 1000]);
    expect((await t.api('GET', `/invoices/${b.inv.id}`)).body).toMatchObject({ payment_status: 'partially_paid', outstanding: 1605 });
    expect((await t.api('POST', '/receipts', { method: 'cash', whtPct: 4, lines: [{ invoiceId: b.inv.id, amount: 1 }] })).status).toBe(400);
    expect((await t.api('POST', '/receipts', { method: 'cash', whtPct: '3', lines: [{ invoiceId: b.inv.id, amount: 107 }] })).body.wht_amount).toBe(3);
  });

  it('rejects mixed customers, duplicate invoices, missing lines and unknown invoices', async () => {
    const a = await invoice(custA, 100);
    const b = await invoice(custB, 100);
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: a.inv.id, amount: 10 }, { invoiceId: b.inv.id, amount: 10 }] })).status).toBe(400);
    expect((await t.api('POST', '/receipts', { ...custB, method: 'cash', lines: [{ invoiceId: a.inv.id, amount: 10 }] })).status).toBe(400);
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: a.inv.id, amount: 10 }, { invoiceId: a.inv.id, amount: 10 }] })).status).toBe(400);
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [] })).status).toBe(400);
    expect((await t.api('POST', '/receipts', { method: 'bitcoin', lines: [{ invoiceId: a.inv.id, amount: 10 }] })).status).toBe(400);
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: randomUUID(), amount: 10 }] })).status).toBe(404);
  });

  it('deposits (มัดจำ) are received without an invoice and applied to invoices later', async () => {
    const o = (await t.api('POST', '/orders', { ...custB, creditDays: 0, lines: [{ ...svc, unitPrice: 20000 }] })).body; // gross 21,400
    const dep = await t.api('POST', '/receipts', { orderId: o.id, depositAmount: 10700, method: 'transfer' });
    expect(dep.status).toBe(201);
    expect(dep.body).toMatchObject({ kind: 'deposit', title: 'ใบรับเงินมัดจำ', total: 10700, received: 10700, deposit_remaining: 10700, orderNo: o.no, customer: { name: custB.customerName } });
    expect((await t.api('GET', `/orders/${o.id}`)).body.deposits).toMatchObject([{ no: dep.body.no, deposit_remaining: 10700 }]);
    expect((await t.api('GET', '/receipts?kind=deposit&open=1')).body.map((r: any) => r.no)).toEqual([dep.body.no]);
    expect((await t.api('POST', '/receipts', { depositAmount: 100, method: 'cash' })).status).toBe(400); // no customer
    expect((await t.api('POST', '/receipts', { ...custB, depositAmount: 100, method: 'cash', whtPct: 3 })).status).toBe(400);

    await t.api('POST', `/orders/${o.id}/confirm`);
    const inv = (await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-10-02' })).body;
    // deposit is someone else's → 400; more than remaining → 400
    const other = (await t.api('POST', '/receipts', { ...custA, depositAmount: 50, method: 'cash' })).body;
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 21400 }], deposits: [{ depositId: other.id, amount: 50 }] })).status).toBe(400);
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 21400 }], deposits: [{ depositId: dep.body.id, amount: 10700.01 }] })).status).toBe(400);
    // deposit larger than what is due after WHT → 400
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 5000 }], deposits: [{ depositId: dep.body.id, amount: 6000 }] })).status).toBe(400);

    const r = (await t.api('POST', '/receipts', { method: 'transfer', whtPct: 3, lines: [{ invoiceId: inv.id, amount: 21400 }], deposits: [{ depositId: dep.body.id, amount: 10700 }] })).body;
    // WHT 3% of 20,000 = 600 → cash now = 21,400 − 600 − 10,700 = 10,100
    expect(r).toMatchObject({ total: 21400, wht_amount: 600, deposit_applied: 10700, received: 10100, deposits: [{ deposit_no: dep.body.no, amount: 10700 }] });
    expect((await t.api('GET', `/receipts/${dep.body.id}`)).body.deposit_remaining).toBe(0);
    expect((await t.api('GET', `/invoices/${inv.id}`)).body.payment_status).toBe('paid');
    expect((await t.api('GET', '/receipts?kind=deposit&open=1')).body.map((x: any) => x.no)).toEqual([other.no]);

    const ev = (await t.published('sales.payment_received')).at(-1)!.data;
    expect(ev).toMatchObject({ receiptNo: r.no, kind: 'payment', customerName: custB.customerName, total: 21400, whtAmount: 600, depositApplied: 10700, received: 10100,
      invoices: [{ invoiceId: inv.id, invoiceNo: inv.no, amount: 21400, outstanding: 0 }] });
    expect((await t.published('sales.payment_received')).find((e) => e.data.receiptId === dep.body.id)!.data).toMatchObject({ kind: 'deposit', received: 10700, invoices: [] });
  });
});

describe('sales receivables — reports, permissions, tenants', () => {
  it('aging buckets by days past due as of a date; receivables by customer with deposits', async () => {
    const tid = randomUUID();
    const tok = t.token(['*'], tid);
    const c1 = { customerId: randomUUID(), customerName: 'ลูกค้าหนึ่ง' };
    const c2 = { customerId: null, customerName: 'ลูกค้าสอง (ไม่มีรหัส)' };
    // credit 30 days → due = issue + 30; asOf 2026-10-02
    await invoice(c1, 100, '2026-09-15', {}, tok); // due 10-15 → current
    await invoice(c1, 200, '2026-08-20', {}, tok); // due 09-19 → 13 days → 1–30
    await invoice(c1, 300, '2026-07-20', {}, tok); // due 08-19 → 44 days → 31–60
    await invoice(c2, 400, '2026-06-25', {}, tok); // due 07-25 → 69 days → 61–90
    await invoice(c2, 500, '2026-05-01', {}, tok); // due 05-31 → 124 days → >90
    await invoice(c2, 1, '2026-08-03', {}, tok); //  due 09-02 → 30 days → 1–30 (edge)
    await t.api('POST', '/receipts', { ...c2, depositAmount: 50, method: 'cash' }, { token: tok });
    const aging = (await t.api('GET', '/receivables/aging?asOf=2026-10-02', undefined, { token: tok })).body;
    expect(aging.totals).toEqual({ current: 107, d1_30: 215.07, d31_60: 321, d61_90: 428, over_90: 535, total: 1606.07 });
    expect(aging.rows[0]).toMatchObject({ customer_name: c2.customerName, customer_id: null, d1_30: 1.07, d61_90: 428, over_90: 535, total: 964.07 });
    expect(aging.rows[1]).toMatchObject({ customer_id: c1.customerId, current: 107, d1_30: 214, d31_60: 321, total: 642 });
    const ar = (await t.api('GET', '/receivables?asOf=2026-10-02', undefined, { token: tok })).body;
    expect(ar.totals).toEqual({ outstanding: 1606.07, overdue: 1499.07, deposits: 50, customers: 2 });
    expect(ar.rows.find((r: any) => r.customer_name === c2.customerName)).toMatchObject({ invoices: 3, outstanding: 964.07, overdue: 964.07, deposits: 50, net_outstanding: 914.07, max_days_overdue: 124, oldest_due: '2026-05-31' });
    // the same invoices are overdue "today" too
    const overdueList = (await t.api('GET', '/invoices?overdue=1', undefined, { token: tok })).body;
    expect(overdueList.length).toBeGreaterThanOrEqual(5);
    expect(overdueList[0]).toMatchObject({ customer_name: c2.customerName, payment_status: 'outstanding' });
    expect(overdueList[0].days_overdue).toBeGreaterThan(90);
    const s = (await t.api('GET', '/summary', undefined, { token: tok })).body;
    expect(s).toMatchObject({ outstanding: 1606.07, unappliedDeposits: 50 });
    expect(s.overdue).toBeGreaterThanOrEqual(1499.07);
  });

  it('needs sales.receipt.write / sales.receivable.read', async () => {
    const { inv } = await invoice(custA, 100);
    const clerk = t.token(['sales.order.read']);
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 1 }] }, { token: clerk })).status).toBe(403);
    for (const url of ['/receipts', '/receivables', '/receivables/aging']) expect((await t.api('GET', url, undefined, { token: clerk })).status).toBe(403);
    const cashier = t.token(['sales.receipt.write', 'sales.receivable.read'], t.tenantId, { userName: 'คุณบัญชี' });
    const r = await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 1 }] }, { token: cashier });
    expect(r.status).toBe(201);
    expect(r.body.created_by_name).toBe('คุณบัญชี');
    expect((await t.api('GET', '/receivables', undefined, { token: cashier })).status).toBe(200);
    expect((await t.api('GET', '/summary', undefined, { token: cashier })).status).toBe(200); // AR dashboard card
    expect((await t.api('GET', '/summary', undefined, { token: t.token(['sales.receipt.write']) })).status).toBe(403);
  });

  it('form shorthand applyDepositId uses as much of the deposit as is due', async () => {
    const dep = (await t.api('POST', '/receipts', { ...custA, depositAmount: 5000, method: 'cash' })).body;
    const { inv } = await invoice(custA, 1000); // 1,070
    const r = (await t.api('POST', '/receipts', { method: 'cash', whtPct: '3', applyDepositId: dep.id, lines: [{ invoiceId: inv.id, amount: 1070 }] })).body;
    expect(r).toMatchObject({ total: 1070, wht_amount: 30, deposit_applied: 1040, received: 0 });
    expect((await t.api('GET', `/receipts/${dep.id}`)).body.deposit_remaining).toBe(3960);
  });

  it('keeps receipts and receivables per tenant', async () => {
    const { inv } = await invoice(custA, 100);
    const rc = (await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 10 }] })).body;
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('GET', '/receipts', undefined, { token: other })).body).toEqual([]);
    expect((await t.api('GET', `/receipts/${rc.id}`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 1 }] }, { token: other })).status).toBe(404);
    expect((await t.api('GET', '/receivables', undefined, { token: other })).body).toMatchObject({ rows: [], totals: { outstanding: 0 } });
    expect((await t.api('GET', '/receivables/aging', undefined, { token: other })).body.rows).toEqual([]);
    expect((await t.api('GET', '/invoices', undefined, { token: other })).body).toEqual([]);
    // numbering is per tenant
    const o = (await t.api('POST', '/orders', { ...custA, lines: [{ ...svc, unitPrice: 5 }] }, { token: other })).body;
    expect((await t.api('POST', '/receipts', { orderId: o.id, depositAmount: 5, method: 'cash' }, { token: other })).body.no).toBe('RC-2569-0001');
  });
});
