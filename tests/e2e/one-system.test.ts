import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definition as identity } from '@erp/svc-identity';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as hr } from '@erp/svc-hr';
import { definition as payroll } from '@erp/svc-payroll';
import { definition as expense } from '@erp/svc-expense';
import { definition as accounting } from '@erp/svc-accounting';
import { definition as sales } from '@erp/svc-sales';
import { definition as automation } from '@erp/svc-automation';
import { signToken } from '@erp/kernel';
import { TEST_JWT_SECRET } from '@erp/kernel/testing';
import { install, type Installation } from './helpers.ts';

/**
 * Wave 5 — "one system": an office customer with HR, Payroll, Expense, Accounting, Sales and Automation.
 * Every hand-off below travels only as an event through the gateway's router (no module calls another).
 */
let erp: Installation;
let token: string;
let tenantId: string;
beforeAll(async () => {
  erp = await install([identity, masterData, hr, payroll, expense, accounting, sales, automation]);
  ({ token, tenantId } = await erp.provision('one-co'));
});
afterAll(async () => { await erp?.close(); });

const api = (method: string, path: string, body?: unknown, tok = token) => erp.call(method, path, body, tok);
const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const journals = async (source: string) => (await api('GET', `/api/accounting/journals?source=${source}`)).body as any[];
const journal = async (id: string) => (await api('GET', `/api/accounting/journals/${id}`)).body;
const line = (j: any, code: string) => j.lines.find((l: any) => l.account_code === code);
const balanced = async () => (await api('GET', '/api/accounting/reports/trial-balance')).body.totals.difference;

describe('one system: sales → accounting, HR → payroll → accounting, expense → accounting, automation', () => {
  it('turns on the automation templates for paid payroll and customer payments', async () => {
    expect((await api('POST', '/api/automation/templates/payroll-paid/apply', {})).status).toBe(201);
    expect((await api('POST', '/api/automation/templates/payment-received/apply', {})).status).toBe(201);
  });

  it('invoice → receipt: AR booked and cleared, VAT on the issue date, journals balanced', async () => {
    const so = (await api('POST', '/api/sales/orders', { customerName: 'บริษัท ลูกค้าดี จำกัด', lines: [{ description: 'ค่าบริการติดตั้ง', qty: 1, unitPrice: 10000 }] })).body;
    await api('POST', `/api/sales/orders/${so.id}/confirm`);
    const inv = (await api('POST', `/api/sales/orders/${so.id}/invoice`, { issueDate: today })).body;
    expect(inv.gross).toBe(10700);
    const rc = await api('POST', '/api/sales/receipts', { method: 'transfer', whtPct: 3, lines: [{ invoiceId: inv.id, amount: 10700 }] });
    expect(rc.status).toBe(201);
    await erp.settle();

    const [ij] = await journals('sales.invoiced');
    const invJ = await journal(ij.id);
    expect(invJ).toMatchObject({ status: 'posted', entry_date: today, total_debit: 10700 });
    expect(line(invJ, '11300')).toMatchObject({ debit: 10700 });
    expect(line(invJ, '21200')).toMatchObject({ credit: 700, tax_base: 10000 });
    const rcJ = await journal((await journals('sales.payment_received'))[0].id);
    expect(line(rcJ, '11200')).toMatchObject({ debit: 10400 }); // 10,700 − 3% WHT on 10,000
    expect(line(rcJ, '11600')).toMatchObject({ debit: 300 });
    expect(line(rcJ, '11300')).toMatchObject({ credit: 10700 });
    expect((await api('GET', '/api/accounting/summary')).body.arBalance).toBe(0);
    expect(await balanced()).toBe(0);
    const bell = (await api('GET', '/api/automation/notifications')).body.items as any[];
    expect(bell.find((n) => n.title === 'ลูกค้าชำระเงินแล้ว แจ้งเซลส์/บัญชี')?.body).toContain('10,400');
  });

  it('employee created in HR → pay profile appears in Payroll (salary stays payroll\'s)', async () => {
    const emp = (await api('POST', '/api/hr/employees', { code: 'EMP-001', prefix: 'นางสาว', firstName: 'มาลี', lastName: 'ใจดี', startDate: '2026-01-05' })).body;
    expect(emp.id).toBeTruthy();
    await erp.settle();
    const profiles = (await api('GET', '/api/payroll/profiles')).body as any[];
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ employee_code: 'EMP-001', employee_name: 'นางสาวมาลี ใจดี', employee_id: emp.id, base_salary: 0 });
    expect((await api('PATCH', `/api/payroll/profiles/${profiles[0].id}`, { baseSalary: 30000 })).status).toBe(200);
    await api('PATCH', `/api/hr/employees/${emp.id}`, { lastName: 'ใจงาม' });
    await erp.settle();
    const p = (await api('GET', `/api/payroll/profiles/${profiles[0].id}`)).body;
    expect(p).toMatchObject({ employee_name: 'นางสาวมาลี ใจงาม', base_salary: 30000 });
  });

  it('payroll run paid → balanced salary journal in accounting + finance alert', async () => {
    const run = (await api('POST', '/api/payroll/runs', { period: today.slice(0, 7), payDate: today })).body;
    expect(run.lines).toHaveLength(1);
    expect((await api('POST', `/api/payroll/runs/${run.id}/calculate`)).status).toBe(200);
    expect((await api('POST', `/api/payroll/runs/${run.id}/approve`)).status).toBe(200);
    const paid = (await api('POST', `/api/payroll/runs/${run.id}/pay`, { paidDate: today })).body;
    expect(paid.status).toBe('paid');
    await erp.settle();
    const [pj] = await journals('payroll.run_paid');
    const j = await journal(pj.id);
    expect(j).toMatchObject({ status: 'posted', ref: run.no, entry_date: today });
    expect(j.total_debit).toBe(j.total_credit);
    expect(line(j, '52100')).toMatchObject({ debit: paid.salary });
    expect(line(j, '21400').credit).toBe(paid.sso_employee + paid.sso_employer);
    expect(line(j, '11200')).toMatchObject({ credit: paid.net });
    expect((await api('GET', '/api/accounting/posting-errors')).body).toHaveLength(0);
    expect(await balanced()).toBe(0);
    const bell = (await api('GET', '/api/automation/notifications')).body.items as any[];
    expect(bell.find((n) => n.title === 'จ่ายเงินเดือนแล้ว')?.body).toContain(run.no);
  });

  it('expense claim paid → expense by category + input VAT', async () => {
    const staff = signToken(TEST_JWT_SECRET, { tenantId, userId: randomUUID(), userName: 'สมชาย', perms: ['expense.claim.read', 'expense.claim.write'] });
    const fuel = (await api('POST', '/api/expense/categories', { code: 'FUEL', name: 'ค่าน้ำมัน' })).body;
    const cl = (await api('POST', '/api/expense/claims', { purpose: 'ไปหาลูกค้า', submit: true,
      lines: [{ expenseDate: today, categoryId: fuel.id, amount: 1000, vat: 70, receiptNo: 'PTT-1', vendorName: 'ปตท.', vendorTaxId: '0107544000108' }] }, staff)).body; // full tax invoice → creditable
    expect((await api('POST', `/api/expense/claims/${cl.id}/approve`, {})).status).toBe(200);
    // wave 8 segregation of duties: the approver (admin) may not record the payment — finance does
    const cashier = signToken(TEST_JWT_SECRET, { tenantId, userId: randomUUID(), userName: 'การเงิน', perms: ['expense.claim.read', 'expense.claim.pay'] });
    expect((await api('POST', `/api/expense/claims/${cl.id}/pay`, { method: 'transfer', paidDate: today }, cashier)).status).toBe(200);
    await erp.settle();
    const j = await journal((await journals('expense.claim_paid'))[0].id);
    expect(line(j, '52520')).toMatchObject({ debit: 1000 }); // ค่าน้ำมันเชื้อเพลิง (default category map)
    expect(line(j, '11500')).toMatchObject({ debit: 70 });
    expect(line(j, '11200')).toMatchObject({ credit: 1070 });
    expect(await balanced()).toBe(0);
  });
});
