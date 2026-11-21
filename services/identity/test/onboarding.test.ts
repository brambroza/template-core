import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootTestService, TEST_INTERNAL_TOKEN, type TestService } from '@erp/kernel/testing';
import { sentMail } from '../src/mailer.ts';
import { definition, resetLoginThrottle } from '../src/service.ts';

/** "ตั้งค่าเริ่มต้น" wizard state, and inviting colleagues by e-mail (they set their own password). */
let t: TestService;
beforeAll(async () => { t = await bootTestService(definition, { APP_URL: 'https://app.example.co.th' }); });
afterAll(async () => { await t?.close(); });
beforeEach(async () => { await resetLoginThrottle(); sentMail.length = 0; });

const internal = { 'x-internal-token': TEST_INTERNAL_TOKEN };
const provision = (code: string, plan?: string) => t.svc.app.inject({
  method: 'POST', url: '/tenants', headers: internal,
  payload: { code, name: `${code} co`, admin: { email: `owner@${code}.co`, name: `Owner ${code}`, password: 'password123' }, ...(plan ? { plan } : {}) },
});
const loginAs = async (email: string, password = 'password123') =>
  t.svc.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
const as = (token: string) => async (method: string, url: string, payload?: object) => {
  const r = await t.svc.app.inject({ method: method as 'GET', url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  return { status: r.statusCode, body: r.json() };
};

let owner: ReturnType<typeof as>;
beforeAll(async () => {
  await provision('cloud', 'factory');
  await provision('selfhost');
  owner = as((await loginAs('owner@cloud.co')).json().token);
});

describe('setup wizard', () => {
  it('only cloud companies have it', async () => {
    const self = as((await loginAs('owner@selfhost.co')).json().token);
    expect((await self('GET', '/onboarding')).body).toEqual({ onboarding: null });
    const r = (await owner('GET', '/onboarding')).body.onboarding;
    expect(r.steps.map((s: { id: string }) => s.id)).toEqual(['company', 'approvals', 'team', 'data', 'start']);
    expect(r).toMatchObject({ doneCount: 0, completed: false });
  });

  it('remembers finished steps once each, then completes', async () => {
    await owner('POST', '/onboarding/steps/company');
    const again = (await owner('POST', '/onboarding/steps/company')).body.onboarding;
    expect(again.doneCount).toBe(1);
    expect((await owner('POST', '/onboarding/steps/nope')).status).toBe(400);
    const done = (await owner('POST', '/onboarding/complete')).body.onboarding;
    expect(done.completed).toBe(true);
  });

  it('a member without the company-settings right cannot change it', async () => {
    const tenantId = (await t.svc.db.pool.query(`select id from tenants where code = 'cloud'`)).rows[0].id;
    const member = as(t.token(['identity.user.read'], tenantId));
    expect((await member('POST', '/onboarding/steps/team')).status).toBe(403);
  });
});

describe('invite a colleague', () => {
  it('creates the user with the template role and mails a link to set their own password', async () => {
    const r = await owner('POST', '/users/invite', { email: 'Buyer@Cloud.co', name: 'วิไล จัดซื้อ', template: 'purchasing', modules: ['purchasing', 'inventory'] });
    expect(r.status).toBe(201);
    expect(r.body.message).toContain('buyer@cloud.co');
    const mail = sentMail.at(-1)!;
    expect(mail.to).toBe('buyer@cloud.co');
    expect(mail.subject).toContain('ชวนคุณใช้งาน');
    const token = /reset-password\?invite=1&token=([\w-]+)/.exec(mail.text)?.[1];
    expect(token).toBeTruthy();

    // cannot log in before choosing a password; after the link, can
    expect((await loginAs('buyer@cloud.co')).statusCode).toBe(401);
    const set = await t.svc.app.inject({ method: 'POST', url: '/auth/reset', payload: { token, newPassword: 'mypassword1' } });
    expect(set.statusCode).toBe(200);
    const login = await loginAs('buyer@cloud.co', 'mypassword1');
    expect(login.statusCode).toBe(200);
    expect(login.json().permissions).toContain('purchasing.po.write');
    expect(login.json().permissions).not.toContain('*');

    // a second invite with the same template reuses the company's role
    await owner('POST', '/users/invite', { email: 'buyer2@cloud.co', name: 'สมใจ', template: 'purchasing' });
    const roles = (await owner('GET', '/roles')).body as { name: string }[];
    expect(roles.filter((x) => x.name === 'จัดซื้อ')).toHaveLength(1);
  });

  it('refuses a taken e-mail and an unknown template', async () => {
    expect((await owner('POST', '/users/invite', { email: 'owner@selfhost.co', name: 'x', template: 'staff' })).status).toBe(409);
    expect((await owner('POST', '/users/invite', { email: 'new@cloud.co', name: 'x', template: 'nope' })).status).toBe(400);
    expect(sentMail).toHaveLength(0);
  });
});
