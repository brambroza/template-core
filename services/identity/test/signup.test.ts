import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyToken } from '@erp/kernel';
import { bootTestService, TEST_INTERNAL_TOKEN, TEST_JWT_SECRET, type TestService } from '@erp/kernel/testing';
import { captchaOk } from '../src/captcha.ts';
import { buttonMail, createMailer, mailProvider, sentMail } from '../src/mailer.ts';
import { PLANS } from '../src/plans.ts';
import { companyCodeBase, definition, FORGOT_LIMITS, resetLoginThrottle, SIGNUP_LIMITS } from '../src/service.ts';

/** Self-serve sign-up, e-mail confirmation and password reset (identity migration 005). Mail goes to the in-memory `log` provider. */
let t: TestService;
beforeAll(async () => { t = await bootTestService(definition, { APP_URL: 'https://app.example.co.th/' }); });
afterAll(async () => { await t?.close(); });
beforeEach(async () => { await resetLoginThrottle(); sentMail.length = 0; });

const post = async (url: string, payload: object, ip = '203.0.113.5') => {
  const r = await t.svc.app.inject({ method: 'POST', url, payload, headers: { 'x-erp-client-ip': ip } });
  return { status: r.statusCode, body: r.json() };
};
const linkToken = (path: string) => {
  const m = new RegExp(`https://app\\.example\\.co\\.th${path}\\?token=([\\w-]+)`).exec(sentMail.at(-1)?.text ?? '');
  if (!m) throw new Error(`no ${path} link in the last mail`);
  return m[1];
};
const signup = (email: string, extra: object = {}, ip?: string) =>
  post('/signup', { companyName: 'โรงงานสยามพาร์ท จำกัด', name: 'สมชาย ใจดี', email, password: 'password123', ...extra }, ip);

describe('self-serve sign-up', () => {
  it('sends a confirmation link; opening it creates the company, its admin and a trial, and signs in', async () => {
    const r = await signup('owner@siamparts.co.th', { plan: 'starter' });
    expect(r.status).toBe(202);
    expect(r.body.message).toContain('ส่งลิงก์ยืนยันไปที่ owner@siamparts.co.th');
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]).toMatchObject({ to: 'owner@siamparts.co.th', subject: 'ยืนยันอีเมลเพื่อเริ่มใช้งาน GO Along' });
    expect(sentMail[0].html).toContain('ยืนยันอีเมลและเริ่มใช้งาน');
    // nothing exists before the link is opened
    expect((await post('/auth/login', { email: 'owner@siamparts.co.th', password: 'password123' })).status).toBe(401);

    const token = linkToken('/signup/verify');
    const v = await post('/signup/verify', { token });
    expect(v.status).toBe(201);
    expect(v.body.tenant).toMatchObject({ code: 'siamparts', name: 'โรงงานสยามพาร์ท จำกัด' });
    expect(v.body.subscription).toMatchObject({ plan: 'starter', status: 'trial', daysLeft: 14 });
    expect(verifyToken(TEST_JWT_SECRET, v.body.token)).toMatchObject({ perms: ['*'], modules: PLANS.starter.modules, userName: 'สมชาย ใจดี' });
    // the link works once
    expect((await post('/signup/verify', { token })).body.error.code).toBe('link_invalid');
    expect((await post('/auth/login', { email: 'owner@siamparts.co.th', password: 'password123' })).status).toBe(200);
  });

  it('a taken e-mail gets the same answer, and the owner a mail pointing to password reset (no account discovery)', async () => {
    await signup('boss@taken.co.th');
    await post('/signup/verify', { token: linkToken('/signup/verify') });
    sentMail.length = 0;
    const again = await signup('BOSS@taken.co.th');
    expect(again.status).toBe(202);
    expect(again.body.message).toContain('ส่งลิงก์ยืนยันไปที่ boss@taken.co.th');
    expect(sentMail[0].subject).toBe('มีบัญชี GO Along สำหรับอีเมลนี้อยู่แล้ว');
    expect(sentMail[0].text).toContain('https://app.example.co.th/forgot-password');
  });

  it('the default plan is Factory; a second company from the same domain gets its own code; free mail gets a random one', async () => {
    await signup('a@samedomain.co.th');
    expect((await post('/signup/verify', { token: linkToken('/signup/verify') })).body).toMatchObject({ tenant: { code: 'samedomain' }, subscription: { plan: 'factory' } });
    await signup('b@samedomain.co.th');
    expect((await post('/signup/verify', { token: linkToken('/signup/verify') })).body.tenant.code).toBe('samedomain-2');
    expect(companyCodeBase('someone@gmail.com')).toMatch(/^co-[0-9a-f]{8}$/);
    expect(companyCodeBase('x@ab.co.th')).toBe('ab');
  });

  it('validates in Thai and limits sign-ups per IP and per e-mail', async () => {
    const bad = await post('/signup', { companyName: '', name: 'x', email: 'nope', password: 'short' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fieldErrors).toMatchObject({ email: ['อีเมลไม่ถูกต้อง'], password: ['รหัสผ่านอย่างน้อย 8 ตัวอักษร'] });
    for (let i = 0; i < SIGNUP_LIMITS.email; i++) expect((await signup('spam@flood.co.th', {}, `198.51.100.${i}`)).status).toBe(202);
    expect((await signup('spam@flood.co.th', {}, '198.51.100.99')).status).toBe(429);
    for (let i = 0; i < SIGNUP_LIMITS.ip; i++) await signup(`u${i}@many.co.th`, {}, '192.0.2.77');
    expect((await signup('next@many.co.th', {}, '192.0.2.77')).status).toBe(429);
  });

  it('an expired or unknown link is refused', async () => {
    await signup('late@expired.co.th');
    const token = linkToken('/signup/verify');
    await t.svc.db.pool.query(`update signups set expires_at = now() - interval '1 minute' where email = 'late@expired.co.th'`);
    expect((await post('/signup/verify', { token })).status).toBe(400);
    expect((await post('/signup/verify', { token: 'x'.repeat(43) })).body.error.message).toContain('ลิงก์ยืนยันหมดอายุ');
  });
});

describe('public plan list', () => {
  it('lists the plans with Thai module names and the trial length, without signing in', async () => {
    const r = await t.svc.app.inject({ method: 'GET', url: '/plans' });
    expect(r.statusCode).toBe(200);
    expect(r.json().trialDays).toBe(14);
    expect(r.json().plans[1]).toMatchObject({ id: 'factory', priceMonthly: 3490, maxUsers: 50 });
    expect(r.json().plans[0].modulesTh).toContain('เบิกค่าใช้จ่าย');
  });
});

describe('forgot / reset password', () => {
  beforeAll(async () => {
    await t.svc.app.inject({
      method: 'POST', url: '/tenants', headers: { 'x-internal-token': TEST_INTERNAL_TOKEN },
      payload: { code: 'resetco', name: 'Reset Co', admin: { email: 'admin@resetco.co.th', name: 'Admin', password: 'oldpassword1' } },
    });
  });

  it('same answer for known and unknown e-mails; only a real account gets a link', async () => {
    const unknown = await post('/auth/forgot', { email: 'ghost@nowhere.co.th' });
    expect(unknown.status).toBe(202);
    expect(sentMail).toHaveLength(0);
    const known = await post('/auth/forgot', { email: 'admin@resetco.co.th' });
    expect(known.status).toBe(202);
    expect(known.body.message.replace('admin@resetco.co.th', '?')).toBe(unknown.body.message.replace('ghost@nowhere.co.th', '?'));
    expect(sentMail[0]).toMatchObject({ to: 'admin@resetco.co.th', subject: 'ตั้งรหัสผ่านใหม่ GO Along' });
  });

  it('the link sets a new password once, ends old sessions and clears the login throttle', async () => {
    const old = await post('/auth/login', { email: 'admin@resetco.co.th', password: 'oldpassword1' });
    for (let i = 0; i < 10; i++) await post('/auth/login', { email: 'admin@resetco.co.th', password: 'wrong' });
    expect((await post('/auth/login', { email: 'admin@resetco.co.th', password: 'oldpassword1' })).status).toBe(429);

    await post('/auth/forgot', { email: 'admin@resetco.co.th' });
    const token = linkToken('/reset-password');
    const r = await post('/auth/reset', { token, newPassword: 'newpassword2' });
    expect(r.status).toBe(200);
    expect(r.body.message).toContain('ตั้งรหัสผ่านใหม่แล้ว');
    expect((await post('/auth/reset', { token, newPassword: 'another333' })).body.error.code).toBe('link_invalid');
    expect((await post('/auth/login', { email: 'admin@resetco.co.th', password: 'oldpassword1' })).status).toBe(401);
    expect((await post('/auth/login', { email: 'admin@resetco.co.th', password: 'newpassword2' })).status).toBe(200);
    const me = await t.svc.app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${old.body.token}` } });
    expect(me.statusCode).toBe(401);
  });

  it('limits reset requests per e-mail', async () => {
    for (let i = 0; i < FORGOT_LIMITS.email; i++) expect((await post('/auth/forgot', { email: 'ghost@limit.co.th' }, `198.51.100.${i}`)).status).toBe(202);
    expect((await post('/auth/forgot', { email: 'ghost@limit.co.th' })).status).toBe(429);
  });
});

describe('login throttle lives in Postgres', () => {
  it('failed logins are rows in auth_attempts (shared by every identity instance, kept across restarts)', async () => {
    for (let i = 0; i < 3; i++) await post('/auth/login', { email: 'admin@resetco.co.th', password: 'nope' }, '203.0.113.200');
    const n = await t.svc.db.pool.query(`select count(*)::int as n from auth_attempts where key = 'login|admin@resetco.co.th|203.0.113.200'`);
    expect(n.rows[0].n).toBe(3);
  });
});

describe('mail and captcha adapters', () => {
  it('picks the provider from the settings and refuses a real provider without its key', () => {
    expect(mailProvider({})).toBe('log');
    expect(mailProvider({ RESEND_API_KEY: 'k' })).toBe('resend');
    expect(mailProvider({ EMAIL_PROVIDER: 'sendgrid' })).toBe('sendgrid');
    expect(() => createMailer({ EMAIL_PROVIDER: 'resend', EMAIL_FROM: 'a@b.co' })).toThrow('RESEND_API_KEY');
    expect(() => createMailer({ EMAIL_PROVIDER: 'sendgrid', SENDGRID_API_KEY: 'k' })).toThrow('EMAIL_FROM');
  });

  it('sends through Resend / SendGrid with the right request', async () => {
    const calls: Array<{ url: string; body: any; auth: string }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).authorization });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const mail = buttonMail('to@x.co.th', 'หัวข้อ', ['บรรทัด <b>'], { label: 'กด', url: 'https://a.co/x?y=1&z=2' });
    expect(mail.html).toContain('บรรทัด &lt;b&gt;');
    expect(mail.html).toContain('https://a.co/x?y=1&amp;z=2');
    await createMailer({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'rk', EMAIL_FROM: 'GO Along <no-reply@goalong.co.th>' }, fake)(mail);
    await createMailer({ EMAIL_PROVIDER: 'sendgrid', SENDGRID_API_KEY: 'sk', EMAIL_FROM: 'GO Along <no-reply@goalong.co.th>' }, fake)(mail);
    expect(calls[0]).toMatchObject({ url: 'https://api.resend.com/emails', auth: 'Bearer rk', body: { to: ['to@x.co.th'], subject: 'หัวข้อ' } });
    expect(calls[1]).toMatchObject({ url: 'https://api.sendgrid.com/v3/mail/send', auth: 'Bearer sk', body: { from: { email: 'no-reply@goalong.co.th', name: 'GO Along' } } });
  });

  it('captcha: open without a secret, fails closed with one', async () => {
    expect(await captchaOk({}, undefined, '1.2.3.4')).toBe(true);
    expect(await captchaOk({ TURNSTILE_SECRET: 's' }, undefined, '1.2.3.4')).toBe(false);
    const ok = (async () => new Response(JSON.stringify({ success: true }))) as unknown as typeof fetch;
    const down = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await captchaOk({ TURNSTILE_SECRET: 's' }, 'tok', '1.2.3.4', ok)).toBe(true);
    expect(await captchaOk({ TURNSTILE_SECRET: 's' }, 'tok', '1.2.3.4', down)).toBe(false);
  });
});
