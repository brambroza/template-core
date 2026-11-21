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
      code: 'PR', name: 'ขอซื้อ', amountNote: 'เกิน 50,000 ให้ MD อนุมัติ', lockApprovers: false,
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

describe('approvals — who (wave 4)', () => {
  const named = (name: string, perms: string[]) => {
    const id = randomUUID();
    return { id, name, token: t.token(perms, t.tenantId, { userId: id, userName: name }) };
  };
  let mint: ReturnType<typeof named>;
  let boss: ReturnType<typeof named>;
  let deputy: ReturnType<typeof named>;
  let lockedType: any;

  it('takes the requester name from the token, not from the body', async () => {
    mint = named('มินตรา ใจดี', STAFF);
    boss = named('ผู้จัดการขาย', APPROVER);
    deputy = named('รองผู้จัดการ', APPROVER);
    lockedType = (await t.api('POST', '/types', { code: 'PR2', name: 'ขอซื้อ (ล็อก)', approvers: [{ userId: boss.id, userName: boss.name }] })).body;
    expect(lockedType.lock_approvers).toBe(true);
    const r = await t.api('POST', '/requests', { typeId: lockedType.id, title: 'ซื้อโน้ตบุ๊ก', requesterName: 'คนอื่น', submit: true }, { token: mint.token });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ requester_name: 'มินตรา ใจดี', status: 'pending', current_approver_name: 'ผู้จัดการขาย' });
    expect(r.body.history[0]).toMatchObject({ action: 'created', actor_name: 'มินตรา ใจดี' });
    // editing cannot rename the requester either
    const d = (await t.api('POST', '/requests', { typeId: lockedType.id, title: 'ร่าง' }, { token: mint.token })).body;
    const e = await t.api('PUT', `/requests/${d.id}`, { requesterName: 'ปลอม', detail: 'x' }, { token: mint.token });
    expect(e.body.requester_name).toBe('มินตรา ใจดี');
    // an old token without a name falls back to the typed name
    const old = await t.api('POST', '/requests', { typeId: lockedType.id, title: 'เก่า', requesterName: 'สมหญิง' }, { token: t.token(STAFF) });
    expect(old.body.requester_name).toBe('สมหญิง');
    const ev = (await t.published('approvals.request_submitted')).map((x) => x.data).find((x: any) => x.requestId === r.body.id);
    expect(ev).toMatchObject({ requesterName: 'มินตรา ใจดี', requesterId: mint.id, nextApproverId: boss.id });
  });

  it('locks the approver chain: requesters cannot pick or change approvers, admins can', async () => {
    const pick = await t.api('POST', '/requests', { typeId: lockedType.id, title: 'x', approvers: [{ userId: deputy.id, userName: deputy.name }] }, { token: mint.token });
    expect(pick.status).toBe(403);
    expect(pick.body.error.message).toContain('ผู้ขอเลือกผู้อนุมัติเองไม่ได้');
    // sending exactly the type's chain is fine
    expect((await t.api('POST', '/requests', { typeId: lockedType.id, title: 'x', approvers: [{ userId: boss.id }] }, { token: mint.token })).status).toBe(201);
    const d = (await t.api('POST', '/requests', { typeId: lockedType.id, title: 'ร่างล็อก' }, { token: mint.token })).body;
    expect(d).toMatchObject({ lock_approvers: true, can_edit: true, can_change_approvers: false });
    expect((await t.api('PUT', `/requests/${d.id}/approvers`, { approvers: [{ userId: deputy.id }] }, { token: mint.token })).status).toBe(403);
    const admin = named('ผู้ดูแล', [...APPROVER, 'approvals.request.admin']);
    expect((await t.api('PUT', `/requests/${d.id}/approvers`, { approvers: [{ userId: deputy.id, userName: deputy.name }] }, { token: admin.token })).body.step_count).toBe(1);
    // unlock the type → requesters may change it again
    expect((await t.api('PUT', `/types/${lockedType.id}`, { lockApprovers: false })).body.lock_approvers).toBe(false);
    const d2 = (await t.api('GET', `/requests/${d.id}`, undefined, { token: mint.token })).body;
    expect(d2.can_change_approvers).toBe(true);
    await t.api('PUT', `/types/${lockedType.id}`, { lockApprovers: true });
  });

  it('delegates approvals while the approver is away; the delegate acts and the trail says แทน', async () => {
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const r = (await t.api('POST', '/requests', { typeId: lockedType.id, title: 'ซื้อจอ', amount: 4000, submit: true }, { token: mint.token })).body;
    // before delegating: deputy cannot see or act
    expect((await t.api('GET', '/inbox', undefined, { token: deputy.token })).body).toHaveLength(0);
    expect((await t.api('POST', `/requests/${r.id}/approve`, {}, { token: deputy.token })).status).toBe(404);

    // validation and permission
    expect((await t.api('POST', '/delegations', { toUserId: boss.id, startsOn: today, endsOn: today }, { token: boss.token })).status).toBe(400);
    expect((await t.api('POST', '/delegations', { toUserId: deputy.id, startsOn: today, endsOn: '2020-01-01' }, { token: boss.token })).status).toBe(400);
    expect((await t.api('POST', '/delegations', { toUserId: deputy.id, startsOn: today, endsOn: today }, { token: mint.token })).status).toBe(403);
    expect((await t.api('POST', '/delegations', { fromUserId: mint.id, toUserId: deputy.id, startsOn: today, endsOn: today }, { token: boss.token })).status).toBe(403);

    const dg = await t.api('POST', '/delegations', { toUserId: deputy.id, toUserName: deputy.name, startsOn: today, endsOn: '2099-12-31', note: 'ลาพักร้อน' }, { token: boss.token });
    expect(dg.status).toBe(201);
    expect(dg.body).toMatchObject({ from_user_name: 'ผู้จัดการขาย', to_user_name: 'รองผู้จัดการ', status: 'active', active_now: true, can_cancel: true });
    expect((await t.api('POST', '/delegations', { toUserId: mint.id, startsOn: today, endsOn: today }, { token: boss.token })).status).toBe(409); // overlap

    const inbox = (await t.api('GET', '/inbox', undefined, { token: deputy.token })).body;
    expect(inbox.find((x: any) => x.id === r.id)).toMatchObject({ acting_for_name: 'ผู้จัดการขาย', can_act: true, current_delegate_name: 'รองผู้จัดการ' });
    expect((await t.api('GET', '/summary', undefined, { token: deputy.token })).body.waitingForMe).toBeGreaterThanOrEqual(1);
    const seen = (await t.api('GET', `/requests/${r.id}`, undefined, { token: deputy.token })).body;
    expect(seen).toMatchObject({ can_act: true, acting_for_name: 'ผู้จัดการขาย' });

    const ok = await t.api('POST', `/requests/${r.id}/approve`, { note: 'อนุมัติแทน' }, { token: deputy.token });
    expect(ok.body.status).toBe('approved');
    expect(ok.body.steps[0]).toMatchObject({ acted_by: deputy.id, acted_by_name: 'รองผู้จัดการ', on_behalf_of_name: 'ผู้จัดการขาย', acted_by_label: 'รองผู้จัดการ (แทน ผู้จัดการขาย)' });
    expect(ok.body.history.at(-1)).toMatchObject({ actor_name: 'รองผู้จัดการ', on_behalf_of_id: boss.id, action_label: 'อนุมัติ (แทน ผู้จัดการขาย)' });
    const decided = (await t.published('approvals.request_decided')).map((x) => x.data).find((x: any) => x.requestId === r.id);
    expect(decided).toMatchObject({ decision: 'approved', requesterId: mint.id, byName: 'รองผู้จัดการ' });

    // a new request reaching the boss tells the delegate too
    const r2 = (await t.api('POST', '/requests', { typeId: lockedType.id, title: 'ซื้อเมาส์', submit: true }, { token: mint.token })).body;
    const ev = (await t.published('approvals.request_submitted')).map((x) => x.data).find((x: any) => x.requestId === r2.id);
    expect(ev).toMatchObject({ nextApproverId: boss.id, delegateId: deputy.id, delegateName: 'รองผู้จัดการ' });

    // the delegate cannot cancel the delegation; the boss can — then the delegate loses the request
    const list = (await t.api('GET', '/delegations', undefined, { token: deputy.token })).body;
    expect(list.find((x: any) => x.id === dg.body.id)).toMatchObject({ can_cancel: false });
    expect((await t.api('POST', `/delegations/${dg.body.id}/cancel`, {}, { token: deputy.token })).status).toBe(403);
    expect((await t.api('POST', `/delegations/${dg.body.id}/cancel`, {}, { token: boss.token })).body).toMatchObject({ status: 'cancelled', can_cancel: false });
    expect((await t.api('POST', `/requests/${r2.id}/approve`, {}, { token: deputy.token })).status).toBe(404);
    expect((await t.api('GET', '/inbox', undefined, { token: deputy.token })).body).toHaveLength(0);
    // ...but still sees the one they approved
    expect((await t.api('GET', `/requests/${r.id}`, undefined, { token: deputy.token })).status).toBe(200);
    expect((await t.api('GET', '/delegations?status=cancelled', undefined, { token: boss.token })).body).toHaveLength(1);
  });

  it('a delegate who is the requester still cannot approve their own request', async () => {
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const staffApprover = named('พนักงานผู้อนุมัติ', APPROVER);
    await t.api('POST', '/delegations', { toUserId: staffApprover.id, toUserName: staffApprover.name, startsOn: today, endsOn: today }, { token: boss.token });
    const r = (await t.api('POST', '/requests', { typeId: lockedType.id, title: 'ของตัวเอง', submit: true }, { token: staffApprover.token })).body;
    expect(r.can_act).toBe(false);
    expect((await t.api('POST', `/requests/${r.id}/approve`, {}, { token: staffApprover.token })).status).toBe(403);
  });

  it('keeps delegations per tenant', async () => {
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('GET', '/delegations', undefined, { token: other })).body).toEqual([]);
    const any = (await t.api('GET', '/delegations')).body[0];
    expect((await t.api('POST', `/delegations/${any.id}/cancel`, {}, { token: other })).status).toBe(404);
    expect((await t.api('GET', '/delegations', undefined, { token: t.token([]) })).status).toBe(403);
  });
});

describe('decide from LINE (automation.line_decision)', () => {
  const lineDecision = (who: { id: string; name: string }, requestId: string, perms: string[], permsAt = Math.floor(Date.now() / 1000)) => ({
    lineActionId: randomUUID(), userId: who.id, userName: who.name, perms, permsAt, target: 'approvals.request', entityId: requestId, decision: 'approved',
  });
  const results = async (lineActionId: string) => (await t.published('approvals.line_decision_result')).filter((e) => e.data.lineActionId === lineActionId).map((e) => e.data);
  async function pending() {
    const requester = user('ผู้ขอ LINE', STAFF);
    const first = user('หัวหน้า LINE', APPROVER);
    const second = user('MD LINE', APPROVER);
    const type = (await t.api('POST', '/types', { code: `L${Math.floor(Math.random() * 1e6)}`, name: 'ขอซื้อ (LINE)', approvers: [{ userId: first.id, userName: first.name }, { userId: second.id, userName: second.name }] })).body;
    const r = (await t.api('POST', '/requests', { typeId: type.id, title: 'ซื้อสว่าน', amount: 3200, requesterName: requester.name }, { token: requester.token })).body;
    await t.api('POST', `/requests/${r.id}/submit`, undefined, { token: requester.token });
    return { requester, first, second, id: r.id as string, no: r.no as string };
  }

  it('approves as the current approver with the app rules, then tells the next approver and answers in Thai', async () => {
    const p = await pending();
    const ev = lineDecision(p.first, p.id, APPROVER);
    expect((await t.deliver('automation.line_decision', ev)).body.status).toBe('handled');
    const r = (await t.api('GET', `/requests/${p.id}`)).body;
    expect(r).toMatchObject({ status: 'pending', current_step: 2 });
    expect(r.history.find((h: any) => h.action === 'approved')).toMatchObject({ actor_name: 'หัวหน้า LINE', note: 'อนุมัติผ่าน LINE' });
    expect(await results(ev.lineActionId)).toEqual([{ lineActionId: ev.lineActionId, userId: p.first.id, ok: true, message: `✅ อนุมัติคำขอ ${p.no} "ซื้อสว่าน" แล้ว — ส่งต่อขั้นที่ 2/2` }]);
    expect((await t.published('approvals.request_submitted')).some((e) => e.data.requestId === p.id && e.data.step === 2)).toBe(true);
  });

  it('refuses: not the current approver, no approve permission, sessions revoked after the permissions were seen', async () => {
    const p = await pending();
    const notYet = lineDecision(p.second, p.id, APPROVER);
    await t.deliver('automation.line_decision', notYet);
    expect((await results(notYet.lineActionId))[0]).toMatchObject({ ok: false });
    expect((await results(notYet.lineActionId))[0].message).toContain('ยังไม่ใช่ผู้อนุมัติขั้นนี้');

    const noPerm = lineDecision(p.first, p.id, STAFF);
    await t.deliver('automation.line_decision', noPerm);
    expect(await results(noPerm.lineActionId)).toEqual([expect.objectContaining({ ok: false, message: 'บัญชีของคุณไม่มีสิทธิ์อนุมัติคำขอ' })]);

    // roles changed (identity revoked the user's tokens) after automation last saw the permissions
    const seenAt = Math.floor(Date.now() / 1000) - 60;
    await t.deliver('identity.tokens_revoked', { userId: p.first.id, before: seenAt + 30, reason: 'roles_changed' });
    const stale = lineDecision(p.first, p.id, APPROVER, seenAt);
    await t.deliver('automation.line_decision', stale);
    expect((await results(stale.lineActionId))[0]).toMatchObject({ ok: false });
    expect((await results(stale.lineActionId))[0].message).toContain('เปลี่ยนไป');
    expect((await t.api('GET', `/requests/${p.id}`)).body).toMatchObject({ status: 'pending', current_step: 1 });

    // other modules' targets are ignored
    const other = { ...lineDecision(p.first, p.id, APPROVER), target: 'hr.leave' };
    await t.deliver('automation.line_decision', other);
    expect(await results(other.lineActionId)).toEqual([]);
  });
});
