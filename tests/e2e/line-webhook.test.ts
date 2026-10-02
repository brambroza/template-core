import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definition as identity } from '@erp/svc-identity';
import { definition as automation } from '@erp/svc-automation';
import { TEST_INTERNAL_TOKEN } from '@erp/kernel/testing';
import { install, type Installation } from './helpers.ts';

/**
 * LINE through the real front door: LINE posts to the gateway with no login and signs the exact bytes;
 * the gateway must forward them unchanged (its generic proxy re-serialises JSON) for automation to verify.
 */
const SECRET = 'e2e-line-secret';
let erp: Installation;
let token: string;
let tenantId: string;
let lineApi: Server;
const received: { path: string; body: any }[] = [];

beforeAll(async () => {
  lineApi = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { received.push({ path: req.url ?? '', body: raw ? JSON.parse(raw) : null }); res.writeHead(200, { 'content-type': 'application/json' }).end('{}'); });
  });
  await new Promise<void>((r) => lineApi.listen(0, '127.0.0.1', () => r()));
  const lineUrl = `http://127.0.0.1:${(lineApi.address() as { port: number }).port}`;
  erp = await install([identity, automation], { LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'tok', LINE_API_URL: lineUrl });
  ({ token, tenantId } = await erp.provision('line-co'));
});
afterAll(async () => { await erp?.close(); lineApi?.close(); });

const sign = (raw: string) => createHmac('sha256', SECRET).update(raw).digest('base64');
const postRaw = (url: string, raw: string, sig?: string) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', ...(sig ? { 'x-line-signature': sig } : {}) }, body: raw });

describe('LINE webhook through the gateway', () => {
  let webhookUrl = '';

  it('shows a webhook URL on the gateway host', async () => {
    const s = await erp.call('GET', '/api/automation/line/settings', undefined, token);
    expect(s.status).toBe(200);
    webhookUrl = s.body.webhook_url;
    expect(webhookUrl).toMatch(new RegExp(`^${erp.url.replace(/[.]/g, '\\.')}/api/automation/line/webhook/[0-9a-f]{64}$`));
  });

  it('forwards the exact bytes and the signature, without a login; rejects bad signatures', async () => {
    const code = (await erp.call('POST', '/api/automation/line/link-code', {}, token)).body.code;
    expect(code).toMatch(/^\d{6}$/);
    // pretty-printed + Thai text: any re-serialisation on the way would break the signature
    const raw = JSON.stringify({
      destination: 'Ubot',
      events: [{ type: 'message', mode: 'active', replyToken: 'rt-1', timestamp: Date.now(), source: { type: 'user', userId: 'Ue2e' }, message: { type: 'text', id: '1', text: `ผูกบัญชี  ${code}` } }],
    }, null, 2);
    expect((await postRaw(webhookUrl, raw)).status).toBe(401);
    expect((await postRaw(webhookUrl, raw, sign(raw.replace('  ', ' ')))).status).toBe(401);
    const ok = await postRaw(webhookUrl, raw, sign(raw));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, handled: 1 });
    expect(received.find((x) => x.path === '/v2/bot/message/reply')?.body).toMatchObject({ replyToken: 'rt-1', messages: [{ text: expect.stringContaining('ผูกบัญชีเรียบร้อย') }] });
    expect((await erp.call('GET', '/api/automation/line/me', undefined, token)).body.linked).toBe(true);
    // unknown key → 404 (after the signature check)
    expect((await postRaw(webhookUrl.replace(/[0-9a-f]{4}$/, '0000'), raw, sign(raw))).status).toBe(404);
  });

  it('a personal alert reaches the linked LINE', async () => {
    await erp.call('POST', '/api/automation/templates/approval-approved/apply', {}, token);
    const userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
    const res = await fetch(`${erp.url}/_events/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': TEST_INTERNAL_TOKEN },
      body: JSON.stringify({ id: randomUUID(), type: 'approvals.request_decided', tenantId, source: 'approvals', occurredAt: new Date().toISOString(),
        data: { requestId: randomUUID(), no: 'APV-2569-0001', title: 'ซื้อจอ', decision: 'approved', requesterId: userId, requesterName: 'Admin', byName: 'คุณวิภา', note: null } }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const push = received.find((x) => x.path === '/v2/bot/message/push');
    expect(push?.body).toMatchObject({ to: 'Ue2e', messages: [{ text: expect.stringContaining('APV-2569-0001') }] });
  });
});
