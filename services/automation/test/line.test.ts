import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';
import { makeWebhookKey, normalizeText, parseCommand, parseWebhookKey, verifyLineSignature } from '../src/line.ts';

const SECRET = 'line-channel-secret';
let t: TestService;
let server: Server;
let base = '';
/** what the mock LINE API received */
const received: { method: string; path: string; body: any }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      received.push({ method: req.method ?? '', path: req.url ?? '', body: raw ? JSON.parse(raw) : null });
      if (req.url?.startsWith('/v2/bot/profile/')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ displayName: `LINE ${decodeURIComponent(req.url.slice(16))}` }));
        return;
      }
      res.writeHead(req.url?.includes('fail') || JSON.stringify(raw).includes('Ublocked') ? 400 : 200).end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t = await bootTestService(definition, { LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'line-token', LINE_API_URL: base, LINE_OA_ID: '@goalong', PUBLIC_APP_URL: 'https://erp.example.co.th' });
});
afterAll(async () => { await t?.close(); server?.close(); });

const sign = (raw: string, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('base64');
/** POST the webhook exactly as LINE does: raw bytes + signature over those bytes */
const hook = (key: string, body: unknown, opts: { sig?: string | null; raw?: string } = {}) => {
  const raw = opts.raw ?? JSON.stringify(body);
  return t.svc.app.inject({
    method: 'POST', url: `/line/webhook/${key}`, payload: raw,
    headers: { 'content-type': 'application/json', ...(opts.sig === null ? {} : { 'x-line-signature': opts.sig ?? sign(raw) }) },
  });
};
const msg = (userId: string, text: string) => ({
  type: 'message', mode: 'active', timestamp: Date.now(), webhookEventId: randomUUID(), deliveryContext: { isRedelivery: false },
  replyToken: `rt-${randomUUID()}`, source: { type: 'user', userId }, message: { type: 'text', id: '1', text },
});
/** send one text message, return the bot's reply text (or null) */
const say = async (key: string, userId: string, text: string) => {
  const ev = msg(userId, text);
  const r = await hook(key, { destination: 'Ubot', events: [ev] });
  expect(r.statusCode, r.body).toBe(200);
  return received.find((x) => x.path === '/v2/bot/message/reply' && x.body.replyToken === ev.replyToken)?.body.messages[0].text ?? null;
};
const pushesTo = (lineUserId: string) => received.filter((x) => x.path === '/v2/bot/message/push' && x.body.to === lineUserId).map((x) => x.body.messages[0].text as string);

/** a tenant with LINE set up: admin token, webhook key */
async function setup(tid = randomUUID()) {
  const admin = t.token(['*'], tid);
  const s = await t.api('GET', '/line/settings', undefined, { token: admin });
  expect(s.status).toBe(200);
  return { tid, admin, key: (s.body.webhook_url as string).split('/').pop()!, settings: s.body };
}
const user = (tid: string, name = 'สมชาย ใจดี') => {
  const userId = randomUUID();
  return { userId, token: t.token(['automation.notify.read'], tid, { userId, userName: name }) };
};
async function link(key: string, tid: string, lineUserId: string, name?: string) {
  const u = user(tid, name);
  const code = (await t.api('POST', '/line/link-code', {}, { token: u.token })).body.code;
  expect(await say(key, lineUserId, `ผูกบัญชี ${code}`)).toContain('ผูกบัญชีเรียบร้อย');
  return u;
}

describe('LINE helpers', () => {
  it('verifies signatures over the raw bytes, constant-time, and parses keys and Thai commands', () => {
    const raw = Buffer.from('{"events":[]}');
    expect(verifyLineSignature(SECRET, raw, sign(raw.toString()))).toBe(true);
    expect(verifyLineSignature(SECRET, Buffer.from('{"events": []}'), sign(raw.toString()))).toBe(false); // one space differs
    expect(verifyLineSignature(SECRET, raw, sign(raw.toString(), 'other'))).toBe(false);
    expect(verifyLineSignature(SECRET, raw, undefined)).toBe(false);
    expect(verifyLineSignature(undefined, raw, sign(raw.toString()))).toBe(false);
    expect(verifyLineSignature(SECRET, raw, 'not base64 at all')).toBe(false);
    const tid = randomUUID();
    expect(parseWebhookKey(makeWebhookKey(tid, 'ab'.repeat(16)))).toEqual({ tenantId: tid, secret: 'ab'.repeat(16) });
    expect(parseWebhookKey('../../x')).toBeNull();
    expect(normalizeText('  ผูกบัญชี   ๑๒๓๔๕๖ ')).toBe('ผูกบัญชี 123456');
    expect(parseCommand('ผูกบัญชี ๑๒๓๔๕๖')).toEqual({ kind: 'link', code: '123456' });
    expect(parseCommand('ผูกบัญชี123456')).toEqual({ kind: 'link', code: '123456' });
    expect(parseCommand('654321')).toEqual({ kind: 'link', code: '654321' });
    expect(parseCommand('ผูกบัญชี 12345')).toBeNull();
    expect(parseCommand('แจ้งเตือน')).toEqual({ kind: 'notifications' });
    expect(parseCommand('ยกเลิกผูกบัญชี')).toEqual({ kind: 'unlink' });
    expect(parseCommand('ช่วยเหลือ')).toEqual({ kind: 'help' });
    expect(parseCommand('สวัสดีครับ สั่งของหน่อย')).toBeNull();
  });
});

describe('LINE webhook', () => {
  it('rejects missing/invalid signatures and unknown keys; answers LINE "Verify" with 200', async () => {
    const { key } = await setup();
    expect((await hook(key, { events: [] }, { sig: null })).statusCode).toBe(401);
    expect((await hook(key, { events: [] }, { sig: sign('{"events":[]}', 'wrong-secret') })).statusCode).toBe(401);
    // valid signature over different bytes (tampered body)
    expect((await hook(key, { events: [] }, { raw: '{"events":[1]}', sig: sign('{"events":[]}') })).statusCode).toBe(401);
    expect((await hook('f'.repeat(64), { events: [] })).statusCode).toBe(404);
    expect((await hook('nope', { events: [] })).statusCode).toBe(404);
    // the exact bytes count, not the JSON value: pretty-printed body with its own signature is fine
    const verify = await hook(key, null, { raw: '{\n  "destination": "Ubot",\n  "events": []\n}' });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ ok: true, handled: 0 });
  });

  it('refuses webhooks when LINE_CHANNEL_SECRET is not configured', async () => {
    const bare = await bootTestService(definition, {});
    try {
      const admin = bare.token(['*']);
      const s = (await bare.api('GET', '/line/settings', undefined, { token: admin })).body;
      expect(s).toMatchObject({ ready: false, channel_secret_set: false, access_token_set: false });
      expect(s.status).toContain('LINE_CHANNEL_SECRET');
      const raw = '{"events":[]}';
      const r = await bare.svc.app.inject({ method: 'POST', url: `/line/webhook/${s.webhook_url.split('/').pop()}`, payload: raw, headers: { 'content-type': 'application/json', 'x-line-signature': sign(raw) } });
      expect(r.statusCode).toBe(503);
    } finally {
      await bare.close();
    }
  });

  it('links a LINE user with a one-time code (Thai digits ok), single use, 10 minutes', async () => {
    const { tid, key } = await setup();
    const u = user(tid, 'สมหญิง');
    expect((await t.api('GET', '/line/me', undefined, { token: u.token })).body).toMatchObject({ linked: false, code: null, status: 'ยังไม่ได้ผูก LINE' });
    const c = await t.api('POST', '/line/link-code', {}, { token: u.token });
    expect(c.status).toBe(201);
    expect(c.body.code).toMatch(/^\d{6}$/);
    expect(c.body).toMatchObject({ send_text: `ผูกบัญชี ${c.body.code}`, add_friend_url: 'https://line.me/R/ti/p/%40goalong' });
    const minutes = (new Date(c.body.code_expires_at).getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThanOrEqual(10);
    // a new code replaces the old one
    const c2 = (await t.api('POST', '/line/link-code', {}, { token: u.token })).body.code;
    if (c2 !== c.body.code) expect(await say(key, 'Uold', `ผูกบัญชี ${c.body.code}`)).toContain('ไม่ถูกต้อง');

    const thai = c2.replace(/\d/g, (d: string) => String.fromCharCode(0x0e50 + Number(d)));
    const reply = await say(key, 'Usomying', `ผูกบัญชี ${thai}`);
    expect(reply).toContain('ผูกบัญชีเรียบร้อย คุณจะได้รับแจ้งเตือนส่วนตัวทาง LINE');
    expect(reply).toContain('สมหญิง');
    expect((await t.api('GET', '/line/me', undefined, { token: u.token })).body).toMatchObject({ linked: true, line_name: 'LINE Usomying', code: null, status: 'ผูก LINE แล้ว' });
    // LINE re-delivers the same message → same friendly answer; someone else cannot reuse the code
    expect(await say(key, 'Usomying', `ผูกบัญชี ${c2}`)).toContain('ผูกบัญชีเรียบร้อย');
    expect(await say(key, 'Uother', `ผูกบัญชี ${c2}`)).toContain('ไม่ถูกต้องหรือหมดอายุ');
    // an expired code does not work
    const late = user(tid);
    const lc = (await t.api('POST', '/line/link-code', {}, { token: late.token })).body.code;
    await t.svc.db.tx(tid, (cl) => cl.query(`update line_link_codes set expires_at = now() - interval '1 minute' where code = $1`, [lc]));
    expect(await say(key, 'Ulate', `ผูกบัญชี ${lc}`)).toContain('หมดอายุ');
  });

  it('stops guessing after 5 wrong codes in 15 minutes', async () => {
    const { tid, key } = await setup();
    for (let i = 0; i < 5; i++) expect(await say(key, 'Uguess', `ผูกบัญชี ${String(i).padStart(6, '0')}`)).toContain('ไม่ถูกต้อง');
    const u = user(tid);
    const code = (await t.api('POST', '/line/link-code', {}, { token: u.token })).body.code;
    expect(await say(key, 'Uguess', `ผูกบัญชี ${code}`)).toContain('รอ 15 นาที');
    expect((await t.api('GET', '/line/me', undefined, { token: u.token })).body.linked).toBe(false);
    // the code is still good for the real LINE account
    expect(await say(key, 'Ureal', `ผูกบัญชี ${code}`)).toContain('ผูกบัญชีเรียบร้อย');
  });

  it('SEC-09 (security review 0.3): stops guessing with many LINE accounts after 30 wrong codes per company', async () => {
    const { tid, key } = await setup();
    for (let i = 0; i < 30; i++) expect(await say(key, `Ubot${i}`, `ผูกบัญชี ${String(i).padStart(6, '0')}`)).toContain('ไม่ถูกต้อง');
    const u = user(tid);
    const code = (await t.api('POST', '/line/link-code', {}, { token: u.token })).body.code;
    expect(await say(key, 'Ufresh', `ผูกบัญชี ${code}`)).toContain('พักการผูกบัญชีชั่วคราว');
    expect((await t.api('GET', '/line/me', undefined, { token: u.token })).body.linked).toBe(false);
  });

  it('answers commands: แจ้งเตือน, ช่วยเหลือ, ยกเลิกผูกบัญชี; ignores chit-chat; group id in groups; unfollow unlinks', async () => {
    const { tid, admin, key } = await setup();
    expect(await say(key, 'Ustranger', 'แจ้งเตือน')).toContain('ยังไม่ได้ผูก');
    expect(await say(key, 'Ustranger', 'ช่วยเหลือ')).toContain('ผูกบัญชี 123456');
    expect(await say(key, 'Ustranger', 'สวัสดีครับ ขอใบเสนอราคา')).toBeNull();

    const u = await link(key, tid, 'Ucmd');
    expect(await say(key, 'Ucmd', 'แจ้งเตือน')).toBe('ยังไม่มีการแจ้งเตือนส่วนตัวถึงคุณ');
    await t.api('POST', '/templates/approval-approved/apply', {}, { token: admin });
    for (const no of ['APV-1', 'APV-2']) {
      await t.deliver('approvals.request_decided', { requestId: randomUUID(), no, title: 'ซื้อจอ', decision: 'approved', requesterId: u.userId, requesterName: 'ก', byName: 'คุณวิภา', note: null }, { tenantId: tid });
    }
    const list = await say(key, 'Ucmd', 'แจ้งเตือน');
    expect(list).toContain('การแจ้งเตือนล่าสุดของคุณ');
    expect(list!.indexOf('APV-2')).toBeLessThan(list!.indexOf('APV-1')); // newest first

    // groups: only the group-id question is answered
    const inGroup = (text: string, type = 'message') => ({ ...msg('Ucmd', text), type, source: { type: 'group', groupId: 'Cgroup1', userId: 'Ucmd' } });
    const g = inGroup('ไอดีกลุ่ม');
    await hook(key, { events: [g, inGroup('แจ้งเตือน'), inGroup('', 'join')] });
    const replies = received.filter((x) => x.path === '/v2/bot/message/reply');
    expect(replies.find((x) => x.body.replyToken === g.replyToken)!.body.messages[0].text).toContain('Cgroup1');

    expect(await say(key, 'Ucmd', 'ยกเลิกผูกบัญชี')).toContain('ยกเลิกการผูกบัญชีแล้ว');
    expect((await t.api('GET', '/line/me', undefined, { token: u.token })).body.linked).toBe(false);

    const u2 = await link(key, tid, 'Ublock');
    await hook(key, { events: [{ type: 'unfollow', mode: 'active', timestamp: Date.now(), source: { type: 'user', userId: 'Ublock' } }] });
    expect((await t.api('GET', '/line/me', undefined, { token: u2.token })).body.linked).toBe(false);
  });
});

describe('personal LINE delivery', () => {
  it('pushes to the linked LINE of the person in the event; records who is not linked', async () => {
    const { tid, admin, key } = await setup();
    const requester = await link(key, tid, 'Ureq');
    const r = await t.api('POST', '/templates/approval-approved/apply', {}, { token: admin });
    expect(r.body.summary).toMatch(/ให้แจ้งเตือนในแอป \(ถึงผู้ขอ\) \+ ส่ง LINE ส่วนตัว \(ถึงผู้ขอ\)$/);
    const requestId = randomUUID();
    await t.deliver('approvals.request_decided', { requestId, no: 'APV-9', title: 'ซื้อโน้ตบุ๊ก', decision: 'approved', requesterId: requester.userId, requesterName: 'ก', byName: 'คุณวิภา', note: null }, { tenantId: tid });
    const pushed = pushesTo('Ureq');
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toContain('คำขอได้รับการอนุมัติ แจ้งผู้ขอ\n✅ คำขอ APV-9 "ซื้อโน้ตบุ๊ก" ของคุณได้รับการอนุมัติแล้ว (โดย คุณวิภา)');
    expect(pushed[0]).toContain(`เปิดดู: https://erp.example.co.th/m/approvals/requestDetail/${requestId}`);
    // still in the bell too
    expect((await t.api('GET', '/notifications', undefined, { token: requester.token })).body.unread).toBe(1);
    let runs = (await t.api('GET', '/runs', undefined, { token: admin })).body;
    expect(runs[0]).toMatchObject({ status: 'done', detail: expect.stringContaining('LINE ส่วนตัว (ถึงผู้ขอ): ส่งแล้ว 1 คน') });

    // someone who never linked LINE: in-app only, and the run says so
    const before = received.length;
    await t.deliver('approvals.request_decided', { requestId: randomUUID(), no: 'APV-10', title: 'x', decision: 'approved', requesterId: randomUUID(), requesterName: 'ข', byName: 'คุณวิภา', note: null }, { tenantId: tid });
    expect(received.slice(before).filter((x) => x.path === '/v2/bot/message/push')).toHaveLength(0);
    runs = (await t.api('GET', '/runs', undefined, { token: admin })).body;
    expect(runs[0]).toMatchObject({ status: 'done', detail: expect.stringContaining('ผู้รับยังไม่ได้ผูก LINE 1 คน') });
  });

  it('records a failed push (e.g. the user blocked the OA) as failed', async () => {
    const { tid, admin, key } = await setup();
    const u = await link(key, tid, 'Ublocked');
    await t.api('POST', '/templates/expense-paid-to-claimant/apply', {}, { token: admin });
    await t.deliver('expense.claim_paid', { claimId: randomUUID(), no: 'EXP-1', claimantName: 'มาลี', total: 4200, claimantId: u.userId }, { tenantId: tid });
    const runs = (await t.api('GET', '/runs', undefined, { token: admin })).body;
    expect(runs[0]).toMatchObject({ status: 'failed', detail: expect.stringContaining('ไม่สำเร็จ 1 คน (HTTP 400') });
  });

  it('builds personal LINE rules from the simple form; validates LINE recipients', async () => {
    const { tid, admin, key } = await setup();
    const boss = await link(key, tid, 'Uboss');
    const rule = await t.api('POST', '/rules/simple', { name: 'ลีดถึงหัวหน้า', eventType: 'crm.lead_created', actionType: 'line', to: 'all', toUserId: boss.userId }, { token: admin });
    expect(rule.status).toBe(201);
    expect(rule.body.actions).toEqual([expect.objectContaining({ type: 'line', to: `user:${boss.userId}` })]);
    expect(rule.body.summary).toBe('เมื่อมีลีดใหม่ ให้ส่ง LINE ส่วนตัว (ถึงผู้ใช้ที่เลือก)');
    await t.deliver('crm.lead_created', { leadId: randomUUID(), no: 'LD-7', company: 'สยามพาร์ท', contactName: 'คุณเอ', source: 'line' }, { tenantId: tid });
    expect(pushesTo('Uboss').some((x) => x.includes('LD-7'))).toBe(true);
    const bad = (actions: unknown[]) => t.api('POST', '/rules', { name: 'x', eventType: 'approvals.request_decided', actions }, { token: admin });
    expect((await bad([{ type: 'line', to: 'all' }])).status).toBe(400);
    expect((await bad([{ type: 'line', to: 'field:requesterId', target: 'Cgroup' }])).status).toBe(400);
    expect((await bad([{ type: 'line', to: 'field:nextApproverId' }])).status).toBe(400); // not a user field of this event
    expect((await bad([{ type: 'webhook', to: 'field:requesterId', target: 'https://x.example.com' }])).status).toBe(400);
    expect((await bad([{ type: 'line', to: 'field:requesterId' }])).status).toBe(201);
  });

  it('rules applied from a template before personal LINE existed pick it up', async () => {
    const { tid, admin, key } = await setup();
    const u = await link(key, tid, 'Uleave');
    const rule = (await t.api('POST', '/templates/leave-decided-to-employee/apply', {}, { token: admin })).body;
    await t.svc.db.tx(tid, (c) => c.query(`update rules set actions = '[{"type":"notify","to":"field:employeeUserId"}]' where id = $1`, [rule.id]));
    expect((await t.api('GET', `/rules/${rule.id}`, undefined, { token: admin })).body.actions).toEqual([
      { type: 'notify', to: 'field:employeeUserId' }, expect.objectContaining({ type: 'line', to: 'field:employeeUserId' })]);
    await t.deliver('hr.leave_decided', { leaveId: randomUUID(), no: 'LV-1', employeeName: 'สมชาย', typeName: 'ลาพักร้อน', decision: 'rejected', employeeUserId: u.userId, byName: 'คุณวิชัย', note: 'งานด่วน' }, { tenantId: tid });
    expect(pushesTo('Uleave').at(-1)).toContain('ใบลา LV-1 (ลาพักร้อน) ของคุณ: ไม่อนุมัติ โดย คุณวิชัย หมายเหตุ: งานด่วน');
  });
});

describe('LINE setup, permissions and tenants', () => {
  it('shows the webhook URL from PUBLIC_BASE_URL or the forwarded host, never the secrets', async () => {
    const { admin, settings } = await setup();
    expect(settings).toMatchObject({ ready: false, channel_secret_set: true, access_token_set: true, public_base_url_set: false, oa_id: '@goalong' });
    expect(JSON.stringify(settings)).not.toContain(SECRET);
    expect(JSON.stringify(settings)).not.toContain('line-token');
    const viaGateway = await t.svc.app.inject({ method: 'GET', url: '/line/settings', headers: { authorization: `Bearer ${admin}`, 'x-forwarded-host': 'erp.acme.co.th', 'x-forwarded-proto': 'https' } });
    expect(viaGateway.json().webhook_url).toMatch(/^https:\/\/erp\.acme\.co\.th\/api\/automation\/line\/webhook\/[0-9a-f]{64}$/);
    // same key every time until rotated
    expect(viaGateway.json().webhook_url.split('/').pop()).toBe(settings.webhook_url.split('/').pop());
  });

  it('rotating the webhook URL retires the old one', async () => {
    const { admin, key } = await setup();
    const r = await t.api('POST', '/line/settings/rotate', {}, { token: admin });
    expect(r.body.message).toContain('Webhook URL ใหม่');
    const fresh = r.body.webhook_url.split('/').pop();
    expect(fresh).not.toBe(key);
    expect((await hook(key, { events: [] })).statusCode).toBe(404);
    expect((await hook(fresh, { events: [] })).statusCode).toBe(200);
  });

  it('needs the right permissions', async () => {
    const { tid } = await setup();
    const staff = user(tid);
    expect((await t.api('GET', '/line/settings', undefined, { token: staff.token })).status).toBe(403);
    expect((await t.api('POST', '/line/settings/rotate', {}, { token: staff.token })).status).toBe(403);
    expect((await t.api('GET', '/line/links', undefined, { token: staff.token })).status).toBe(403);
    expect((await t.api('POST', '/line/link-code', {}, { token: t.token([], tid) })).status).toBe(403);
    expect((await t.api('GET', '/line/me', undefined, { token: t.token([], tid) })).status).toBe(403);
    expect((await t.svc.app.inject({ method: 'POST', url: '/line/link-code' })).statusCode).toBe(401);
  });

  it('test push, admin list and admin unlink', async () => {
    const { tid, admin, key } = await setup();
    const u = await link(key, tid, 'Utest', 'ช่างเอก');
    expect((await t.api('POST', '/line/test', {}, { token: user(tid).token })).body.error.message).toContain('ยังไม่ได้ผูก LINE');
    expect((await t.api('POST', '/line/test', {}, { token: u.token })).body).toMatchObject({ ok: true });
    expect(pushesTo('Utest').at(-1)).toContain('ทดสอบจากระบบ ERP');
    const links = (await t.api('GET', '/line/links', undefined, { token: admin })).body;
    expect(links).toEqual([expect.objectContaining({ user_id: u.userId, user_name: 'ช่างเอก', line_name: 'LINE Utest' })]);
    expect(Object.keys(links[0])).not.toContain('line_user_id'); // the raw LINE user id is not listed
    expect((await t.api('DELETE', `/line/links/${links[0].id}`, undefined, { token: admin })).body.deleted).toBe(links[0].id);
    expect((await t.api('GET', '/line/me', undefined, { token: u.token })).body.linked).toBe(false);
    expect((await t.api('DELETE', `/line/links/${links[0].id}`, undefined, { token: admin })).status).toBe(404);
  });

  it('keeps tenants apart: codes, links and keys', async () => {
    const a = await setup();
    const b = await setup();
    const ua = user(a.tid);
    const code = (await t.api('POST', '/line/link-code', {}, { token: ua.token })).body.code;
    // tenant A's code sent through tenant B's OA webhook does nothing
    expect(await say(b.key, 'Ucross', `ผูกบัญชี ${code}`)).toContain('ไม่ถูกต้อง');
    expect(await say(a.key, 'Ucross', `ผูกบัญชี ${code}`)).toContain('ผูกบัญชีเรียบร้อย');
    expect((await t.api('GET', '/line/links', undefined, { token: b.admin })).body).toEqual([]);
    expect((await t.api('GET', '/line/links', undefined, { token: a.admin })).body).toHaveLength(1);
    // the same LINE user is a stranger in tenant B
    expect(await say(b.key, 'Ucross', 'แจ้งเตือน')).toContain('ยังไม่ได้ผูก');
    // tenant B's id with tenant A's secret is not a valid key
    const mixed = b.key.slice(0, 32) + a.key.slice(32);
    expect((await hook(mixed, { events: [] })).statusCode).toBe(404);
    // B's admin cannot unlink A's people
    const linkId = (await t.api('GET', '/line/links', undefined, { token: a.admin })).body[0].id;
    expect((await t.api('DELETE', `/line/links/${linkId}`, undefined, { token: b.admin })).status).toBe(404);
  });
});
