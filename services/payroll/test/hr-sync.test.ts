/** Wave 5: HR → Payroll through events (hr.employee_upserted, hr.leave_decided with unpaid days). */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const ALL = ['payroll.profile.read', 'payroll.profile.write', 'payroll.run.read', 'payroll.run.write', 'payroll.run.approve', 'payroll.run.pay'];

function tenant() {
  const id = randomUUID();
  const token = t.token(ALL, id, { userName: 'ฝ่ายบุคคล' });
  const api = (m: string, url: string, body?: unknown, tok = token) => t.api(m, url, body, { token: tok });
  const deliver = (type: any, data: unknown) => { parseEvent(type, data); return t.deliver(type, data, { tenantId: id }); };
  const profiles = async () => (await api('GET', '/profiles')).body as any[];
  return { id, token, api, deliver, profiles };
}

const employee = (over: Record<string, unknown> = {}) => ({
  employeeId: randomUUID(), code: 'EMP-101', name: 'นายสมชาย ใจดี', departmentName: 'ผลิต', positionName: 'ช่างเทคนิค', status: 'active',
  startDate: '2026-01-05', resignedDate: null, userId: randomUUID(), ...over,
});

const leave = (emp: { employeeId: string; code: string }, over: Record<string, unknown> = {}) => ({
  leaveId: randomUUID(), no: 'LV-2569-0101', employeeName: 'นายสมชาย ใจดี', typeName: 'ลาไม่รับค่าจ้าง', decision: 'approved', employeeUserId: null, byName: 'หัวหน้า', note: null,
  employeeId: emp.employeeId, employeeCode: emp.code, from: '2026-03-10', to: '2026-03-11', days: 2, unpaid: true, byMonth: [{ period: '2026-03', days: 2 }], ...over,
});

describe('hr.employee_upserted → pay profiles', () => {
  it('creates a profile snapshot, updates it later and never touches the salary', async () => {
    const x = tenant();
    const e = employee();
    await x.deliver('hr.employee_upserted', e);
    let [p] = await x.profiles();
    expect(p).toMatchObject({ employee_code: 'EMP-101', employee_name: 'นายสมชาย ใจดี', employee_id: e.employeeId, department: 'ผลิต', position: 'ช่างเทคนิค',
      user_id: e.userId, base_salary: 0, pay_type: 'monthly', active: true });
    expect(String(p.start_date).slice(0, 10)).toBe('2026-01-05');
    expect(p.hr_synced_at).toBeTruthy();
    // payroll sets the salary; HR changes department and code; then the employee resigns
    await x.api('PATCH', `/profiles/${p.id}`, { baseSalary: 25000, bankName: 'กสิกรไทย' });
    await x.deliver('hr.employee_upserted', { ...e, code: 'EMP-101A', departmentName: 'ซ่อมบำรุง', name: 'นายสมชาย ใจดีมาก' });
    await x.deliver('hr.employee_upserted', { ...e, code: 'EMP-101A', departmentName: 'ซ่อมบำรุง', name: 'นายสมชาย ใจดีมาก', status: 'resigned', resignedDate: '2026-06-30' });
    const list = await x.profiles();
    expect(list).toHaveLength(1);
    p = (await x.api('GET', `/profiles/${list[0].id}`)).body;
    expect(p).toMatchObject({ employee_code: 'EMP-101A', employee_name: 'นายสมชาย ใจดีมาก', department: 'ซ่อมบำรุง', base_salary: 25000, bank_name: 'กสิกรไทย' });
    expect(String(p.end_date).slice(0, 10)).toBe('2026-06-30');
  });

  it('links an imported profile by employee code; conflicts keep the old values', async () => {
    const x = tenant();
    const userA = randomUUID();
    const imported = (await x.api('POST', '/profiles', { employeeCode: 'EMP-200', employeeName: 'มาลี (นำเข้า)', baseSalary: 18000, startDate: '2025-01-01', userId: userA })).body;
    await x.api('POST', '/profiles', { employeeCode: 'EMP-300', employeeName: 'วิชัย', baseSalary: 20000, startDate: '2025-01-01' });
    const e = employee({ code: 'EMP-200', name: 'นางสาวมาลี สวย', userId: null });
    await x.deliver('hr.employee_upserted', e);
    let p = (await x.api('GET', `/profiles/${imported.id}`)).body;
    expect(p).toMatchObject({ employee_id: e.employeeId, employee_name: 'นางสาวมาลี สวย', base_salary: 18000, user_id: null });
    // HR renames to a code another profile uses, and links a login another profile has → both kept as they were
    const userB = randomUUID();
    expect((await x.api('POST', '/profiles', { employeeCode: 'EMP-400', employeeName: 'อื่น', baseSalary: 10000, startDate: '2025-01-01', userId: userB })).status).toBe(201);
    await x.deliver('hr.employee_upserted', { ...e, code: 'EMP-300', userId: userB });
    p = (await x.api('GET', `/profiles/${imported.id}`)).body;
    expect(p).toMatchObject({ employee_code: 'EMP-200', user_id: null });
    // a new HR employee whose code is taken by someone else's linked profile is skipped (no crash)
    expect((await x.deliver('hr.employee_upserted', employee({ code: 'EMP-200', userId: null }))).status).toBe(200);
    expect(await x.profiles()).toHaveLength(3);
  });

  it('a run flags HR-created profiles whose salary is not keyed in yet', async () => {
    const x = tenant();
    await x.deliver('hr.employee_upserted', employee({ code: 'EMP-900' }));
    const run = (await x.api('POST', '/runs', { period: '2026-03', payDate: '2026-03-31' })).body;
    const calc = (await x.api('POST', `/runs/${run.id}/calculate`)).body;
    expect(calc.problems).toEqual([expect.objectContaining({ employee_code: 'EMP-900', message: expect.stringContaining('ยังไม่ได้กรอกเงินเดือน') })]);
  });
});

describe('hr.leave_decided (unpaid) → month inputs', () => {
  it('waits for the run, fills new lines, updates an open run and recalculates it', async () => {
    const x = tenant();
    const e = employee({ code: 'EMP-501' });
    await x.deliver('hr.employee_upserted', e);
    const [p] = await x.profiles();
    await x.api('PATCH', `/profiles/${p.id}`, { baseSalary: 30000 });
    // approved unpaid leave before the run exists → pending
    await x.deliver('hr.leave_decided', leave(e));
    expect((await x.api('GET', '/leave-inputs')).body).toMatchObject([{ period: '2026-03', days: 2, status: 'pending', employee_code: 'EMP-501' }]);
    // run created → the line starts with 2 unpaid days
    const run = (await x.api('POST', '/runs', { period: '2026-03', payDate: '2026-03-31' })).body;
    expect(run.lines[0].unpaid_leave_days).toBe(2);
    expect((await x.api('GET', '/leave-inputs?period=2026-03')).body[0]).toMatchObject({ status: 'applied', run_no: run.no });
    await x.api('POST', `/runs/${run.id}/calculate`);
    // another leave while the run is calculated → added and recalculated at once (1 day = 30000 / 30)
    await x.deliver('hr.leave_decided', leave(e, { leaveId: randomUUID(), no: 'LV-2569-0102', from: '2026-03-20', to: '2026-03-20', days: 1, byMonth: undefined }));
    const after = (await x.api('GET', `/runs/${run.id}`)).body;
    expect(after.status).toBe('calculated');
    expect(after.lines[0]).toMatchObject({ unpaid_leave_days: 3, unpaid_leave: 3000, calculated: true });
    // rejected leave, a paid leave type, and the same leave again do nothing
    await x.deliver('hr.leave_decided', leave(e, { leaveId: randomUUID(), decision: 'rejected' }));
    await x.deliver('hr.leave_decided', leave(e, { leaveId: randomUUID(), unpaid: false }));
    const first = (await x.api('GET', '/leave-inputs')).body.find((i: any) => i.leave_no === 'LV-2569-0101');
    await x.deliver('hr.leave_decided', leave(e, { leaveId: first.leave_id }));
    expect((await x.api('GET', `/runs/${run.id}`)).body.lines[0].unpaid_leave_days).toBe(3);
    expect((await x.api('GET', '/leave-inputs')).body).toHaveLength(2);
  });

  it('splits a leave across months and flags a month already approved', async () => {
    const x = tenant();
    const e = employee({ code: 'EMP-601' });
    await x.deliver('hr.employee_upserted', e);
    const [p] = await x.profiles();
    await x.api('PATCH', `/profiles/${p.id}`, { baseSalary: 15000 });
    const run = (await x.api('POST', '/runs', { period: '2026-04', payDate: '2026-04-30' })).body;
    await x.api('POST', `/runs/${run.id}/calculate`);
    expect((await x.api('POST', `/runs/${run.id}/approve`)).status).toBe(200);
    await x.deliver('hr.leave_decided', leave(e, { from: '2026-04-29', to: '2026-05-04', days: 4, byMonth: [{ period: '2026-04', days: 2 }, { period: '2026-05', days: 2 }] }));
    const inputs = (await x.api('GET', '/leave-inputs')).body;
    expect(inputs.find((i: any) => i.period === '2026-04')).toMatchObject({ status: 'late', days: 2 });
    expect(inputs.find((i: any) => i.period === '2026-05')).toMatchObject({ status: 'pending', days: 2 });
    expect((await x.api('GET', `/runs/${run.id}`)).body.lines[0].unpaid_leave_days).toBe(0);
    const may = (await x.api('POST', '/runs', { period: '2026-05', payDate: '2026-05-31' })).body;
    expect(may.lines[0].unpaid_leave_days).toBe(2);
  });

  it('leave inputs need payroll.run.read and stay inside the tenant', async () => {
    const x = tenant();
    const e = employee({ code: 'EMP-701' });
    await x.deliver('hr.leave_decided', leave(e)); // no profile yet: kept by code
    expect((await x.api('GET', '/leave-inputs')).body).toHaveLength(1);
    expect((await x.api('GET', '/leave-inputs', undefined, t.token(['payroll.payslip.self'], x.id))).status).toBe(403);
    const y = tenant();
    expect((await y.api('GET', '/leave-inputs')).body).toHaveLength(0);
    // the profile created later picks the leave up when the run is made
    await x.deliver('hr.employee_upserted', e);
    const run = (await x.api('POST', '/runs', { period: '2026-03', payDate: '2026-03-31' })).body;
    expect(run.lines[0].unpaid_leave_days).toBe(2);
  });
});
