import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const year = new Date().getFullYear() + 543;
const hoursBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3600000;
const tech = { id: randomUUID(), name: 'ช่างสมศักดิ์' };

/** Move a ticket's deadlines into the past (as if time had passed). */
async function age(id: string) {
  await t.svc.db.tx(t.tenantId, (c) => c.query(`update tickets set due_at = now() - interval '1 hour', response_due_at = now() - interval '2 hours' where id = $1`, [id]));
}

describe('helpdesk categories and SLA', () => {
  let it_cat: any;

  it('creates categories with SLA hours and validates them', async () => {
    const r = await t.api('POST', '/categories', { code: 'IT', name: 'ไอที/คอมพิวเตอร์', slaResponseHours: 2, slaResolveHours: 8, defaultAssigneeId: tech.id, defaultAssigneeName: tech.name });
    expect(r.status).toBe(201);
    it_cat = r.body;
    expect(it_cat).toMatchObject({ code: 'IT', sla_response_hours: 2, sla_resolve_hours: 8 });
    expect((await t.api('POST', '/categories', { code: 'X', name: 'x', slaResponseHours: 10, slaResolveHours: 5 })).status).toBe(400);
    expect((await t.api('POST', '/categories', { code: 'IT', name: 'ซ้ำ' })).status).toBe(409);
    const upd = await t.api('PUT', `/categories/${it_cat.id}`, { code: 'IT', name: 'ไอที', slaResponseHours: 2, slaResolveHours: 8, defaultAssigneeId: tech.id, defaultAssigneeName: tech.name });
    expect(upd.body.name).toBe('ไอที');
    expect((await t.api('GET', '/categories')).body).toHaveLength(1);
  });

  it('computes due times from the category SLA, halves them for urgent, auto-assigns the default technician', async () => {
    const normal = (await t.api('POST', '/tickets', { title: 'คอมเปิดไม่ติด', categoryId: it_cat.id })).body;
    expect(normal).toMatchObject({ no: `TK-${year}-0001`, status: 'open', category_name: 'ไอที', assignee_id: tech.id, assignee_name: tech.name, overdue: false, priority_label: 'ปกติ', channel_label: 'เว็บ' });
    expect(hoursBetween(normal.created_at, normal.response_due_at)).toBeCloseTo(2, 2);
    expect(hoursBetween(normal.created_at, normal.due_at)).toBeCloseTo(8, 2);
    const urgent = (await t.api('POST', '/tickets', { title: 'เซิร์ฟเวอร์ล่ม', categoryId: it_cat.id, priority: 'urgent', channel: 'phone' })).body;
    expect(hoursBetween(urgent.created_at, urgent.due_at)).toBeCloseTo(4, 2);
    expect(hoursBetween(urgent.created_at, urgent.response_due_at)).toBeCloseTo(1, 2);
    const plain = (await t.api('POST', '/tickets', { title: 'ขอเบิกเมาส์', channel: 'walk_in' })).body;
    expect(plain.assignee_id).toBeNull();
    expect(hoursBetween(plain.created_at, plain.due_at)).toBeCloseTo(24, 2); // default SLA
  });

  it('recomputes SLA when a technician changes priority', async () => {
    const tk = (await t.api('GET', '/tickets?q=คอมเปิดไม่ติด')).body[0];
    const r = await t.api('PUT', `/tickets/${tk.id}`, { title: tk.title, categoryId: it_cat.id, priority: 'urgent' });
    expect(r.body.priority).toBe('urgent');
    expect(hoursBetween(r.body.created_at, r.body.due_at)).toBeCloseTo(4, 2);
  });
});

describe('helpdesk ticket lifecycle', () => {
  let tk: any;
  /** one requester identity for the whole flow (created lazily: `t` boots in beforeAll) */
  let requesterToken: string | undefined;
  const requester = () => (requesterToken ??= t.token(['helpdesk.ticket.create', 'helpdesk.kb.read']));

  it('validates input (400)', async () => {
    expect((await t.api('POST', '/tickets', { title: '' })).status).toBe(400);
    expect((await t.api('POST', '/tickets', { title: 'x', priority: 'asap' })).status).toBe(400);
    expect((await t.api('POST', '/tickets', { title: 'x', channel: 'fax' })).status).toBe(400);
    expect((await t.api('POST', '/tickets', { title: 'x', categoryId: randomUUID() })).status).toBe(404);
  });

  it('a requester reports a problem and sees only their own tickets', async () => {
    const r = await t.api('POST', '/tickets', { title: 'ปริ้นเตอร์ชั้น 2 กระดาษติด', requesterName: 'คุณบี', requesterContact: '081-000-0000', channel: 'line', assigneeId: randomUUID() }, { token: requester() });
    expect(r.status).toBe(201);
    tk = r.body;
    expect(tk.assignee_id).toBeNull(); // requesters cannot pick a technician
    expect((await t.api('GET', '/tickets/requested', undefined, { token: requester() })).body.map((x: any) => x.id)).toEqual([tk.id]);
    expect((await t.api('GET', '/tickets', undefined, { token: requester() })).status).toBe(403);
    const others = (await t.api('GET', '/tickets?q=เซิร์ฟเวอร์')).body[0];
    expect((await t.api('GET', `/tickets/${others.id}`, undefined, { token: requester() })).status).toBe(404);
  });

  it('a technician takes it, replies, adds internal notes, waits and the requester answers', async () => {
    const techToken = t.token(['helpdesk.ticket.read', 'helpdesk.ticket.work']);
    const assigned = await t.api('POST', `/tickets/${tk.id}/assign`, { assigneeId: tech.id, assigneeName: tech.name }, { token: techToken });
    expect(assigned.body).toMatchObject({ assignee_name: tech.name, status: 'open' });
    const started = await t.api('POST', `/tickets/${tk.id}/start`, undefined, { token: techToken });
    expect(started.body.status).toBe('in_progress');
    expect(started.body.first_response_at).toBeTruthy();
    expect((await t.api('POST', `/tickets/${tk.id}/start`, undefined, { token: techToken })).status).toBe(409);

    await t.api('POST', `/tickets/${tk.id}/comments`, { body: 'กำลังไปดูครับ', authorName: tech.name }, { token: techToken });
    await t.api('POST', `/tickets/${tk.id}/comments`, { body: 'ลูกยางดึงกระดาษสึก', internal: true }, { token: techToken });
    expect((await t.api('POST', `/tickets/${tk.id}/comments`, { body: 'แอบดู', internal: true }, { token: requester() })).status).toBe(403);
    expect((await t.api('POST', `/tickets/${tk.id}/comments`, { body: '' }, { token: techToken })).status).toBe(400);

    const waiting = await t.api('POST', `/tickets/${tk.id}/wait`, { reason: 'รออะไหล่ลูกยาง' }, { token: techToken });
    expect(waiting.body.status).toBe('waiting');
    expect((await t.api('POST', `/tickets/${tk.id}/wait`, {}, { token: techToken })).status).toBe(409);

    const seenByRequester = (await t.api('GET', `/tickets/${tk.id}`, undefined, { token: requester() })).body;
    expect(seenByRequester.comments.map((c: any) => c.body)).toEqual(['กำลังไปดูครับ', 'รอ: รออะไหล่ลูกยาง']); // no internal notes
    const seenByTech = (await t.api('GET', `/tickets/${tk.id}`, undefined, { token: techToken })).body;
    expect(seenByTech.comments.filter((c: any) => c.internal).map((c: any) => c.kind_label)).toEqual(['บันทึกภายใน', 'บันทึกภายใน']); // assign note + note

    const answered = await t.api('POST', `/tickets/${tk.id}/comments`, { body: 'วันนี้ใช้เครื่องชั้น 3 แทนได้ค่ะ' }, { token: requester() });
    expect(answered.body.status).toBe('in_progress');
  });

  it('resolves, reopens, resolves again and closes with satisfaction', async () => {
    expect((await t.api('POST', `/tickets/${tk.id}/close`, { satisfaction: 5 }, { token: requester() })).status).toBe(409);
    expect((await t.api('POST', `/tickets/${tk.id}/resolve`, {})).status).toBe(400);
    expect((await t.api('POST', `/tickets/${tk.id}/resolve`, { resolution: 'เปลี่ยนลูกยาง' }, { token: requester() })).status).toBe(403);
    const res = await t.api('POST', `/tickets/${tk.id}/resolve`, { resolution: 'เปลี่ยนลูกยางดึงกระดาษ' });
    expect(res.body).toMatchObject({ status: 'resolved', resolution: 'เปลี่ยนลูกยางดึงกระดาษ' });
    expect((await t.api('POST', `/tickets/${tk.id}/resolve`, { resolution: 'x' })).status).toBe(409);

    const re = await t.api('POST', `/tickets/${tk.id}/reopen`, { reason: 'ยังติดอยู่' }, { token: requester() });
    expect(re.body).toMatchObject({ status: 'open', reopen_count: 1, resolved_at: null });
    expect(re.body.comments.at(-1).body).toBe('เปิดเรื่องใหม่: ยังติดอยู่');
    expect((await t.api('POST', `/tickets/${tk.id}/reopen`, {})).status).toBe(409);

    await t.api('POST', `/tickets/${tk.id}/resolve`, { resolution: 'ทำความสะอาดชุดดึงกระดาษ' });
    expect((await t.api('POST', `/tickets/${tk.id}/close`, { satisfaction: 7 }, { token: requester() })).status).toBe(400);
    const closed = await t.api('POST', `/tickets/${tk.id}/close`, { satisfaction: '4', feedback: 'บริการเร็ว' }, { token: requester() });
    expect(closed.body).toMatchObject({ status: 'closed', satisfaction: 4, feedback: 'บริการเร็ว' });
    expect((await t.api('POST', `/tickets/${tk.id}/comments`, { body: 'ขอบคุณ' }, { token: requester() })).status).toBe(409);
    expect((await t.api('POST', `/tickets/${tk.id}/assign`, { assigneeId: tech.id })).status).toBe(409);
    expect((await t.api('PUT', `/tickets/${tk.id}`, { title: 'x' })).status).toBe(409);
  });

  it('flags overdue tickets and lists queues', async () => {
    const late = (await t.api('GET', '/tickets?q=เซิร์ฟเวอร์')).body[0];
    await age(late.id);
    const one = (await t.api('GET', `/tickets/${late.id}`)).body;
    expect(one).toMatchObject({ overdue: true, response_overdue: true });
    expect((await t.api('GET', '/tickets/overdue')).body.map((x: any) => x.id)).toEqual([late.id]);
    expect((await t.api('GET', '/tickets?overdue=1')).body.map((x: any) => x.id)).toEqual([late.id]);
    expect((await t.api('GET', '/tickets?unassigned=1')).body.map((x: any) => x.title)).toEqual(['ขอเบิกเมาส์']);
    expect((await t.api('GET', '/tickets?status=closed')).body).toHaveLength(1);
    expect((await t.api('GET', '/tickets?channel=walk_in')).body).toHaveLength(1);
    const mine = t.token(['helpdesk.ticket.work']);
    const plain = (await t.api('GET', '/tickets?unassigned=1')).body[0];
    await t.api('POST', `/tickets/${plain.id}/start`, undefined, { token: mine });
    expect((await t.api('GET', '/tickets/mine', undefined, { token: mine })).body.map((x: any) => x.id)).toEqual([plain.id]);
  });

  it('summarises the service desk', async () => {
    const s = (await t.api('GET', '/summary')).body;
    expect(s).toMatchObject({ open: 3, overdue: 1, unassigned: 0, resolvedToday: 1, satisfactionAvg: 4 });
    expect(s.avgResolutionHours).toBeGreaterThanOrEqual(0);
    expect(s.months).toHaveLength(6);
    expect(s.months[5]).toMatchObject({ opened: 4, resolved: 1 });
    expect(s.rows.map((r: any) => r.status).sort()).toEqual(['in_progress', 'open', 'open']);
  });
});

describe('helpdesk canned replies and knowledge base', () => {
  it('manages canned replies', async () => {
    const r = await t.api('POST', '/canned-replies', { title: 'รับเรื่องแล้ว', body: 'ได้รับเรื่องแล้ว ช่างจะติดต่อกลับภายใน 2 ชั่วโมง' });
    expect(r.status).toBe(201);
    expect((await t.api('PUT', `/canned-replies/${r.body.id}`, { title: 'รับเรื่องแล้ว', body: 'ได้รับเรื่องแล้วครับ' })).body.body).toBe('ได้รับเรื่องแล้วครับ');
    expect((await t.api('GET', '/canned-replies?q=รับเรื่อง')).body).toHaveLength(1);
    expect((await t.api('POST', '/canned-replies', { title: 'x', body: 'y' }, { token: t.token(['helpdesk.ticket.work']) })).status).toBe(403);
    expect((await t.api('DELETE', `/canned-replies/${r.body.id}`)).body.message).toContain('รับเรื่องแล้ว');
    expect((await t.api('DELETE', `/canned-replies/${r.body.id}`)).status).toBe(404);
  });

  it('publishes knowledge-base articles; readers only see published ones and search them', async () => {
    const reader = t.token(['helpdesk.kb.read']);
    const draft = (await t.api('POST', '/articles', { title: 'วิธีเชื่อมต่อ VPN', body: 'เปิดโปรแกรม FortiClient แล้วใส่รหัสผ่านอีเมล' })).body;
    expect(draft.published).toBe(false);
    expect((await t.api('GET', '/articles', undefined, { token: reader })).body).toHaveLength(0);
    expect((await t.api('GET', `/articles/${draft.id}`, undefined, { token: reader })).status).toBe(404);
    expect((await t.api('POST', `/articles/${draft.id}/publish`)).body.published).toBe(true);
    expect((await t.api('POST', `/articles/${draft.id}/publish`)).status).toBe(409);
    expect((await t.api('GET', '/articles?q=forticlient', undefined, { token: reader })).body).toMatchObject([{ title: 'วิธีเชื่อมต่อ VPN' }]);
    expect((await t.api('GET', `/articles/${draft.id}`, undefined, { token: reader })).body.body).toContain('FortiClient');
    expect((await t.api('GET', '/articles', undefined, { token: reader })).body[0].views).toBe(1);
    expect((await t.api('PUT', `/articles/${draft.id}`, { title: 'วิธีเชื่อมต่อ VPN (ใหม่)', body: 'ใช้ FortiClient 7', published: false })).body.published).toBe(false);
    expect((await t.api('POST', '/articles', { title: 'x', body: 'y' }, { token: reader })).status).toBe(403);
    expect((await t.api('POST', '/articles', { title: '', body: 'y' })).status).toBe(400);
  });
});

describe('helpdesk permissions and tenants', () => {
  it('enforces permissions (403)', async () => {
    const nobody = t.token(['crm.lead.read']);
    expect((await t.api('POST', '/tickets', { title: 'x' }, { token: nobody })).status).toBe(403);
    expect((await t.api('GET', '/summary', undefined, { token: t.token(['helpdesk.ticket.create']) })).status).toBe(403);
    expect((await t.api('POST', '/categories', { code: 'HR', name: 'HR' }, { token: t.token(['helpdesk.ticket.work']) })).status).toBe(403);
    expect((await t.api('GET', '/tickets/mine', undefined, { token: t.token(['helpdesk.ticket.create']) })).status).toBe(403);
  });

  it('isolates tenants', async () => {
    const other = t.token(['*'], t.otherTenantId);
    for (const path of ['/tickets', '/categories', '/articles', '/canned-replies']) {
      expect((await t.api('GET', path, undefined, { token: other })).body).toHaveLength(0);
    }
    const any = (await t.api('GET', '/tickets')).body[0];
    expect((await t.api('GET', `/tickets/${any.id}`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('POST', `/tickets/${any.id}/start`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('GET', '/summary', undefined, { token: other })).body).toMatchObject({ open: 0, overdue: 0, satisfactionAvg: 0 });
    expect((await t.api('POST', '/tickets', { title: 'อีกบริษัท' }, { token: other })).body.no).toBe(`TK-${year}-0001`);
  });
});

describe('helpdesk events (for Automation alerts)', () => {
  it('publishes ticket_created (priority, category, assignee) and ticket_resolved on each resolve', async () => {
    const created = (await t.published('helpdesk.ticket_created')).map((e) => e.data);
    expect(created.find((d: any) => d.title === 'เซิร์ฟเวอร์ล่ม')).toMatchObject({ no: `TK-${year}-0002`, priority: 'urgent', categoryName: 'ไอที', requesterName: null, assigneeName: tech.name });
    expect(created.find((d: any) => d.title === 'ปริ้นเตอร์ชั้น 2 กระดาษติด')).toMatchObject({ priority: 'normal', categoryName: null, requesterName: 'คุณบี', assigneeName: null });
    const resolved = (await t.published('helpdesk.ticket_resolved')).map((e) => e.data).filter((d: any) => d.title === 'ปริ้นเตอร์ชั้น 2 กระดาษติด');
    expect(resolved.map((d: any) => [d.requesterName, d.resolution])).toEqual([['คุณบี', 'เปลี่ยนลูกยางดึงกระดาษ'], ['คุณบี', 'ทำความสะอาดชุดดึงกระดาษ']]);
    const before = (await t.published()).length;
    expect((await t.api('POST', '/tickets', { title: 'x', priority: 'asap' })).status).toBe(400);
    expect((await t.published()).length).toBe(before);
  });
});

describe('helpdesk — QA regressions (docs/uat/bugs-0.3.md)', () => {
  it('HD-01: only the requester rates satisfaction; a technician cannot score their own work', async () => {
    const user = t.token(['helpdesk.ticket.create']);
    const techToken = t.token(['helpdesk.ticket.create', 'helpdesk.ticket.read', 'helpdesk.ticket.work']);
    const tk = (await t.api('POST', '/tickets', { title: 'เครื่องพิมพ์ไม่ออก', priority: 'normal' }, { token: user })).body;
    await t.api('POST', `/tickets/${tk.id}/resolve`, { resolution: 'เปลี่ยนหมึก' }, { token: techToken });
    const rated = await t.api('POST', `/tickets/${tk.id}/close`, { satisfaction: 5, feedback: 'ดีมาก' }, { token: techToken });
    expect(rated.status).toBe(403);
    expect(rated.body.error.message).toContain('เฉพาะผู้แจ้ง');
    expect((await t.api('POST', `/tickets/${tk.id}/close`, {}, { token: techToken })).body).toMatchObject({ status: 'closed', satisfaction: null });
    // a phone ticket keyed in by the technician may carry the caller's score
    const phone = (await t.api('POST', '/tickets', { title: 'อินเทอร์เน็ตช้า', channel: 'phone', requesterName: 'คุณบี' }, { token: techToken })).body;
    await t.api('POST', `/tickets/${phone.id}/resolve`, { resolution: 'รีสตาร์ตเราเตอร์' }, { token: techToken });
    expect((await t.api('POST', `/tickets/${phone.id}/close`, { satisfaction: 4 }, { token: techToken })).body.satisfaction).toBe(4);
  });
});
