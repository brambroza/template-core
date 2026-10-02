/** Wave 5: what HR tells Payroll — hr.employee_upserted and the unpaid-leave fields of hr.leave_decided. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

function tenant() {
  const id = randomUUID();
  const token = t.token(['*'], id, { userId: randomUUID(), userName: 'ฝ่ายบุคคล' });
  const api = (m: string, url: string, body?: unknown, tok = token) => t.api(m, url, body, { token: tok });
  return { id, api };
}
/** the outbox is shared by all tenants of the test service — pick this employee's events */
const upserts = async (employeeId: string) => (await t.published('hr.employee_upserted')).map((e) => e.data).filter((d) => d.employeeId === employeeId);

describe('hr.employee_upserted', () => {
  it('is published on create, edit, confirm and resign with a snapshot (no salary, no ID number)', async () => {
    const x = tenant();
    const dept = (await x.api('POST', '/departments', { code: 'PRD', name: 'ฝ่ายผลิต' })).body;
    const pos = (await x.api('POST', '/positions', { code: 'TECH', name: 'ช่างเทคนิค' })).body;
    const userId = randomUUID();
    const emp = (await x.api('POST', '/employees', { code: 'EMP-801', prefix: 'นาย', firstName: 'สมชาย', lastName: 'ใจดี', departmentId: dept.id, positionId: pos.id,
      startDate: '2026-01-05', status: 'probation', userId })).body;
    let evs = await upserts(emp.id);
    expect(evs).toEqual([{ employeeId: emp.id, code: 'EMP-801', name: 'นายสมชาย ใจดี', departmentName: 'ฝ่ายผลิต', positionName: 'ช่างเทคนิค', status: 'probation',
      startDate: '2026-01-05', resignedDate: null, userId }]);
    expect(() => parseEvent('hr.employee_upserted', evs[0])).not.toThrow();
    await x.api('PATCH', `/employees/${emp.id}`, { nickname: 'ชาย', lastName: 'ใจงาม' });
    await x.api('POST', `/employees/${emp.id}/confirm`);
    await x.api('POST', `/employees/${emp.id}/resign`, { resignedOn: '2026-09-30' });
    evs = await upserts(emp.id);
    expect(evs.map((e) => [e.name, e.status, e.resignedDate])).toEqual([
      ['นายสมชาย ใจดี', 'probation', null], ['นายสมชาย ใจงาม', 'probation', null], ['นายสมชาย ใจงาม', 'active', null], ['นายสมชาย ใจงาม', 'resigned', '2026-09-30']]);
    // a refused change publishes nothing
    expect((await x.api('POST', `/employees/${emp.id}/resign`, { resignedOn: '2026-10-01' })).status).toBe(409);
    expect(await upserts(emp.id)).toHaveLength(4);
  });
});

describe('leave types and hr.leave_decided for payroll', () => {
  it('flags unpaid leave types (defaults + create + edit)', async () => {
    const x = tenant();
    const types = (await x.api('POST', '/leave-types/defaults')).body.types;
    expect(types.find((y: any) => y.code === 'UNPAID').unpaid).toBe(true);
    expect(types.find((y: any) => y.code === 'SICK').unpaid).toBe(false);
    const own = await x.api('POST', '/leave-types', { code: 'NOPAY2', name: 'ลาเกินสิทธิ์ (ไม่รับค่าจ้าง)', unpaid: true });
    expect(own.body.unpaid).toBe(true);
    expect((await x.api('PATCH', `/leave-types/${own.body.id}`, { unpaid: false })).body.unpaid).toBe(false);
    expect((await x.api('POST', '/leave-types', { code: 'BAD', name: 'x', unpaid: 'yes' })).status).toBe(400);
  });

  it('carries employee code, days, unpaid flag and the working days per month', async () => {
    const x = tenant();
    const types = (await x.api('POST', '/leave-types/defaults')).body.types;
    const unpaid = types.find((y: any) => y.code === 'UNPAID');
    const sick = types.find((y: any) => y.code === 'SICK');
    const emp = (await x.api('POST', '/employees', { code: 'EMP-802', firstName: 'มาลี', startDate: '2026-01-05' })).body;
    // Thu 29 Oct – Tue 3 Nov 2026: Thu, Fri in October; Mon, Tue in November
    const lv = (await x.api('POST', '/leave-requests', { employeeId: emp.id, leaveTypeId: unpaid.id, fromDate: '2026-10-29', toDate: '2026-11-03' })).body;
    expect(lv.days).toBe(4);
    await x.api('POST', `/leave-requests/${lv.id}/approve`, { note: 'ok' });
    const dec = (await t.published('hr.leave_decided')).map((e) => e.data).find((d) => d.leaveId === lv.id);
    expect(dec).toMatchObject({ decision: 'approved', employeeId: emp.id, employeeCode: 'EMP-802', from: '2026-10-29', to: '2026-11-03', days: 4, unpaid: true,
      byMonth: [{ period: '2026-10', days: 2 }, { period: '2026-11', days: 2 }] });
    expect(() => parseEvent('hr.leave_decided', dec)).not.toThrow();
    const lv2 = (await x.api('POST', '/leave-requests', { employeeId: emp.id, leaveTypeId: sick.id, fromDate: '2026-12-01', halfDay: true })).body;
    await x.api('POST', `/leave-requests/${lv2.id}/reject`, { note: 'งานด่วน' });
    const dec2 = (await t.published('hr.leave_decided')).map((e) => e.data).find((d) => d.leaveId === lv2.id);
    expect(dec2).toMatchObject({ decision: 'rejected', unpaid: false, days: 0.5, byMonth: [{ period: '2026-12', days: 0.5 }] });
  });
});
