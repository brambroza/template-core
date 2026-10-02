import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const HR_PERMS = ['payroll.profile.read', 'payroll.profile.write', 'payroll.run.read', 'payroll.run.write'];
const somchaiId = randomUUID();
const malee = randomUUID();
const tok = {
  hr: () => t.token(HR_PERMS, t.tenantId, { userName: 'ฝ่ายบุคคล' }),
  owner: () => t.token([...HR_PERMS, 'payroll.run.approve', 'payroll.run.pay', 'payroll.setup.write'], t.tenantId, { userName: 'เจ้าของ' }),
  somchai: () => t.token(['payroll.payslip.self', 'hr.leave.request'], t.tenantId, { userId: somchaiId }),
  malee: () => t.token(['payroll.payslip.self'], t.tenantId, { userId: malee }),
};
const as = (who: keyof typeof tok) => ({ token: tok[who]() });

let emp1: any;
let emp2: any;
let loan: any;
let run: any;
let line1: any;

describe('payroll settings', () => {
  it('starts from the legal defaults and validates changes', async () => {
    const s = await t.api('GET', '/settings', undefined, as('hr'));
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ ssoEmployeeRate: 5, ssoWageMin: 1650, ssoWageMax: 15000, ssoMaxContribution: 750, personalAllowance: 60000, expenseRatePct: 50, daysPerMonth: 30 });
    expect(s.body.brackets).toHaveLength(8);
    expect((await t.api('PUT', '/settings', { ssoWageMax: 15000 }, as('hr'))).status).toBe(403);
    expect((await t.api('PUT', '/settings', { ssoWageMin: 20000 }, as('owner'))).status).toBe(400);
    expect((await t.api('PUT', '/settings', { brackets: [{ upTo: 100, rate: 0 }] }, as('owner'))).status).toBe(400);
    const ok = await t.api('PUT', '/settings', { ssoEmployerAccount: '1000123456', ssoBranch: '000000' }, as('owner'));
    expect(ok.status).toBe(200);
    expect((await t.api('GET', '/settings', undefined, as('hr'))).body).toMatchObject({ ssoEmployerAccount: '1000123456', ssoWageMax: 15000 });
    expect((await t.api('GET', '/settings', undefined, as('somchai'))).status).toBe(403);
  });
});

describe('pay profiles', () => {
  it('creates profiles keeping only the last 4 digits of the bank account', async () => {
    const r = await t.api('POST', '/profiles', {
      employeeCode: 'EMP-001', employeeName: 'นายสมชาย ใจดี', department: 'ผลิต', userId: somchaiId, userName: 'สมชาย',
      baseSalary: 30000, startDate: '2020-01-01', bankName: 'กสิกรไทย', bankAccount: '123-4-56789-0',
      openingYear: 2026, openingIncome: 270000, openingTax: 1537.47, openingSso: 6750,
    }, as('hr'));
    expect(r.status).toBe(201);
    emp1 = r.body;
    expect(emp1).toMatchObject({ employee_code: 'EMP-001', pay_type: 'monthly', base_salary: 30000, bank_account_last4: '7890', sso_enrolled: true, items: [] });
    expect(JSON.stringify(emp1)).not.toContain('1234567890');
    emp2 = (await t.api('POST', '/profiles', {
      employeeCode: 'EMP-002', employeeName: 'นางสาวมาลี สวย', baseSalary: 31000, startDate: '2026-10-16', userId: malee, pvdEmployeePct: 3, pvdEmployerPct: 3,
    }, as('hr'))).body;
    expect(emp2.pvd_employee_pct).toBe(3);
  });

  it('validates pay rules, codes and linked users', async () => {
    expect((await t.api('POST', '/profiles', { employeeCode: 'X1', employeeName: 'x', payType: 'monthly' }, as('hr'))).status).toBe(400);
    expect((await t.api('POST', '/profiles', { employeeCode: 'X1', employeeName: 'x', payType: 'daily', baseSalary: 1 }, as('hr'))).status).toBe(400);
    const pvd = await t.api('POST', '/profiles', { employeeCode: 'X1', employeeName: 'x', baseSalary: 10000, pvdEmployeePct: 5, pvdEmployerPct: 3 }, as('hr'));
    expect(pvd.status).toBe(400);
    expect(pvd.body.error.details.fieldErrors.pvdEmployerPct).toBeTruthy();
    expect((await t.api('POST', '/profiles', { employeeCode: 'X1', employeeName: 'x', baseSalary: 10000, pvdEmployeePct: 20 }, as('hr'))).status).toBe(400);
    expect((await t.api('POST', '/profiles', { employeeCode: 'X1', employeeName: 'x', baseSalary: 10000, bankAccount: '12' }, as('hr'))).status).toBe(400);
    expect((await t.api('POST', '/profiles', { employeeCode: 'emp-001', employeeName: 'ซ้ำ', baseSalary: 1 }, as('hr'))).status).toBe(409);
    expect((await t.api('POST', '/profiles', { employeeCode: 'X2', employeeName: 'x', baseSalary: 1, userId: somchaiId }, as('hr'))).status).toBe(409);
    expect((await t.api('PATCH', `/profiles/${emp2.id}`, { endDate: '2026-01-01' }, as('hr'))).status).toBe(400);
    const p = await t.api('PATCH', `/profiles/${emp2.id}`, { position: 'บัญชี', bankName: 'กรุงเทพ', bankAccount: '9876543210' }, as('hr'));
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ position: 'บัญชี', bank_account_last4: '3210' });
  });

  it('keeps salaries away from staff without payroll permissions', async () => {
    expect((await t.api('GET', '/profiles', undefined, as('somchai'))).status).toBe(403);
    expect((await t.api('GET', `/profiles/${emp1.id}`, undefined, as('somchai'))).status).toBe(403);
    expect((await t.api('POST', '/profiles', { employeeCode: 'Z', employeeName: 'z', baseSalary: 1 }, as('somchai'))).status).toBe(403);
    expect((await t.api('GET', '/profiles?q=สมชาย', undefined, as('hr'))).body).toHaveLength(1);
  });

  it('adds recurring allowances and loans', async () => {
    const a = await t.api('POST', `/profiles/${emp2.id}/items`, { kind: 'earning', code: 'POS', name: 'ค่าตำแหน่ง', amount: 3100, sso: true }, as('hr'));
    expect(a.status).toBe(201);
    expect(a.body.items).toHaveLength(1);
    expect((await t.api('POST', `/profiles/${emp2.id}/items`, { kind: 'earning', code: 'X', name: 'x', amount: 1, balance: 5 }, as('hr'))).status).toBe(400);
    const l = await t.api('POST', `/profiles/${emp1.id}/items`, { kind: 'deduction', code: 'LOAN', name: 'เงินกู้สหกรณ์', amount: 1000, balance: 1500 }, as('hr'));
    loan = l.body.items[0];
    expect(loan).toMatchObject({ kind: 'deduction', balance: 1500, taxable: false });
    expect((await t.api('GET', '/items?kind=deduction', undefined, as('hr'))).body).toHaveLength(1);
    expect((await t.api('PATCH', `/items/${loan.id}`, { note: 'สัญญา 2569/01' }, as('hr'))).body.note).toBe('สัญญา 2569/01');
    expect((await t.api('POST', `/profiles/${emp1.id}/items`, { kind: 'earning', code: 'Y', name: 'y', amount: 1 }, as('somchai'))).status).toBe(403);
  });

  it('imports profiles from a spreadsheet (dry run, row errors, upsert by code)', async () => {
    const rows = [
      { employeeCode: 'EMP-003', employeeName: 'นายแดง ขยัน', payType: 'รายวัน', dailyWage: '400', startDate: '01/06/2569', bankName: 'ออมสิน', bankAccount: '020-1-1122-3344', ssoEnrolled: 'ใช่' },
      { employeeCode: 'EMP-001', department: 'ซ่อมบำรุง' },
      { employeeCode: 'EMP-009', employeeName: '', baseSalary: '10,000' },
      { employeeCode: 'EMP-010', employeeName: 'x', payType: 'รายชั่วโมง', baseSalary: '1' },
    ];
    const dry = await t.api('POST', '/profiles/import', { rows, dryRun: true }, as('hr'));
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, total: 4, created: 1, updated: 1 });
    expect(dry.body.errors.map((e: any) => e.row)).toEqual([3, 4]);
    expect((await t.api('POST', '/profiles/import', { rows }, as('hr'))).status).toBe(400);
    const real = await t.api('POST', '/profiles/import', { rows: rows.slice(0, 2) }, as('hr'));
    expect(real.body).toMatchObject({ created: 1, updated: 1, errors: [] });
    const all = (await t.api('GET', '/profiles', undefined, as('hr'))).body;
    expect(all.map((p: any) => [p.employee_code, p.department, p.pay_type, p.bank_account_last4])).toEqual([
      ['EMP-001', 'ซ่อมบำรุง', 'monthly', '7890'], ['EMP-002', null, 'monthly', '3210'], ['EMP-003', null, 'daily', '3344'],
    ]);
    expect(all.find((p: any) => p.employee_code === 'EMP-003').start_date).toBe('2026-06-01');
    expect((await t.api('POST', '/profiles/import', { rows }, as('somchai'))).status).toBe(403);
  });
});

describe('payroll run', () => {
  it('creates PR-2569-10 with a line per employee employed in the month', async () => {
    expect((await t.api('POST', '/runs', { period: '2026-13', payDate: '2026-10-31' }, as('hr'))).status).toBe(400);
    const r = await t.api('POST', '/runs', { period: '2026-10', payDate: '2026-10-31', note: 'รอบปกติ' }, as('hr'));
    expect(r.status).toBe(201);
    run = r.body;
    expect(run).toMatchObject({ no: 'PR-2569-10', status: 'draft', headcount: 3, created_by_name: 'ฝ่ายบุคคล', period_label: 'ตุลาคม 2569' });
    expect((await t.api('POST', '/runs', { period: '2026-10', payDate: '2026-10-31' }, as('hr'))).status).toBe(409);
    line1 = run.lines.find((l: any) => l.employee_code === 'EMP-001');
  });

  it('takes monthly inputs by hand and from a file', async () => {
    const r = await t.api('PUT', `/payslips/${line1.id}/inputs`, { ot15Hours: 10 }, as('hr'));
    expect(r.status).toBe(200);
    expect(r.body.ot15_hours).toBe(10);
    expect((await t.api('PUT', `/payslips/${line1.id}/inputs`, { ot15Hours: -1 }, as('hr'))).status).toBe(400);
    const rows = [
      { period: '2026-10', employeeCode: 'EMP-003', workDays: '20', ot15Hours: '4' },
      { period: '2026-10', employeeCode: 'EMP-404', workDays: '1' },
      { period: '2026-11', employeeCode: 'EMP-001', bonus: '1' },
      { period: '2026-10', employeeCode: 'EMP-003', workDays: 'abc' },
    ];
    const dry = await t.api('POST', '/inputs/import', { rows, dryRun: true }, as('hr'));
    expect(dry.body.errors.map((e: any) => [e.row, e.field])).toEqual([[2, 'employeeCode'], [3, 'period'], [4, 'employeeCode']]);
    const ok = await t.api('POST', '/inputs/import', { rows: rows.slice(0, 1) }, as('hr'));
    expect(ok.body).toMatchObject({ updated: 1, errors: [] });
  });

  it('calculates SSO, PND1 withholding, OT, pro-rata, allowances and loans', async () => {
    const r = await t.api('POST', `/runs/${run.id}/calculate`, undefined, as('hr'));
    expect(r.status).toBe(200);
    run = r.body;
    expect(run.status).toBe('calculated');
    const byCode = Object.fromEntries(run.lines.map((l: any) => [l.employee_code, l]));
    // EMP-001: 30,000 + OT 10h × 125 × 1.5; opening Jan–Sep from the old system → annualised tax 170.84 + OT at the marginal rate 93.75
    expect(byCode['EMP-001']).toMatchObject({ salary: 30000, overtime: 1875, gross: 31875, sso_employee: 750, sso_employer: 750, wht: 264.59, loans: 1000 });
    expect(byCode['EMP-001'].net).toBe(31875 - 750 - 264.59 - 1000);
    // EMP-002 joined 16 Oct: 16/31 of 31,000 + 16/31 of the 3,100 allowance; PVD 3% on the salary earned
    expect(byCode['EMP-002']).toMatchObject({ employed_days: 16, salary: 16000, allowances: 1600, sso_wage: 17600, sso_employee: 750, pvd_employee: 480, pvd_employer: 480, wht: 0 });
    // EMP-003 daily 400 × 20 days, OT 4h × 50 × 1.5
    expect(byCode['EMP-003']).toMatchObject({ work_days: 20, salary: 8000, overtime: 300, sso_employee: 400 });
    expect(run.headcount).toBe(3);
    expect(run.sso_employee).toBe(1900);
    expect(run.net).toBeCloseTo(run.gross - run.total_deductions, 2);
    // editing a calculated run recalculates it
    const again = await t.api('PUT', `/payslips/${byCode['EMP-003'].id}/inputs`, { unpaidLeaveDays: 1, workDays: 21 }, as('hr'));
    expect(again.body).toMatchObject({ salary: 8400, unpaid_leave: 0 });
    expect(again.body.warning_text).toContain('รายวัน');
  });

  it('shows a payslip with earnings, deductions and year-to-date', async () => {
    const s = await t.api('GET', `/payslips/${line1.id}`, undefined, as('hr'));
    expect(s.status).toBe(200);
    expect(s.body.earnings.map((e: any) => e.code)).toEqual(['SALARY', 'OT']);
    expect(s.body.deductions.map((e: any) => [e.code, e.amount])).toEqual([['SSO', 750], ['WHT', 264.59], ['LOAN', 1000]]);
    expect(s.body).toMatchObject({ ytd_income: 270000, ytd_tax: 1537.47, heading: 'EMP-001 ตุลาคม 2569', bank_text: 'กสิกรไทย ลงท้าย 7890' });
    expect(s.body.net_text).toContain('บาท');
    expect((await t.api('GET', '/payslips?period=2026-10&q=EMP-00', undefined, as('hr'))).body).toHaveLength(3);
  });

  it('enforces approval permission and the state machine', async () => {
    expect((await t.api('POST', `/runs/${run.id}/approve`, {}, as('hr'))).status).toBe(403);
    expect((await t.api('POST', `/runs/${run.id}/pay`, {}, as('owner'))).status).toBe(409);
    const ok = await t.api('POST', `/runs/${run.id}/approve`, {}, as('owner'));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'approved', approved_by_name: 'เจ้าของ' });
    expect((await t.api('POST', `/runs/${run.id}/approve`, {}, as('owner'))).status).toBe(409);
    expect((await t.api('POST', `/runs/${run.id}/calculate`, undefined, as('hr'))).status).toBe(409);
    expect((await t.api('POST', `/runs/${run.id}/cancel`, {}, as('hr'))).status).toBe(409);
    expect((await t.api('PUT', `/payslips/${line1.id}/inputs`, { bonus: 1 }, as('hr'))).status).toBe(409);
    expect((await t.api('POST', '/inputs/import', { rows: [{ period: '2026-10', employeeCode: 'EMP-001', bonus: '1' }], dryRun: true }, as('hr'))).body.errors).toHaveLength(1);
    // reopen and approve again
    expect((await t.api('POST', `/runs/${run.id}/reopen`, {}, as('owner'))).body.status).toBe('calculated');
    expect((await t.api('POST', `/runs/${run.id}/approve`, {}, as('owner'))).body.status).toBe('approved');
  });

  it('produces the bank transfer list, SSO 1-10 data and the PND1 summary', async () => {
    const bank = await t.api('GET', `/runs/${run.id}/bank-transfer`, undefined, as('hr'));
    expect(bank.body.rows).toHaveLength(3);
    expect(bank.body.rows.map((r: any) => r.bank_account_last4).sort()).toEqual(['3210', '3344', '7890']);
    expect(bank.body.banks.reduce((s: number, b: any) => s + b.total, 0)).toBeCloseTo(bank.body.total, 2);
    const sso = await t.api('GET', `/runs/${run.id}/sso`, undefined, as('hr'));
    expect(sso.body).toMatchObject({ employer_account: '1000123456', insured: 3, employee_total: 1900 + 20, employer_total: 1920, total: 3840 });
    expect(sso.body.rows.find((r: any) => r.employee_code === 'EMP-002').wage).toBe(15000);
    const pnd = await t.api('GET', `/runs/${run.id}/pnd1`, undefined, as('hr'));
    expect(pnd.body.people).toBe(3);
    expect(pnd.body.total_tax).toBe(264.59);
    expect((await t.api('GET', `/runs/${run.id}/pnd1?withheldOnly=1`, undefined, as('hr'))).body.people).toBe(1);
    expect((await t.api('GET', `/runs/${run.id}/sso`, undefined, as('somchai'))).status).toBe(403);
  });

  it('pays the run: publishes balanced accounting totals and reduces loan balances', async () => {
    expect((await t.api('GET', '/my-payslips', undefined, as('somchai'))).body).toEqual([]);
    expect((await t.api('POST', `/runs/${run.id}/pay`, {}, as('hr'))).status).toBe(403);
    const paid = await t.api('POST', `/runs/${run.id}/pay`, { paidDate: '2026-10-31', reference: 'KBANK-BULK-1031' }, as('owner'));
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ status: 'paid', pay_reference: 'KBANK-BULK-1031' });
    const [ev] = await t.published('payroll.run_paid');
    expect(ev.data).toMatchObject({ runId: run.id, no: 'PR-2569-10', period: '2026-10', paidDate: '2026-10-31', headcount: 3 });
    expect(ev.data.totals.wht).toBe(264.59);
    const sum = (side: string) => Math.round(ev.data.postings.filter((p: any) => p.side === side).reduce((s: number, p: any) => s + p.amount, 0) * 100) / 100;
    expect(sum('debit')).toBe(sum('credit'));
    expect(JSON.stringify(ev.data)).not.toContain('EMP-001');
    const items = (await t.api('GET', `/items?profileId=${emp1.id}`, undefined, as('hr'))).body;
    expect(items[0]).toMatchObject({ balance: 500, active: true });
    expect((await t.api('POST', `/runs/${run.id}/pay`, {}, as('owner'))).status).toBe(409);
  });

  it('lets employees see only their own paid payslips', async () => {
    const mine = await t.api('GET', '/my-payslips', undefined, as('somchai'));
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ employee_code: 'EMP-001', run_no: 'PR-2569-10' });
    const slip = await t.api('GET', `/my-payslips/${mine.body[0].id}`, undefined, as('somchai'));
    expect(slip.status).toBe(200);
    expect(slip.body).toMatchObject({ employee_code: 'EMP-001', run_status: 'paid', ytd_tax: 1802.06 });
    // another employee cannot open it, and staff cannot use the HR endpoints
    expect((await t.api('GET', `/my-payslips/${mine.body[0].id}`, undefined, as('malee'))).status).toBe(404);
    expect((await t.api('GET', `/payslips/${mine.body[0].id}`, undefined, as('somchai'))).status).toBe(403);
    expect((await t.api('GET', '/payslips', undefined, as('somchai'))).status).toBe(403);
    expect((await t.api('GET', '/runs', undefined, as('somchai'))).status).toBe(403);
    expect((await t.api('GET', '/my-payslips', undefined, as('malee'))).body.map((x: any) => x.employee_code)).toEqual(['EMP-002']);
    expect((await t.api('GET', '/my-payslips', undefined, as('hr'))).status).toBe(403);
  });

  it('carries year-to-date into the next month and stops a loan at its balance', async () => {
    const nov = (await t.api('POST', '/runs', { period: '2026-11', payDate: '2026-11-30' }, as('hr'))).body;
    expect(nov.no).toBe('PR-2569-11');
    const calc = (await t.api('POST', `/runs/${nov.id}/calculate`, undefined, as('hr'))).body;
    const l1 = calc.lines.find((l: any) => l.employee_code === 'EMP-001');
    expect(l1.loans).toBe(500);
    // Jan–Oct withheld 1,802.06 on 301,875; remaining Nov–Dec at 30,000: tax(331,875+60,000 … ) spread over 2 periods
    expect(l1.tax_detail.remainingPeriods).toBe(2);
    expect(l1.wht).toBeGreaterThan(0);
    await t.api('POST', `/runs/${nov.id}/approve`, {}, as('owner'));
    await t.api('POST', `/runs/${nov.id}/pay`, {}, as('owner'));
    const items = (await t.api('GET', `/items?profileId=${emp1.id}`, undefined, as('hr'))).body;
    expect(items[0]).toMatchObject({ balance: 0, active: false });
    // October can no longer be reopened… it is paid; a cancelled run frees its month and gets a new number
    const dec = (await t.api('POST', '/runs', { period: '2026-12', payDate: '2026-12-25' }, as('hr'))).body;
    expect((await t.api('POST', `/runs/${dec.id}/cancel`, { note: 'วันจ่ายผิด' }, as('hr'))).body.status).toBe('cancelled');
    expect((await t.api('POST', '/runs', { period: '2026-12', payDate: '2026-12-24' }, as('hr'))).body.no).toBe('PR-2569-12-2');
    expect((await t.api('GET', '/runs?status=cancelled', undefined, as('hr'))).body).toHaveLength(1);
  });

  it('issues annual 50 Tawi certificates per employee', async () => {
    const list = await t.api('GET', '/certificates?year=2569', undefined, as('hr'));
    const c1 = list.body.find((c: any) => c.employee_code === 'EMP-001');
    expect(c1).toMatchObject({ year: 2026, year_be: 2569, months: 2 });
    expect(c1.income).toBeGreaterThan(330000);
    const own = await t.api('GET', `/certificates/${c1.id}`, undefined, as('somchai'));
    expect(own.status).toBe(200);
    expect(own.body.months).toHaveLength(2);
    expect(own.body.heading).toBe('EMP-001 ปีภาษี 2569');
    expect((await t.api('GET', `/certificates/${c1.id}`, undefined, as('malee'))).status).toBe(404);
    expect((await t.api('GET', '/certificates', undefined, as('somchai'))).status).toBe(403);
    expect((await t.api('GET', '/certificates/not-an-id', undefined, as('hr'))).status).toBe(400);
  });

  it('PAY-02 (bugs-0.4): the employee finds their own 50 ทวิ through /my-certificates (and nobody else\'s)', async () => {
    const mine = await t.api('GET', '/my-certificates?year=2569', undefined, as('somchai'));
    expect(mine.status).toBe(200);
    expect(mine.body.map((c: any) => c.employee_code)).toEqual(['EMP-001']);
    expect((await t.api('GET', `/certificates/${mine.body[0].id}`, undefined, as('somchai'))).status).toBe(200);
    expect((await t.api('GET', '/my-certificates?year=2026', undefined, as('malee'))).body.map((c: any) => c.employee_code)).toEqual(['EMP-002']);
    expect((await t.api('GET', '/my-certificates', undefined, { token: t.token(['payroll.payslip.self'], t.tenantId, { userId: randomUUID() }) })).body).toEqual([]);
    expect((await t.api('GET', '/my-certificates', undefined, as('hr'))).status).toBe(403);
  });

  it('PAY-01 (bugs-0.4): the audit log never keeps a full bank account number', async () => {
    const tid = randomUUID(); // own company, so the other scenarios' counts are untouched
    const hr = { token: t.token(HR_PERMS, tid, { userName: 'ฝ่ายบุคคล' }) };
    const auditor = { token: t.token(['payroll.audit.read'], tid) };
    const p = (await t.api('POST', '/profiles', { employeeCode: 'EMP-AUD', employeeName: 'ทดสอบ ประวัติ', baseSalary: 20000, bankName: 'กสิกรไทย', bankAccount: '123-4-56789-0' }, hr)).body;
    await t.api('PATCH', `/profiles/${p.id}`, { bankAccount: '987-6-54321-0' }, hr);
    await t.api('POST', '/profiles/import', { rows: [{ employeeCode: 'EMP-AUD', bankAccount: '555-5-55555-1' }] }, hr);
    const log = (await t.api('GET', '/_audit?q=EMP-AUD', undefined, auditor)).body;
    const all = JSON.stringify((await t.api('GET', '/_audit?limit=500', undefined, auditor)).body);
    expect(JSON.parse(all)).toHaveLength(3);
    expect(all).not.toMatch(/56789|54321|55555/);
    expect(JSON.stringify(log)).toContain('••••7890');
  });

  it('summarises for the dashboard', async () => {
    const s = await t.api('GET', '/summary', undefined, as('hr'));
    expect(s.body).toMatchObject({ activeProfiles: 3, toApprove: 0, drafts: 1 });
    expect(s.body.months).toHaveLength(6);
    expect(s.body.rows.map((r: any) => r.no)).toEqual(['PR-2569-12-2', 'PR-2569-11', 'PR-2569-10']);
    expect((await t.api('GET', '/summary', undefined, as('somchai'))).status).toBe(403);
  });

  it('isolates tenants', async () => {
    const other = { token: t.token(['*'], t.otherTenantId) };
    expect((await t.api('GET', '/profiles', undefined, other)).body).toEqual([]);
    expect((await t.api('GET', '/runs', undefined, other)).body).toEqual([]);
    expect((await t.api('GET', '/items', undefined, other)).body).toEqual([]);
    expect((await t.api('GET', '/payslips', undefined, other)).body).toEqual([]);
    expect((await t.api('GET', `/runs/${run.id}`, undefined, other)).status).toBe(404);
    expect((await t.api('GET', `/payslips/${line1.id}`, undefined, other)).status).toBe(404);
    expect((await t.api('PATCH', `/profiles/${emp1.id}`, { note: 'x' }, other)).status).toBe(404);
    expect((await t.api('GET', '/settings', undefined, other)).body.ssoEmployerAccount).toBeNull();
    // the same employee code is free in another company
    expect((await t.api('POST', '/profiles', { employeeCode: 'EMP-001', employeeName: 'อื่น', baseSalary: 9000 }, other)).status).toBe(201);
  });
});
