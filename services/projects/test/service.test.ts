import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

/** Monday of the current week as YYYY-MM-DD, computed like Postgres (local date of the DB = test host). */
function mondayOf(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

describe('projects', () => {
  const managerId = randomUUID();
  const devId = randomUUID();
  let project: any;

  it('creates a project with members; manager becomes a member; PJ number', async () => {
    const res = await t.api('POST', '/projects', {
      name: 'ติดตั้งระบบ ERP โรงงาน A', customerId: randomUUID(), customerName: 'บริษัท เอ จำกัด', managerId, managerName: 'สมชาย',
      budget: 10000, startDate: '2026-10-01', endDate: '2026-12-31',
      members: [{ userId: devId, userName: 'สมหญิง', role: 'Developer', hourlyRate: 500 }],
    });
    expect(res.status).toBe(201);
    project = res.body;
    expect(project.no).toMatch(/^PJ-2569-\d{4}$/);
    expect(project).toMatchObject({ status: 'planning', progress: 0, hours_logged: 0, cost: 0, budget_at_risk: false });
    expect(project.members.map((m: any) => m.user_name).sort()).toEqual(['สมชาย', 'สมหญิง']);
  });

  it('validates input (400)', async () => {
    expect((await t.api('POST', '/projects', { name: '' })).status).toBe(400);
    expect((await t.api('POST', '/projects', { name: 'x', budget: -1 })).status).toBe(400);
    expect((await t.api('POST', '/projects', { name: 'x', startDate: '2026-12-01', endDate: '2026-01-01' })).status).toBe(400);
    expect((await t.api('POST', '/tasks', { projectId: project.id, title: 'x', priority: 'whenever' })).status).toBe(400);
  });

  it('runs the project state machine with 409 on illegal moves', async () => {
    expect((await t.api('POST', `/projects/${project.id}/complete`)).status).toBe(409);
    expect((await t.api('POST', `/projects/${project.id}/activate`)).body.status).toBe('active');
    expect((await t.api('POST', `/projects/${project.id}/activate`)).status).toBe(409);
    expect((await t.api('POST', `/projects/${project.id}/hold`)).body.status).toBe('on_hold');
    expect((await t.api('POST', `/projects/${project.id}/activate`)).body.status).toBe('active');
    const edited = await t.api('PATCH', `/projects/${project.id}`, { budget: 12000, description: 'Phase 1' });
    expect(edited.body).toMatchObject({ budget: 12000, description: 'Phase 1', name: 'ติดตั้งระบบ ERP โรงงาน A' });
  });

  it('milestones and tasks: board, my tasks, overdue, task state machine', async () => {
    const withMs = await t.api('POST', `/projects/${project.id}/milestones`, { name: 'Go-live', dueDate: '2020-01-31' });
    expect(withMs.status).toBe(201);
    const ms = withMs.body.milestones[0];
    expect(ms).toMatchObject({ name: 'Go-live', done: false, overdue: true });

    const devToken = t.token(['projects.project.read', 'projects.task.write', 'projects.timesheet.log']);
    // tokens carry random user ids; use the one inside devToken as assignee
    const devUser = JSON.parse(Buffer.from(devToken.split('.')[1], 'base64url').toString()).sub;

    const t1 = await t.api('POST', '/tasks', { projectId: project.id, title: 'ติดตั้งเซิร์ฟเวอร์', assigneeId: devUser, assigneeName: 'สมหญิง', estimateHours: 6, dueDate: '2020-01-10', milestoneId: ms.id, priority: 'high' }, { token: devToken });
    expect(t1.status).toBe(201);
    expect(t1.body).toMatchObject({ status: 'todo', project_no: project.no, milestone_name: 'Go-live', overdue: true });
    const t2 = (await t.api('POST', '/tasks', { projectId: project.id, title: 'อบรมผู้ใช้', estimateHours: 4, dueDate: '2099-01-01' })).body;

    const otherProject = (await t.api('POST', '/projects', { name: 'Other' })).body;
    const other = await t.api('POST', `/projects/${otherProject.id}/milestones`, { name: 'M' });
    expect((await t.api('POST', '/tasks', { projectId: project.id, title: 'x', milestoneId: other.body.milestones[0].id })).status).toBe(400);

    const mine = await t.api('GET', '/tasks/mine', undefined, { token: devToken });
    expect(mine.body.map((x: any) => x.title)).toEqual(['ติดตั้งเซิร์ฟเวอร์']);

    expect((await t.api('POST', `/tasks/${t1.body.id}/review`, undefined, { token: devToken })).status).toBe(409);
    expect((await t.api('POST', `/tasks/${t1.body.id}/start`, undefined, { token: devToken })).body.status).toBe('doing');
    expect((await t.api('POST', `/tasks/${t1.body.id}/review`, undefined, { token: devToken })).body.status).toBe('review');
    expect((await t.api('POST', `/tasks/${t1.body.id}/start`, undefined, { token: devToken })).body.status).toBe('doing'); // sent back
    expect((await t.api('POST', `/tasks/${t1.body.id}/reopen`)).status).toBe(409);
    const done = await t.api('POST', `/tasks/${t1.body.id}/done`, undefined, { token: devToken });
    expect(done.body).toMatchObject({ status: 'done', overdue: false });
    expect(done.body.completed_at).toBeTruthy();

    const board = await t.api('GET', `/tasks/board?projectId=${project.id}`);
    expect(board.body.counts).toEqual({ todo: 1, doing: 0, review: 0, done: 1 });

    const p = (await t.api('GET', `/projects/${project.id}`)).body;
    expect(p).toMatchObject({ task_count: 2, tasks_done: 1, hours_estimated: 10, progress: 60 });

    const reopened = await t.api('POST', `/tasks/${t1.body.id}/reopen`);
    expect(reopened.body).toMatchObject({ status: 'todo', completed_at: null });
    await t.api('POST', `/tasks/${t1.body.id}/done`);
    expect((await t.api('PATCH', `/tasks/${t2.id}`, { title: 'อบรมผู้ใช้งาน 2 รอบ', estimateHours: 8 })).body).toMatchObject({ title: 'อบรมผู้ใช้งาน 2 รอบ', estimate_hours: 8 });

    expect((await t.api('GET', '/tasks?overdue=true')).body).toHaveLength(0);
    expect((await t.api('GET', '/tasks?q=อบรม')).body).toHaveLength(1);
    expect((await t.api('POST', `/milestones/${ms.id}/done`)).body).toMatchObject({ done: true, overdue: false });
    expect((await t.api('POST', `/milestones/${ms.id}/done`)).status).toBe(409);
    expect((await t.api('GET', `/milestones?projectId=${project.id}&done=true`)).body).toHaveLength(1);
  });

  it('timesheets: log, weekly view, cost vs budget, submit -> reject -> submit -> approve', async () => {
    const devToken = t.token(['projects.project.read', 'projects.timesheet.log']);
    const devUser = JSON.parse(Buffer.from(devToken.split('.')[1], 'base64url').toString()).sub;
    await t.api('POST', `/projects/${project.id}/members`, { userId: devUser, userName: 'สมหญิง', role: 'Developer', hourlyRate: 1500 });
    const monday = mondayOf();
    const tasks = (await t.api('GET', `/tasks?projectId=${project.id}`)).body;

    expect((await t.api('POST', '/timesheets', { workDate: monday, projectId: project.id, hours: 0.1 }, { token: devToken })).status).toBe(400);
    expect((await t.api('POST', '/timesheets', { workDate: monday, projectId: project.id, hours: 25 }, { token: devToken })).status).toBe(400);
    const other = (await t.api('POST', '/projects', { name: 'Other 2' })).body;
    const otherTask = (await t.api('POST', '/tasks', { projectId: other.id, title: 'x' })).body;
    expect((await t.api('POST', '/timesheets', { workDate: monday, projectId: project.id, taskId: otherTask.id, hours: 1 }, { token: devToken })).status).toBe(400);

    const e1 = await t.api('POST', '/timesheets', { workDate: monday, projectId: project.id, taskId: tasks[0].id, hours: 4, note: 'ติดตั้ง' }, { token: devToken });
    expect(e1.status).toBe(201);
    expect(e1.body).toMatchObject({ hours: 4, user_name: 'สมหญิง', week_status: 'draft', project_no: project.no });
    await t.api('POST', '/timesheets', { workDate: monday, projectId: project.id, hours: 3.5 }, { token: devToken });
    expect((await t.api('POST', '/timesheets', { workDate: monday, projectId: project.id, hours: 17 }, { token: devToken })).status).toBe(400); // > 24h/day

    const week = await t.api('GET', '/timesheets/week', undefined, { token: devToken });
    expect(week.body).toMatchObject({ weekStart: monday, status: 'draft', total: 7.5 });
    expect(week.body.days).toHaveLength(7);
    expect(week.body.days[0]).toEqual({ date: monday, hours: 7.5 });
    expect(week.body.rows).toHaveLength(2);
    expect((await t.api('GET', `/timesheets/week?userId=${randomUUID()}`, undefined, { token: devToken })).status).toBe(403);

    // cost = 7.5h × 1500 = 11,250 of 12,000 budget -> > 90% -> at risk
    const p = (await t.api('GET', `/projects/${project.id}`)).body;
    expect(p).toMatchObject({ hours_logged: 7.5, cost: 11250, budget_used_pct: 93.8, budget_at_risk: true });
    const sum = (await t.api('GET', '/summary')).body;
    expect(sum).toMatchObject({ activeProjects: 1, budgetAtRisk: 1, hoursThisWeek: 7.5, overdueTasks: 0 });
    expect(sum.months).toHaveLength(6);
    expect(sum.months.reduce((n: number, m: any) => n + m.hours, 0)).toBe(7.5); // Monday may fall in last month
    expect(sum.rows.length).toBeGreaterThan(0);

    // delete own draft entry
    const extra = (await t.api('POST', '/timesheets', { workDate: monday, projectId: project.id, hours: 1 }, { token: devToken })).body;
    expect((await t.api('DELETE', `/timesheets/${extra.id}`)).status).toBe(403); // someone else's
    expect((await t.api('DELETE', `/timesheets/${extra.id}`, undefined, { token: devToken })).body).toMatchObject({ deleted: true });

    const submitted = await t.api('POST', '/timesheets/week/submit', {}, { token: devToken });
    expect(submitted.body).toMatchObject({ status: 'submitted', total: 7.5 });
    expect((await t.api('POST', '/timesheets/week/submit', {}, { token: devToken })).status).toBe(409);
    expect((await t.api('POST', '/timesheets', { workDate: monday, projectId: project.id, hours: 1 }, { token: devToken })).status).toBe(409);
    expect((await t.api('DELETE', `/timesheets/${e1.body.id}`, undefined, { token: devToken })).status).toBe(409);

    expect((await t.api('GET', '/timesheet-weeks', undefined, { token: devToken })).status).toBe(403);
    const weeks = (await t.api('GET', '/timesheet-weeks?status=submitted')).body;
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ user_name: 'สมหญิง', total_hours: 7.5 });
    expect((await t.api('POST', `/timesheet-weeks/${weeks[0].id}/approve`, undefined, { token: devToken })).status).toBe(403);
    expect((await t.api('POST', `/timesheet-weeks/${weeks[0].id}/reject`, {})).status).toBe(400);
    const rejected = await t.api('POST', `/timesheet-weeks/${weeks[0].id}/reject`, { reason: 'ใส่รายละเอียดงานด้วย' });
    expect(rejected.body).toMatchObject({ status: 'draft', reject_reason: 'ใส่รายละเอียดงานด้วย' });
    expect((await t.api('POST', `/timesheet-weeks/${weeks[0].id}/approve`)).status).toBe(409);
    await t.api('POST', '/timesheets/week/submit', { start: monday }, { token: devToken });
    const approved = await t.api('POST', `/timesheet-weeks/${weeks[0].id}/approve`);
    expect(approved.body).toMatchObject({ status: 'approved', total_hours: 7.5 });
    expect(approved.body.entries).toHaveLength(2);
    expect((await t.api('GET', `/timesheet-weeks/${weeks[0].id}`, undefined, { token: devToken })).body.status).toBe('approved');
    expect((await t.api('GET', `/timesheet-weeks/${weeks[0].id}`, undefined, { token: t.token(['projects.timesheet.log']) })).status).toBe(403);

    // own entries only without approve permission
    expect((await t.api('GET', '/timesheets', undefined, { token: devToken })).body).toHaveLength(2);
    expect((await t.api('GET', '/timesheets', undefined, { token: t.token(['projects.timesheet.log']) })).body).toHaveLength(0);
  });

  it('closed projects refuse new work', async () => {
    expect((await t.api('POST', `/projects/${project.id}/complete`)).body).toMatchObject({ status: 'done' });
    expect((await t.api('POST', '/tasks', { projectId: project.id, title: 'late' })).status).toBe(409);
    expect((await t.api('POST', `/projects/${project.id}/milestones`, { name: 'late' })).status).toBe(409);
    expect((await t.api('GET', '/projects?open=true')).body.map((p: any) => p.id)).not.toContain(project.id);
    expect((await t.api('POST', `/projects/${project.id}/reopen`)).body.status).toBe('active');
    const c = (await t.api('POST', '/projects', { name: 'จะยกเลิก' })).body;
    expect((await t.api('POST', `/projects/${c.id}/cancel`)).body.status).toBe('cancelled');
    expect((await t.api('POST', `/projects/${c.id}/cancel`)).status).toBe(409);
    expect((await t.api('POST', '/timesheets', { workDate: '2026-10-01', projectId: c.id, hours: 1 })).status).toBe(409);
    expect((await t.api('GET', '/projects?q=ยกเลิก')).body).toHaveLength(1);
  });

  it('requires permissions (403)', async () => {
    const reader = t.token(['projects.project.read']);
    expect((await t.api('POST', '/projects', { name: 'x' }, { token: reader })).status).toBe(403);
    expect((await t.api('POST', '/tasks', { projectId: project.id, title: 'x' }, { token: reader })).status).toBe(403);
    expect((await t.api('POST', `/projects/${project.id}/hold`, undefined, { token: reader })).status).toBe(403);
    expect((await t.api('POST', '/timesheets', { workDate: '2026-10-01', projectId: project.id, hours: 1 }, { token: reader })).status).toBe(403);
    expect((await t.api('GET', '/projects', undefined, { token: t.token([]) })).status).toBe(403);
  });

  it('isolates tenants', async () => {
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('GET', '/projects', undefined, { token: other })).body).toHaveLength(0);
    expect((await t.api('GET', '/tasks', undefined, { token: other })).body).toHaveLength(0);
    expect((await t.api('GET', '/milestones', undefined, { token: other })).body).toHaveLength(0);
    expect((await t.api('GET', '/timesheets', undefined, { token: other })).body).toHaveLength(0);
    expect((await t.api('GET', '/timesheet-weeks', undefined, { token: other })).body).toHaveLength(0);
    expect((await t.api('GET', `/projects/${project.id}`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('POST', '/tasks', { projectId: project.id, title: 'x' }, { token: other })).status).toBe(404);
    expect((await t.api('GET', '/summary', undefined, { token: other })).body).toMatchObject({ activeProjects: 0, hoursThisWeek: 0 });
  });
});

describe('projects — QA regressions (docs/uat/bugs-0.3.md)', () => {
  it('PJ-01: an approver cannot approve their own timesheet week', async () => {
    const lead = t.token(['projects.project.read', 'projects.project.write', 'projects.timesheet.log', 'projects.timesheet.approve']);
    const p = (await t.api('POST', '/projects', { name: 'โครงการทดสอบอนุมัติ' }, { token: lead })).body;
    await t.api('POST', `/projects/${p.id}/activate`, undefined, { token: lead });
    expect((await t.api('POST', '/timesheets', { workDate: '2026-09-21', projectId: p.id, hours: 8 }, { token: lead })).status).toBe(201);
    const w = (await t.api('POST', '/timesheets/week/submit', { start: '2026-09-21' }, { token: lead })).body;
    const self = await t.api('POST', `/timesheet-weeks/${w.id}/approve`, undefined, { token: lead });
    expect(self.status).toBe(403);
    expect(self.body.error.message).toContain('ของตนเองไม่ได้');
    expect((await t.api('POST', `/timesheet-weeks/${w.id}/approve`)).body.status).toBe('approved'); // another approver
  });

  it('PJ-02: hours cannot be logged for a future date', async () => {
    const p = (await t.api('POST', '/projects', { name: 'โครงการอนาคต' })).body;
    const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const r = await t.api('POST', '/timesheets', { workDate: future, projectId: p.id, hours: 8 });
    expect(r.status).toBe(400);
    expect(r.body.error.details.fieldErrors.workDate).toBeDefined();
  });

  it('PJ-03: an end date before the start date gives a Thai field error, not the raw constraint', async () => {
    const r = await t.api('POST', '/projects', { name: 'วันผิด', startDate: '2026-10-10', endDate: '2026-10-01' });
    expect(r.status).toBe(400);
    expect(r.body.error.details.fieldErrors.endDate).toEqual(['วันสิ้นสุดต้องไม่ก่อนวันเริ่ม']);
    const ok = (await t.api('POST', '/projects', { name: 'วันถูก', startDate: '2026-10-10', endDate: '2026-12-31' })).body;
    expect((await t.api('PATCH', `/projects/${ok.id}`, { endDate: '2026-10-09' })).status).toBe(400);
    expect((await t.api('PATCH', `/projects/${ok.id}`, { endDate: '2026-10-10' })).status).toBe(200);
  });
});

describe('projects — who (wave 4)', () => {
  it('logs hours under the token name and records who approved / sent back the week', async () => {
    const p = (await t.api('POST', '/projects', { name: 'งานเอกสาร', budget: 0 })).body;
    const meId = randomUUID();
    const me = t.token(['projects.project.read', 'projects.timesheet.log'], t.tenantId, { userId: meId, userName: 'มินตรา ใจดี' });
    const boss = t.token(['projects.project.read', 'projects.timesheet.log', 'projects.timesheet.approve'], t.tenantId, { userId: randomUUID(), userName: 'หัวหน้าโครงการ' });
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    // an old nameless entry first, then the named token takes over the week's name
    const e = await t.api('POST', '/timesheets', { workDate: today, projectId: p.id, hours: 1, userName: 'ปลอม' }, { token: me });
    expect(e.status).toBe(201);
    expect(e.body.user_name).toBe('มินตรา ใจดี');
    const sub = (await t.api('POST', '/timesheets/week/submit', { start: today }, { token: me })).body;
    expect(sub.userName).toBe('มินตรา ใจดี');
    const weeks = (await t.api('GET', '/timesheet-weeks?status=submitted', undefined, { token: boss })).body;
    const w = weeks.find((x: any) => x.user_id === meId);
    expect(w.user_name).toBe('มินตรา ใจดี');
    const rej = (await t.api('POST', `/timesheet-weeks/${w.id}/reject`, { reason: 'ใส่หมายเหตุ' }, { token: boss })).body;
    expect(rej).toMatchObject({ status: 'draft', rejected_by_name: 'หัวหน้าโครงการ' });
    await t.api('POST', '/timesheets/week/submit', { start: today }, { token: me });
    const ok = (await t.api('POST', `/timesheet-weeks/${w.id}/approve`, {}, { token: boss })).body;
    expect(ok).toMatchObject({ status: 'approved', approved_by_name: 'หัวหน้าโครงการ' });
  });
});
