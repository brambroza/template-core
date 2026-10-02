import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signToken } from '@erp/kernel';
import { bootTestService, TEST_JWT_SECRET, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const STAFF = ['approvals.request.read', 'approvals.request.write'];
const APPROVER = [...STAFF, 'approvals.request.approve'];
const user = (name: string, perms: string[]) => {
  const id = randomUUID();
  return { id, name, token: signToken(TEST_JWT_SECRET, { tenantId: t.tenantId, userId: id, perms }) };
};

let somchai: ReturnType<typeof user>; // requester
let head: ReturnType<typeof user>; // step 1
let md: ReturnType<typeof user>; // step 2
let typeId: string;

describe('approvals', () => {
  it('sets up request types with a default approver chain', async () => {
    somchai = user('สมชาย', STAFF);
    head = user('หัวหน้าแผนก', APPROVER);
    md = user('MD', APPROVER);
    const res = await t.api('POST', '/types', {
      code: 'PR', name: 'ขอซื้อ', amountNote: 'เกิน 50,000 ให้ MD อนุมัติ',
      approvers: [{ userId: head.id, userName: head.name }, { userId: md.id, userName: md.name }],
    });
    expect(res.status).toBe(201);
    typeId = res.body.id;
    expect(res.body.approvers).toHaveLength(2);
    const list = await t.api('GET', '/types?active=true&q=PR');
    expect(list.body[0]).toMatchObject({ code: 'PR', step_count: 2, chain: 'หัวหน้าแผนก → MD' });
    expect((await t.api('POST', '/types', { code: 'PR', name: 'ซ้ำ' })).status).toBe(409);
    expect((await t.api('POST', '/types', { code: '', name: 'x' })).status).toBe(400);
    expect((await t.api('POST', '/types', { code: 'X', name: 'x', approvers: [{ userId: head.id }, { userId: head.id }] })).status).toBe(400);
    expect((await t.api('POST', '/types', { code: 'X', name: 'x' }, { token: somchai.token })).status).toBe(403);
  });

  it('routes a request step by step until approved, with history', async () => {
    const created = await t.api('POST', '/requests', { typeId, title: 'ซื้อเครื่องพิมพ์', amount: 12500, neededBy: '2026-10-30', requesterName: 'สมชาย', department: 'บัญชี' }, { token: somchai.token });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ no: 'APV-2569-0001', status: 'draft', step_count: 2, current_step: 0, can_submit: true, can_act: false, type_name: 'ขอซื้อ' });
    const id = created.body.id;

    const sub = await t.api('POST', `/requests/${id}/submit`, undefined, { token: somchai.token });
    expect(sub.body).toMatchObject({ status: 'pending', current_step: 1, current_approver_name: 'หัวหน้าแผนก' });
    expect((await t.api('POST', `/requests/${id}/submit`, undefined, { token: somchai.token })).status).toBe(409);

    // only the current step's approver may act
    expect((await t.api('POST', `/requests/${id}/approve`, {}, { token: md.token })).status).toBe(403);
    expect((await t.api('GET', '/inbox', undefined, { token: md.token })).body).toHaveLength(0);
    const inbox = await t.api('GET', '/inbox', undefined, { token: head.token });
    expect(inbox.body.map((r: any) => r.no)).toEqual(['APV-2569-0001']);
    expect(inbox.body[0].can_act).toBe(true);
    expect((await t.api('GET', `/requests/${id}`, undefined, { token: head.token })).body.can_act).toBe(true);

    const s1 = await t.api('POST', `/requests/${id}/approve`, { note: 'ok' }, { token: head.token });
    expect(s1.body).toMatchObject({ status: 'pending', current_step: 2, current_approver_name: 'MD', step_text: 'ขั้นที่ 2/2' });
    const s2 = await t.api('POST', `/requests/${id}/approve`, {}, { token: md.token });
    expect(s2.body).toMatchObject({ status: 'approved', current_step: 0, can_act: false, can_cancel: false });
    expect(s2.body.decided_at).toBeTruthy();
    expect(s2.body.steps.map((st: any) => st.status)).toEqual(['approved', 'approved']);
    expect(s2.body.history.map((h: any) => h.action)).toEqual(['created', 'submitted', 'approved', 'approved']);
    expect(s2.body.history[2]).toMatchObject({ actor_name: 'หัวหน้าแผนก', action_label: 'อนุมัติ', step_no: 1, note: 'ok' });

    expect((await t.api('POST', `/requests/${id}/approve`, {}, { token: md.token })).status).toBe(409);
    expect((await t.api('POST', `/requests/${id}/cancel`, {}, { token: somchai.token })).status).toBe(409);
    const comment = await t.api('POST', `/requests/${id}/comment`, { note: 'สั่งซื้อแล้ว' }, { token: somchai.token });
    expect(comment.body.history.at(-1)).toMatchObject({ action: 'commented', actor_name: 'สมชาย', note: 'สั่งซื้อแล้ว' });
  });

  it('returns for edit, lets the requester fix and resubmit, then rejects with a reason', async () => {
    const r = (await t.api('POST', '/requests', { typeId, title: 'ขอใช้งบอบรม', amount: 8000, requesterName: 'สมชาย', submit: true }, { token: somchai.token })).body;
    expect(r.status).toBe('pending');
    expect((await t.api('POST', `/requests/${r.id}/return`, {}, { token: head.token })).status).toBe(400); // reason required
    const ret = await t.api('POST', `/requests/${r.id}/return`, { note: 'แนบใบเสนอราคา' }, { token: head.token });
    expect(ret.body).toMatchObject({ status: 'returned', last_note: 'แนบใบเสนอราคา', can_edit: false, can_act: false });
    expect((await t.api('GET', `/requests/${r.id}`, undefined, { token: somchai.token })).body).toMatchObject({ can_edit: true, can_submit: true });

    // only the requester edits
    expect((await t.api('PUT', `/requests/${r.id}`, { amount: 7500 }, { token: head.token })).status).toBe(403);
    const edited = await t.api('PUT', `/requests/${r.id}`, { amount: 7500, detail: 'แนบใบเสนอราคาแล้ว' }, { token: somchai.token });
    expect(edited.body).toMatchObject({ amount: 7500, detail: 'แนบใบเสนอราคาแล้ว', title: 'ขอใช้งบอบรม' });
    // change the chain to MD only
    const ch = await t.api('PUT', `/requests/${r.id}/approvers`, { approvers: [{ userId: md.id, userName: 'MD' }] }, { token: somchai.token });
    expect(ch.body.step_count).toBe(1);

    const again = await t.api('POST', `/requests/${r.id}/submit`, undefined, { token: somchai.token });
    expect(again.body).toMatchObject({ status: 'pending', current_step: 1, current_approver_name: 'MD' });
    expect((await t.api('PUT', `/requests/${r.id}`, { amount: 1 }, { token: somchai.token })).status).toBe(409);
    expect((await t.api('POST', `/requests/${r.id}/reject`, {}, { token: md.token })).status).toBe(400);
    const rej = await t.api('POST', `/requests/${r.id}/reject`, { note: 'งบหมด' }, { token: md.token });
    expect(rej.body).toMatchObject({ status: 'rejected', last_note: 'งบหมด' });
    expect(rej.body.history.map((h: any) => h.action)).toEqual(['created', 'submitted', 'returned', 'edited', 'approvers_changed', 'submitted', 'rejected']);
  });

  it('cancels while undecided, and refuses submitting without approvers', async () => {
    const memo = (await t.api('POST', '/types', { code: 'MEMO', name: 'บันทึกข้อความ' })).body;
    const r = (await t.api('POST', '/requests', { typeId: memo.id, title: 'แจ้งวันหยุด' }, { token: somchai.token })).body;
    expect((await t.api('POST', `/requests/${r.id}/submit`, undefined, { token: somchai.token })).status).toBe(400);
    expect((await t.api('POST', `/requests/${r.id}/cancel`, {}, { token: head.token })).status).toBe(404); // not visible to head
    const c = await t.api('POST', `/requests/${r.id}/cancel`, { note: 'ไม่ใช้แล้ว' }, { token: somchai.token });
    expect(c.body.status).toBe('cancelled');
    expect((await t.api('POST', `/requests/${r.id}/submit`, undefined, { token: somchai.token })).status).toBe(409);

    await t.api('PUT', `/types/${memo.id}`, { active: false });
    expect((await t.api('POST', '/requests', { typeId: memo.id, title: 'x' }, { token: somchai.token })).status).toBe(409);
    expect((await t.api('DELETE', `/types/${memo.id}`)).status).toBe(409); // used
    const tmp = (await t.api('POST', '/types', { code: 'TMP', name: 'ชั่วคราว' })).body;
    expect((await t.api('DELETE', `/types/${tmp.id}`)).body.deleted).toBe(true);
  });

  it('lets an approvals admin act on any step', async () => {
    const r = (await t.api('POST', '/requests', { typeId, title: 'ขอเดินทางไปลูกค้า', submit: true }, { token: somchai.token })).body;
    const admin = user('admin', ['approvals.request.read', 'approvals.request.approve', 'approvals.request.admin']);
    expect((await t.api('POST', `/requests/${r.id}/approve`, {}, { token: admin.token })).body.current_step).toBe(2);
    expect((await t.api('POST', `/requests/${r.id}/approve`, {}, { token: admin.token })).body.status).toBe('approved');
  });

  it('shows my requests, the visible set, and a summary', async () => {
    const mine = await t.api('GET', '/my-requests', undefined, { token: somchai.token });
    expect(mine.body.length).toBe(4);
    expect((await t.api('GET', '/requests?mine=1&status=approved', undefined, { token: somchai.token })).body).toHaveLength(2);
    expect((await t.api('GET', '/requests?q=อบรม', undefined, { token: somchai.token })).body).toHaveLength(1);
    expect((await t.api('GET', '/my-requests', undefined, { token: head.token })).body).toHaveLength(0);
    // head sees only requests where they are on the chain (the memo and the MD-only one are hidden)
    const seen = (await t.api('GET', '/requests', undefined, { token: head.token })).body;
    expect(seen).toHaveLength(2);
    // a stranger sees nothing and gets 404 on a direct link
    const stranger = user('อื่น', STAFF);
    expect((await t.api('GET', '/requests', undefined, { token: stranger.token })).body).toHaveLength(0);
    expect((await t.api('GET', `/requests/${mine.body[0].id}`, undefined, { token: stranger.token })).status).toBe(404);

    const pending = (await t.api('POST', '/requests', { typeId, title: 'ขอซื้อเก้าอี้', submit: true }, { token: somchai.token })).body;
    const sum = await t.api('GET', '/summary', undefined, { token: head.token });
    expect(sum.body).toMatchObject({ waitingForMe: 1, pendingTotal: 1 });
    const all = await t.api('GET', '/summary');
    expect(all.body).toMatchObject({ pendingTotal: 1, approvedThisMonth: 2, rejectedThisMonth: 1, approvedAmountThisMonth: 12500 });
    expect(all.body.months).toHaveLength(6);
    expect(all.body.months[5].submitted).toBeGreaterThanOrEqual(4);
    expect(typeof all.body.avgHoursToDecide).toBe('number');
    expect(all.body.rows.find((r: any) => r.id === pending.id)).toMatchObject({ status: 'pending', current_approver_name: 'หัวหน้าแผนก' });
  });

  it('requires permissions', async () => {
    const reader = t.token(['approvals.request.read']);
    expect((await t.api('POST', '/requests', { typeId, title: 'x' }, { token: reader })).status).toBe(403);
    const noApprove = t.token(STAFF);
    const any = (await t.api('GET', '/requests')).body[0];
    expect((await t.api('POST', `/requests/${any.id}/approve`, {}, { token: noApprove })).status).toBe(403);
    expect((await t.api('GET', '/inbox', undefined, { token: t.token([]) })).status).toBe(403);
  });

  it('keeps tenants apart', async () => {
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('GET', '/types', undefined, { token: other })).body).toEqual([]);
    expect((await t.api('GET', '/requests', undefined, { token: other })).body).toEqual([]);
    expect((await t.api('POST', '/requests', { typeId, title: 'x' }, { token: other })).status).toBe(404);
    expect((await t.api('GET', '/summary', undefined, { token: other })).body.pendingTotal).toBe(0);
  });
});

describe('approvals events (for Automation alerts)', () => {
  it('tells each next approver, and the requester about the final outcome, through the outbox', async () => {
    const sub = (await t.published('approvals.request_submitted')).map((e) => e.data).filter((d: any) => d.no === 'APV-2569-0001');
    expect(sub).toEqual([
      expect.objectContaining({ title: 'ซื้อเครื่องพิมพ์', typeName: 'ขอซื้อ', requesterName: 'สมชาย', amount: 12500, nextApproverId: head.id, nextApproverName: 'หัวหน้าแผนก', step: 1, stepCount: 2 }),
      expect.objectContaining({ nextApproverId: md.id, nextApproverName: 'MD', step: 2, stepCount: 2 }),
    ]);
    const decided = (await t.published('approvals.request_decided')).map((e) => e.data);
    expect(decided.find((d: any) => d.no === 'APV-2569-0001')).toMatchObject({ decision: 'approved', requesterId: somchai.id, requesterName: 'สมชาย', byName: 'MD', note: null });
    expect(decided.filter((d: any) => d.no === 'APV-2569-0002').map((d: any) => [d.decision, d.note])).toEqual([['returned', 'แนบใบเสนอราคา'], ['rejected', 'งบหมด']]);
    // a refused action publishes nothing
    const before = (await t.published()).length;
    const r = (await t.api('POST', '/requests', { typeId, title: 'ไม่มีสิทธิ์', submit: true }, { token: somchai.token })).body;
    expect((await t.api('POST', `/requests/${r.id}/approve`, {}, { token: md.token })).status).toBe(403);
    expect((await t.published()).length).toBe(before + 1); // only the submit
  });
});

describe('approvals — QA regressions (docs/uat/bugs-0.3.md)', () => {
  it('APV-01: a requester on their own chain cannot approve their own request, not even as an admin', async () => {
    const boss = user('ผู้จัดการ', [...APPROVER, 'approvals.request.admin']);
    const other = user('ผู้อนุมัติแทน', APPROVER);
    const r = (await t.api('POST', '/requests', {
      typeId, title: 'ขอซื้อพัดลม', amount: 1500, submit: true,
      approvers: [{ userId: boss.id, userName: 'ผู้จัดการ' }, { userId: other.id, userName: 'ผู้อนุมัติแทน' }],
    }, { token: boss.token })).body;
    expect(r).toMatchObject({ status: 'pending', current_step: 1, can_act: false });
    const self = await t.api('POST', `/requests/${r.id}/approve`, {}, { token: boss.token });
    expect(self.status).toBe(403);
    expect(self.body.error.message).toContain('อนุมัติคำขอของตนเองไม่ได้');
    expect((await t.api('GET', '/inbox', undefined, { token: boss.token })).body.find((x: any) => x.id === r.id)).toMatchObject({ can_act: false });
    // another admin (not the requester) can still take the stuck step
    const admin2 = user('admin2', ['approvals.request.read', 'approvals.request.approve', 'approvals.request.admin']);
    expect((await t.api('POST', `/requests/${r.id}/approve`, {}, { token: admin2.token })).body.current_step).toBe(2);
    expect((await t.api('POST', `/requests/${r.id}/approve`, {}, { token: other.token })).body.status).toBe('approved');
  });
});
