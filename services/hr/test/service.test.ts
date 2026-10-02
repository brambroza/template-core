import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signToken } from '@erp/kernel';
import { bootTestService, TEST_JWT_SECRET, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

/** A token for a known user id (so "me" endpoints can resolve the linked employee). */
const userToken = (userId: string, perms: string[], tenantId = t.tenantId) => signToken(TEST_JWT_SECRET, { tenantId, userId, perms });
const STAFF = ['hr.leave.request', 'hr.attendance.self'];

const somchaiUser = randomUUID();
const approverUser = randomUUID();
const ids: Record<string, string> = {};

describe('hr: organisation and employees', () => {
  it('creates departments, positions and employees, searchable by nickname', async () => {
    const dept = await t.api('POST', '/departments', { code: 'PRD', name: 'ฝ่ายผลิต', managerName: 'คุณวิชัย' });
    expect(dept.status).toBe(201);
    ids.dept = dept.body.id;
    expect((await t.api('POST', '/departments', { code: 'prd', name: 'ซ้ำ' })).status).toBe(409);
    const pos = await t.api('POST', '/positions', { code: 'OP', name: 'พนักงานฝ่ายผลิต' });
    ids.pos = pos.body.id;

    const e = await t.api('POST', '/employees', {
      code: 'EMP-001', prefix: 'นาย', firstName: 'สมชาย', lastName: 'ใจดี', nickname: 'ชาย', departmentId: ids.dept, positionId: ids.pos,
      startDate: '2024-01-15', phone: '0812345678', userId: somchaiUser, nationalId: '1234567890123',
    });
    expect(e.status).toBe(201);
    expect(e.body).toMatchObject({ full_name: 'นายสมชาย ใจดี', department_name: 'ฝ่ายผลิต', position_name: 'พนักงานฝ่ายผลิต', status: 'active' });
    expect(JSON.stringify(e.body)).not.toContain('1234567890123');
    ids.somchai = e.body.id;

    const b = await t.api('POST', '/employees', { code: 'EMP-002', prefix: 'นางสาว', firstName: 'มาลี', nickname: 'แอน', startDate: '2026-08-01', status: 'probation', departmentId: ids.dept });
    ids.malee = b.body.id;
    const boss = await t.api('POST', '/employees', { code: 'EMP-900', firstName: 'วิชัย', startDate: '2020-01-01', userId: approverUser });
    ids.boss = boss.body.id;

    expect((await t.api('GET', '/employees?q=แอน')).body.map((x: any) => x.code)).toEqual(['EMP-002']);
    expect((await t.api('GET', `/employees?departmentId=${ids.dept}`)).body).toHaveLength(2);
    expect((await t.api('GET', '/departments')).body[0].headcount).toBe(2);
    expect((await t.api('GET', `/departments/${ids.dept}`)).body.employees).toHaveLength(2);
  });

  it('validates employee input and the one-login-per-employee rule', async () => {
    expect((await t.api('POST', '/employees', { code: 'X', firstName: '', startDate: '2026-01-01' })).status).toBe(400);
    expect((await t.api('POST', '/employees', { code: 'X', prefix: 'Mr', firstName: 'A', startDate: '2026-01-01' })).status).toBe(400);
    expect((await t.api('POST', '/employees', { code: 'X', firstName: 'A', startDate: '2026-01-01', departmentId: randomUUID() })).status).toBe(400);
    const dupUser = await t.api('POST', '/employees', { code: 'X', firstName: 'A', startDate: '2026-01-01', userId: somchaiUser });
    expect(dupUser.status).toBe(409);
    expect(dupUser.body.error.message).toContain('EMP-001');
    expect((await t.api('POST', '/employees', { code: 'EMP-001', firstName: 'A', startDate: '2026-01-01' })).status).toBe(409);
  });

  it('edits an employee and confirms probation', async () => {
    const ed = await t.api('PATCH', `/employees/${ids.malee}`, { lastName: 'สวยงาม', phone: '0899999999' });
    expect(ed.body).toMatchObject({ full_name: 'นางสาวมาลี สวยงาม', phone: '0899999999', status: 'probation' });
    expect((await t.api('PATCH', `/employees/${ids.malee}`, { status: 'resigned' })).status).toBe(400);
    expect((await t.api('POST', `/employees/${ids.malee}/confirm`)).body.status).toBe('active');
    expect((await t.api('POST', `/employees/${ids.malee}/confirm`)).status).toBe(409);
  });
});

describe('hr: leave', () => {
  it('seeds Thai labour-law leave types once', async () => {
    const r = await t.api('POST', '/leave-types/defaults');
    expect(r.body.created).toBe(7);
    expect((await t.api('POST', '/leave-types/defaults')).body.created).toBe(0);
    const types = (await t.api('GET', '/leave-types')).body;
    for (const tp of types) ids[tp.code] = tp.id;
    expect(types.find((x: any) => x.code === 'SICK')).toMatchObject({ name: 'ลาป่วย', days_per_year: 30 });
  });

  it('counts working days only (weekends and company holidays excluded)', async () => {
    expect((await t.api('POST', '/holidays', { date: '2027-03-03', name: 'วันหยุดบริษัท' })).status).toBe(201);
    expect((await t.api('POST', '/holidays', { date: '2027-03-03', name: 'ซ้ำ' })).status).toBe(409);
    // employee files their own leave (no employeeId: resolved from the login)
    const lv = await t.api('POST', '/leave-requests', { leaveTypeId: ids.ANNUAL, fromDate: '2027-03-01', toDate: '2027-03-07', reason: 'เที่ยวต่างจังหวัด' },
      { token: userToken(somchaiUser, STAFF) });
    expect(lv.status).toBe(201);
    expect(lv.body).toMatchObject({ status: 'pending', days: 4, employee_code: 'EMP-001', leave_type_name: 'ลาพักร้อน' });
    expect(lv.body.no).toMatch(/^LV-\d{4}-0001$/);
    ids.lvAnnual = lv.body.id;
  });

  it('rejects weekend-only, overlapping, cross-year and bad half-day requests', async () => {
    const me = { token: userToken(somchaiUser, STAFF) };
    const weekend = await t.api('POST', '/leave-requests', { leaveTypeId: ids.BUSINESS, fromDate: '2027-03-13', toDate: '2027-03-14' }, me);
    expect(weekend.status).toBe(400);
    expect(weekend.body.error.message).toContain('วันหยุด');
    const overlap = await t.api('POST', '/leave-requests', { leaveTypeId: ids.SICK, fromDate: '2027-03-05' }, me);
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.message).toContain('LV-');
    expect((await t.api('POST', '/leave-requests', { leaveTypeId: ids.SICK, fromDate: '2027-12-30', toDate: '2028-01-03' }, me)).status).toBe(400);
    expect((await t.api('POST', '/leave-requests', { leaveTypeId: ids.SICK, fromDate: '2027-04-05', toDate: '2027-04-06', halfDay: true }, me)).status).toBe(400);
    expect((await t.api('POST', '/leave-requests', { leaveTypeId: ids.MATERNITY, fromDate: '2027-04-05', halfDay: true }, me)).status).toBe(400);
    expect((await t.api('POST', '/leave-requests', { leaveTypeId: ids.SICK, fromDate: '2027-04-06', toDate: '2027-04-05' }, me)).status).toBe(400);
    const half = await t.api('POST', '/leave-requests', { leaveTypeId: ids.SICK, fromDate: '2027-04-05', halfDay: true }, me);
    expect(half.body.days).toBe(0.5);
  });

  it('refuses leave beyond the remaining balance with a Thai message', async () => {
    const me = { token: userToken(somchaiUser, STAFF) };
    expect((await t.api('POST', '/leave-requests', { leaveTypeId: ids.BUSINESS, fromDate: '2027-05-03', toDate: '2027-05-04' }, me)).body.days).toBe(2);
    const over = await t.api('POST', '/leave-requests', { leaveTypeId: ids.BUSINESS, fromDate: '2027-05-10', toDate: '2027-05-11' }, me);
    expect(over.status).toBe(400);
    expect(over.body.error.message).toBe('วันลาคงเหลือไม่พอ: ลากิจ ปี 2570 คงเหลือ 1 วัน แต่ขอลา 2 วัน');
    const bal = await t.api('GET', `/employees/${ids.somchai}/balance?year=2570`, undefined, me);
    expect(bal.body.year).toBe(2027);
    expect(bal.body.rows.find((r: any) => r.code === 'BUSINESS')).toMatchObject({ quota: 3, used: 0, pending: 2, remaining: 1 });
    expect(bal.body.rows.find((r: any) => r.code === 'UNPAID').remaining).toBeNull();
    // someone else's balance needs hr.employee.read
    expect((await t.api('GET', `/employees/${ids.malee}/balance`, undefined, me)).status).toBe(403);
  });

  it('runs the approval state machine with 409s and no self-approval', async () => {
    const approver = { token: userToken(approverUser, ['hr.employee.read', 'hr.leave.approve', 'hr.leave.request']) };
    const staff = { token: userToken(somchaiUser, STAFF) };
    expect((await t.api('POST', `/leave-requests/${ids.lvAnnual}/approve`, {}, staff)).status).toBe(403);
    const inbox = await t.api('GET', '/leave-requests/pending', undefined, approver);
    expect(inbox.body.length).toBe(3);
    const ok = await t.api('POST', `/leave-requests/${ids.lvAnnual}/approve`, { note: 'อนุมัติ' }, approver);
    expect(ok.body).toMatchObject({ status: 'approved', decision_note: 'อนุมัติ' });
    expect((await t.api('POST', `/leave-requests/${ids.lvAnnual}/approve`, {}, approver)).status).toBe(409);
    expect((await t.api('POST', `/leave-requests/${ids.lvAnnual}/reject`, { note: 'x' }, approver)).status).toBe(409);
    // the employee may not cancel an approved leave; HR may
    expect((await t.api('POST', `/leave-requests/${ids.lvAnnual}/cancel`, {}, staff)).status).toBe(409);

    // the approver's own leave cannot be approved by themselves
    const own = await t.api('POST', '/leave-requests', { leaveTypeId: ids.SICK, fromDate: '2027-06-07' }, approver);
    expect(own.status).toBe(201);
    const self = await t.api('POST', `/leave-requests/${own.body.id}/approve`, {}, approver);
    expect(self.status).toBe(409);
    expect(self.body.error.message).toContain('ตนเอง');
    expect((await t.api('POST', `/leave-requests/${own.body.id}/reject`, {}, approver)).status).toBe(400);
    expect((await t.api('POST', `/leave-requests/${own.body.id}/reject`, { note: 'ช่วงปิดงบ' })).body.status).toBe('rejected');

    // staff withdraws their own pending request; cannot cancel someone else's
    const mine = (await t.api('GET', '/me/leave-requests?status=pending', undefined, staff)).body;
    expect(mine.length).toBe(2);
    expect((await t.api('POST', `/leave-requests/${mine[0].id}/cancel`, {}, staff)).body.status).toBe('cancelled');
    expect((await t.api('POST', `/leave-requests/${own.body.id}/cancel`, {}, staff)).status).toBe(403);
    expect((await t.api('POST', `/leave-requests/${mine[0].id}/cancel`, {}, staff)).status).toBe(409);
    expect((await t.api('GET', `/leave-requests/${ids.lvAnnual}`, undefined, staff)).body.balance).toMatchObject({ used: 4, remaining: 2 });
    expect((await t.api('GET', `/leave-requests/${own.body.id}`, undefined, staff)).status).toBe(403);
  });

  it('lets approvers file leave for others but not plain staff', async () => {
    const staff = { token: userToken(somchaiUser, STAFF) };
    expect((await t.api('POST', '/leave-requests', { employeeId: ids.malee, leaveTypeId: ids.SICK, fromDate: '2027-07-05' }, staff)).status).toBe(403);
    const hr = await t.api('POST', '/leave-requests', { employeeId: ids.malee, leaveTypeId: ids.SICK, fromDate: '2027-07-05', toDate: '2027-07-06' });
    expect(hr.body).toMatchObject({ employee_code: 'EMP-002', days: 2 });
    expect((await t.api('GET', `/leave-requests?q=มาลี&status=pending`)).body).toHaveLength(1);
    const unlinked = await t.api('POST', '/leave-requests', { leaveTypeId: ids.SICK, fromDate: '2027-07-05' }, { token: userToken(randomUUID(), STAFF) });
    expect(unlinked.status).toBe(400);
  });
});

describe('hr: attendance', () => {
  it('sets the schedule and records late minutes against it', async () => {
    expect((await t.api('PUT', '/schedule', { startTime: '08:00', endTime: '17:00', graceMinutes: 5 })).body).toMatchObject({ startTime: '08:00', graceMinutes: 5 });
    expect((await t.api('PUT', '/schedule', { startTime: '17:00', endTime: '08:00' })).status).toBe(400);
    expect((await t.api('PUT', '/schedule', { startTime: '8am' })).status).toBe(400);

    // 2026-09-01 is a Tuesday
    const onTime = await t.api('POST', '/attendance/check-in', { employeeId: ids.somchai, date: '2026-09-01', time: '08:04', note: 'ลืมสแกน' });
    expect(onTime.status).toBe(201);
    expect(onTime.body).toMatchObject({ late_minutes: 0, source: 'admin', work_date: '2026-09-01' });
    const late = await t.api('POST', `/employees/${ids.malee}/check-in`, { date: '2026-09-01', time: '08:20' });
    expect(late.body.late_minutes).toBe(20);
    expect(late.body.message).toContain('สาย 20 นาที');
    const again = await t.api('POST', '/attendance/check-in', { employeeId: ids.somchai, date: '2026-09-01', time: '09:00' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain('08:04');

    const out = await t.api('POST', '/attendance/check-out', { employeeId: ids.somchai, date: '2026-09-01', time: '17:30' });
    expect(out.body).toMatchObject({ work_minutes: 566, early_minutes: 0 });
    expect((await t.api('POST', '/attendance/check-out', { employeeId: ids.somchai, date: '2026-09-01', time: '17:45' })).status).toBe(409);
    expect((await t.api('POST', `/employees/${ids.boss}/check-out`, { date: '2026-09-01', time: '17:00' })).status).toBe(409);
  });

  it('shows the daily board and the monthly summary', async () => {
    const board = (await t.api('GET', '/attendance?date=2026-09-01')).body;
    const status = Object.fromEntries(board.map((r: any) => [r.employee_code, r.status]));
    expect(status).toEqual({ 'EMP-001': 'present', 'EMP-002': 'late', 'EMP-900': 'absent' });
    expect((await t.api('GET', '/attendance?date=2026-09-01&status=late')).body).toHaveLength(1);
    expect((await t.api('GET', '/attendance?date=2026-09-05')).body.every((r: any) => r.status === 'off')).toBe(true); // Saturday

    const m = (await t.api('GET', '/attendance/monthly?month=2026-09')).body;
    expect(m.workDays).toBe(22);
    const somchai = m.rows.find((r: any) => r.employee_code === 'EMP-001');
    expect(somchai).toMatchObject({ present_days: 1, late_count: 0, absent_days: 21 });
    const malee = m.rows.find((r: any) => r.employee_code === 'EMP-002');
    expect(malee).toMatchObject({ present_days: 1, late_count: 1, late_minutes: 20 });
    expect((await t.api('GET', `/employees/${ids.somchai}/attendance?month=2026-09`)).body).toHaveLength(1);
  });

  it('lets staff check in for themselves with server time only', async () => {
    const me = { token: userToken(somchaiUser, STAFF) };
    expect((await t.api('POST', '/attendance/check-in', { date: '2026-09-02', time: '08:00' }, me)).status).toBe(403);
    expect((await t.api('POST', '/attendance/check-in', { employeeId: ids.malee }, me)).status).toBe(403);
    const now = await t.api('POST', '/attendance/check-in', { lat: 13.7563, lng: 100.5018 }, me);
    expect(now.status).toBe(201);
    expect(now.body).toMatchObject({ source: 'self', in_lat: 13.7563 });
    expect((await t.api('POST', '/attendance/check-in', {}, me)).status).toBe(409);
    const view = (await t.api('GET', '/me', undefined, me)).body;
    expect(view.attendanceState).toBe('in');
    expect(view.employee.code).toBe('EMP-001');
    expect(view.balance.length).toBeGreaterThan(0);
    expect((await t.api('POST', '/attendance/check-out', {}, me)).body.check_out_at).toBeTruthy();
    expect((await t.api('GET', '/me', undefined, me)).body.attendanceState).toBe('out');
    expect((await t.api('POST', '/attendance/check-in', {}, { token: userToken(randomUUID(), STAFF) })).status).toBe(400);
    expect((await t.api('GET', '/me', undefined, { token: userToken(randomUUID(), STAFF) })).body.attendanceState).toBe('unlinked');
  });
});

describe('hr: resignation, dashboard, permissions, tenants', () => {
  it('resigns an employee and drops their future pending leave', async () => {
    const r = await t.api('POST', `/employees/${ids.malee}/resign`, { resignedOn: '2027-06-30' });
    expect(r.body).toMatchObject({ status: 'resigned', resigned_on: '2027-06-30' });
    expect((await t.api('GET', `/leave-requests?employeeId=${ids.malee}`)).body[0].status).toBe('cancelled');
    expect((await t.api('POST', `/employees/${ids.malee}/resign`, {})).status).toBe(409);
    expect((await t.api('POST', '/leave-requests', { employeeId: ids.malee, leaveTypeId: ids.SICK, fromDate: '2027-06-01' })).status).toBe(409);
    expect((await t.api('GET', '/employees?status=current')).body.map((e: any) => e.code)).toEqual(['EMP-001', 'EMP-900']);
  });

  it('summarises the day for the dashboard', async () => {
    const s = (await t.api('GET', '/summary')).body;
    expect(s).toMatchObject({ headcount: 2, presentToday: 1, pendingLeave: 1 });
    expect(s.months).toHaveLength(6);
    expect(s.rows[0]).toMatchObject({ status: 'pending' });
    expect(s.rows[0].title).toContain('ลาป่วย');
  });

  it('enforces permissions', async () => {
    const staff = { token: userToken(somchaiUser, STAFF) };
    expect((await t.api('GET', '/employees', undefined, staff)).status).toBe(403);
    expect((await t.api('GET', '/attendance', undefined, staff)).status).toBe(403);
    expect((await t.api('POST', '/employees', { code: 'Z', firstName: 'Z', startDate: '2026-01-01' }, { token: t.token(['hr.employee.read']) })).status).toBe(403);
    expect((await t.api('POST', '/holidays', { date: '2027-01-01', name: 'ปีใหม่' }, { token: t.token(['hr.employee.write']) })).status).toBe(403);
    expect((await t.api('POST', `/employees/${ids.somchai}/check-in`, { date: '2026-09-03', time: '08:00' }, { token: t.token(['hr.attendance.self']) })).status).toBe(403);
    expect((await t.api('GET', '/me', undefined, { token: t.token(['hr.employee.read']) })).status).toBe(403);
  });

  it('isolates tenants', async () => {
    const other = { token: t.token(['*'], t.otherTenantId) };
    expect((await t.api('GET', '/employees', undefined, other)).body).toEqual([]);
    expect((await t.api('GET', '/leave-requests', undefined, other)).body).toEqual([]);
    expect((await t.api('GET', '/departments', undefined, other)).body).toEqual([]);
    expect((await t.api('GET', '/holidays', undefined, other)).body).toEqual([]);
    expect((await t.api('GET', '/leave-types', undefined, other)).body).toEqual([]);
    expect((await t.api('GET', `/employees/${ids.somchai}`, undefined, other)).status).toBe(404);
    expect((await t.api('GET', '/attendance/monthly?month=2026-09', undefined, other)).body.rows).toEqual([]);
    expect((await t.api('GET', '/summary', undefined, other)).body).toMatchObject({ headcount: 0, pendingLeave: 0 });
    // other tenant can reuse the same codes
    expect((await t.api('POST', '/employees', { code: 'EMP-001', firstName: 'อื่น', startDate: '2026-01-01' }, other)).status).toBe(201);
  });
});

describe('hr: events (for Automation alerts)', () => {
  it('publishes leave_requested on filing and leave_decided on approve / reject', async () => {
    const req = (await t.published('hr.leave_requested')).map((e) => e.data);
    const annual = req.find((d: any) => d.leaveId === ids.lvAnnual);
    expect(annual).toMatchObject({ employeeName: 'นายสมชาย ใจดี', typeName: 'ลาพักร้อน', from: '2027-03-01', to: '2027-03-07', days: 4 });
    expect(annual.no).toMatch(/^LV-\d{4}-0001$/);
    const decided = (await t.published('hr.leave_decided')).map((e) => e.data);
    expect(decided.find((d: any) => d.leaveId === ids.lvAnnual)).toMatchObject({ employeeName: 'นายสมชาย ใจดี', typeName: 'ลาพักร้อน', decision: 'approved' });
    expect(decided.map((d: any) => d.decision)).toEqual(['approved', 'rejected']);
    // refused requests publish nothing
    const before = req.length;
    expect((await t.api('POST', '/leave-requests', { leaveTypeId: ids.ANNUAL, fromDate: '2027-03-06', toDate: '2027-03-07' }, { token: userToken(somchaiUser, STAFF) })).status).toBe(400);
    expect((await t.published('hr.leave_requested')).length).toBe(before);
  });
});

describe('hr — QA regressions (docs/uat/bugs-0.3.md)', () => {
  it('HR-01: leave dated before the employee started is refused', async () => {
    const me = { token: userToken(somchaiUser, STAFF) }; // EMP-001 started 2024-01-15
    const r = await t.api('POST', '/leave-requests', { leaveTypeId: ids.BUSINESS, fromDate: '2023-03-06' }, me);
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain('ก่อนวันเริ่มงาน');
    expect(r.body.error.details.fieldErrors.fromDate).toBeDefined();
  });

  it('HR-02: an approver cannot reject (or approve) their own leave', async () => {
    const boss = { token: userToken(approverUser, ['hr.leave.request', 'hr.leave.approve', 'hr.employee.read']) };
    const lv = await t.api('POST', '/leave-requests', { leaveTypeId: ids.SICK, fromDate: '2027-06-07' }, boss);
    expect(lv.status).toBe(201);
    expect((await t.api('POST', `/leave-requests/${lv.body.id}/reject`, { note: 'ไม่ลาแล้ว' }, boss)).status).toBe(409);
    expect((await t.api('POST', `/leave-requests/${lv.body.id}/approve`, {}, boss)).status).toBe(409);
    expect((await t.api('POST', `/leave-requests/${lv.body.id}/cancel`, {}, boss)).body.status).toBe('cancelled');
  });

  it('HR-03: an impossible date (30 Feb) is refused instead of rolling over to March', async () => {
    const r = await t.api('POST', `/employees/${ids.boss}/check-in`, { date: '2026-02-30', time: '08:00' });
    expect(r.status).toBe(400);
    expect(r.body.error.details.fieldErrors.date).toBeDefined();
    expect((await t.api('GET', `/employees/${ids.boss}/attendance?month=2026-03`)).body).toHaveLength(0);
    // a past day says which day, not "today"
    expect((await t.api('POST', `/employees/${ids.boss}/check-in`, { date: '2026-09-07', time: '08:00' })).status).toBe(201);
    const dup = await t.api('POST', `/employees/${ids.boss}/check-in`, { date: '2026-09-07', time: '08:30' });
    expect(dup.body.error.message).toContain('วันที่ 2026-09-07');
    const early = await t.api('POST', `/employees/${ids.boss}/check-out`, { date: '2026-09-07', time: '07:00' });
    expect(early.status).toBe(409);
    expect(early.body.error.message).toContain('เวลาออกงานก่อนเวลาเข้างาน');
  });
});
