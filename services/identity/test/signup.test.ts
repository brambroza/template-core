import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { verifyToken } from '@erp/kernel';
import { bootTestService, TEST_INTERNAL_TOKEN, TEST_JWT_SECRET, type TestService } from '@erp/kernel/testing';
import { captchaConfigWarning, captchaOk, captchaPublicConfig } from '../src/captcha.ts';
import { buttonMail, codeMail, createMailer, mailProvider, sentMail } from '../src/mailer.ts';
import { PLANS } from '../src/plans.ts';
import {
  companyCodeBase, definition, FORGOT_LIMITS, newSignupCode, resetLoginThrottle, SIGNUP_CODE_MAX_TRIES, SIGNUP_LIMITS, SIGNUP_RESEND_LIMITS, signupCodeHash,
} from '../src/service.ts';

/**
 * Self-serve sign-up with a 6-digit code typed into the page (identity migrations 005 + 010) and password reset.
 * Mail goes to the in-memory `log` provider.
 */
let t: TestService;
beforeAll(async () => { t = await bootTestService(definition, { APP_URL: 'https://app.example.co.th/', TURNSTILE_SITE_KEY: '1x00000000000000000000AA' }); });
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
/** the 6-digit code in the last mail */
const mailedCode = () => {
  const m = /รหัสยืนยัน: (\d{6})/.exec(sentMail.at(-1)?.text ?? '');
  if (!m) throw new Error('no code in the last mail');
  return m[1];
};
/** a 6-digit code that is certainly not `code` */
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
/** sign up and type the mailed code: the answer of /signup/verify */
const signupAndVerify = async (email: string, extra: object = {}) => {
  const r = await signup(email, extra);
  return post('/signup/verify', { ticket: r.body.ticket, code: mailedCode() });
};
/** the "send again" wait is counted in auth_attempts: let it pass without waiting a minute */
const passResendWait = () => t.svc.db.pool.query(`update auth_attempts set at = at - interval '2 minutes' where key like 'signup-sent|%'`);

describe('self-serve sign-up', () => {
  it('mails a 6-digit code; typing it creates the company, its admin and a trial, and signs in', async () => {
    const r = await signup('owner@siamparts.co.th', { plan: 'starter' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ email: 'owner@siamparts.co.th', codeMinutes: 10, resendSeconds: 60 });
    expect(r.body.ticket).toMatch(/^[\w-]{40,}$/);
    expect(r.body.message).toContain('ส่งรหัสยืนยัน 6 หลักไปที่ owner@siamparts.co.th');
    expect(sentMail).toHaveLength(1);
    const code = mailedCode();
    expect(sentMail[0]).toMatchObject({ to: 'owner@siamparts.co.th', subject: `รหัสยืนยัน GO Along: ${code}` });
    expect(sentMail[0].html).toContain(code);
    expect(sentMail[0].text).not.toContain('http'); // a code to type, no link to click
    // nothing exists before the code is typed, and neither the ticket nor the code is kept as sent
    expect((await post('/auth/login', { email: 'owner@siamparts.co.th', password: 'password123' })).status).toBe(401);
    const kept = JSON.stringify((await t.svc.db.pool.query(`select * from signups where email = 'owner@siamparts.co.th'`)).rows);
    expect(kept).not.toContain(r.body.ticket);
    expect(kept).not.toContain(`"${code}"`);

    const v = await post('/signup/verify', { ticket: r.body.ticket, code });
    expect(v.status).toBe(201);
    expect(v.body.tenant).toMatchObject({ code: 'siamparts', name: 'โรงงานสยามพาร์ท จำกัด' });
    expect(v.body.subscription).toMatchObject({ plan: 'starter', status: 'trial', daysLeft: 14 });
    expect(verifyToken(TEST_JWT_SECRET, v.body.token)).toMatchObject({ perms: ['*'], modules: PLANS.starter.modules, userName: 'สมชาย ใจดี' });
    // the code works once
    expect((await post('/signup/verify', { ticket: r.body.ticket, code })).body.error.code).toBe('code_invalid');
    expect((await post('/auth/login', { email: 'owner@siamparts.co.th', password: 'password123' })).status).toBe(200);
  });

  it('accepts the code as mail apps copy it ("123 456", "123-456") and refuses anything that is not six digits', async () => {
    const r = await signup('spaces@copied.co.th');
    const code = mailedCode();
    for (const bad of ['12345', '1234567', 'abcdef', '']) {
      const b = await post('/signup/verify', { ticket: r.body.ticket, code: bad });
      expect(b.status).toBe(400);
      expect(b.body.error.details.fieldErrors.code).toEqual(['รหัสยืนยันเป็นตัวเลข 6 หลัก']);
    }
    expect((await post('/signup/verify', { ticket: r.body.ticket, code: ` ${code.slice(0, 3)} ${code.slice(3)} ` })).status).toBe(201);
  });

  it('a taken e-mail gets the same answer and a mail pointing to password reset; its ticket confirms nothing (no account discovery)', async () => {
    expect((await signupAndVerify('boss@taken.co.th')).status).toBe(201);
    const fresh = await signup('new@taken.co.th');
    sentMail.length = 0;
    const again = await signup('BOSS@taken.co.th');
    expect(again.status).toBe(202);
    // same shape and wording as for a new e-mail
    expect(Object.keys(again.body).sort()).toEqual(Object.keys(fresh.body).sort());
    expect(again.body.message).toBe(fresh.body.message.replace('new@taken.co.th', 'boss@taken.co.th'));
    expect(again.body.ticket).toMatch(/^[\w-]{40,}$/);
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0].subject).toBe('มีบัญชี GO Along สำหรับอีเมลนี้อยู่แล้ว');
    expect(sentMail[0].text).toContain('https://app.example.co.th/forgot-password');
    expect(sentMail[0].text).not.toMatch(/\d{6}/);
    // nothing typed on the form is kept for an e-mail that already has an account
    const row = (await t.svc.db.pool.query(`select * from signups where email = 'boss@taken.co.th' and account_exists`)).rows[0];
    expect(row).toMatchObject({ company_name: '-', name: '-', password_hash: '-' });

    // every code fails like a wrong code — even the one stored for the row, which nobody was told
    const bad = await post('/signup/verify', { ticket: again.body.ticket, code: '123456' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('code_invalid');
    const known = newSignupCode();
    await t.svc.db.pool.query('update signups set code_hash = $2 where id = $1', [row.id, signupCodeHash(TEST_JWT_SECRET, row.token_hash, known)]);
    expect((await post('/signup/verify', { ticket: again.body.ticket, code: known })).body.error).toEqual(bad.body.error);
    // "send again" answers the same and repeats the pointer, never a code
    await passResendWait();
    sentMail.length = 0;
    const resent = await post('/signup/resend', { ticket: again.body.ticket });
    expect(resent.status).toBe(202);
    expect(sentMail[0].subject).toBe('มีบัญชี GO Along สำหรับอีเมลนี้อยู่แล้ว');
    // the real account is untouched
    expect((await post('/auth/login', { email: 'boss@taken.co.th', password: 'password123' })).status).toBe(200);
  });

  it('the default plan is Factory; a second company from the same domain gets its own code; free mail gets a random one', async () => {
    expect((await signupAndVerify('a@samedomain.co.th')).body).toMatchObject({ tenant: { code: 'samedomain' }, subscription: { plan: 'factory' } });
    expect((await signupAndVerify('b@samedomain.co.th')).body.tenant.code).toBe('samedomain-2');
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

  it('a wrong code is refused; after 5 wrong tries the right code is dead until a new one is sent', async () => {
    const r = await signup('guess@tries.co.th');
    const code = mailedCode();
    for (let i = 0; i < SIGNUP_CODE_MAX_TRIES; i++) {
      const w = await post('/signup/verify', { ticket: r.body.ticket, code: wrongCode(code) });
      expect(w.status).toBe(400);
      expect(w.body.error).toMatchObject({ code: 'code_invalid', message: expect.stringContaining('รหัสยืนยันไม่ถูกต้องหรือหมดอายุ') });
    }
    expect((await post('/signup/verify', { ticket: r.body.ticket, code })).body.error.code).toBe('code_invalid');
    expect((await post('/auth/login', { email: 'guess@tries.co.th', password: 'password123' })).status).toBe(401);

    await passResendWait();
    expect((await post('/signup/resend', { ticket: r.body.ticket })).status).toBe(202);
    const fresh = mailedCode();
    expect(fresh).not.toBe(code);
    expect((await post('/signup/verify', { ticket: r.body.ticket, code: fresh })).status).toBe(201);
  });

  it('a code only counts with the ticket of its own sign-up', async () => {
    const mine = await signup('mine@tickets.co.th');
    const myCode = mailedCode();
    const other = await signup('other@tickets.co.th');
    expect((await post('/signup/verify', { ticket: other.body.ticket, code: myCode })).body.error.code).toBe('code_invalid');
    expect((await post('/signup/verify', { ticket: 'x'.repeat(43), code: myCode })).body.error.code).toBe('code_invalid');
    expect((await post('/signup/verify', { ticket: mine.body.ticket, code: myCode })).body.user.email).toBe('mine@tickets.co.th');
  });

  it('an expired code, an expired sign-up and a sign-up from before the codes are refused with the same answer', async () => {
    const late = await signup('late@expired.co.th');
    const code = mailedCode();
    await t.svc.db.pool.query(`update signups set code_expires_at = now() - interval '1 second' where email = 'late@expired.co.th'`);
    const expired = await post('/signup/verify', { ticket: late.body.ticket, code });
    expect(expired.status).toBe(400);
    expect(expired.body.error.message).toContain('รหัสยืนยันไม่ถูกต้องหรือหมดอายุ');
    // a new code revives it within the 24 hours of the sign-up …
    await passResendWait();
    await post('/signup/resend', { ticket: late.body.ticket });
    const fresh = mailedCode();
    // … but not after them
    await t.svc.db.pool.query(`update signups set expires_at = now() - interval '1 minute' where email = 'late@expired.co.th'`);
    expect((await post('/signup/verify', { ticket: late.body.ticket, code: fresh })).body.error).toEqual(expired.body.error);
    // a row written by the link flow (migration 005) has no code at all
    const old = await signup('old@linkflow.co.th');
    await t.svc.db.pool.query(`update signups set code_hash = null, code_expires_at = null where email = 'old@linkflow.co.th'`);
    expect((await post('/signup/verify', { ticket: old.body.ticket, code: mailedCode() })).body.error).toEqual(expired.body.error);
  });

  it('send again: a new code replaces the old one, one per minute, 3 per hour per sign-up, per-IP cap', async () => {
    const r = await signup('again@resend.co.th');
    const first = mailedCode();
    // straight after the first mail: wait
    const soon = await post('/signup/resend', { ticket: r.body.ticket });
    expect(soon.status).toBe(429);
    expect(soon.body.error).toMatchObject({ code: 'too_soon', message: expect.stringContaining('60 วินาที') });
    expect(sentMail).toHaveLength(1);

    await passResendWait();
    const again = await post('/signup/resend', { ticket: r.body.ticket });
    expect(again.status).toBe(202);
    expect(again.body).toMatchObject({ codeMinutes: 10, resendSeconds: 60 });
    expect(sentMail).toHaveLength(2);
    expect(sentMail[1].to).toBe('again@resend.co.th');
    const second = mailedCode();
    // only the newest code works (the old one is refused even when the two happen to be equal digits: then `second` is tried)
    if (first !== second) expect((await post('/signup/verify', { ticket: r.body.ticket, code: first })).body.error.code).toBe('code_invalid');

    for (let i = 1; i < SIGNUP_RESEND_LIMITS.ticket; i++) {
      await passResendWait();
      expect((await post('/signup/resend', { ticket: r.body.ticket })).status).toBe(202);
    }
    await passResendWait();
    const capped = await post('/signup/resend', { ticket: r.body.ticket });
    expect(capped.status).toBe(429);
    expect(capped.body.error.code).toBe('too_many_attempts');
    expect((await post('/signup/verify', { ticket: r.body.ticket, code: mailedCode() })).status).toBe(201);

    // an unknown ticket gets the same answer and no mail; the per-IP cap stops someone trying many tickets
    sentMail.length = 0;
    for (let i = 0; i < SIGNUP_RESEND_LIMITS.ip; i++) {
      const u = await post('/signup/resend', { ticket: `unknown-ticket-${i}-${'x'.repeat(30)}` }, '192.0.2.90');
      expect(u.status).toBe(202);
      expect(u.body.message).toBe(again.body.message);
    }
    expect(sentMail).toHaveLength(0);
    expect((await post('/signup/resend', { ticket: `unknown-ticket-last-${'x'.repeat(30)}` }, '192.0.2.90')).status).toBe(429);
  });

  it('wrong codes are limited per IP', async () => {
    const r = await signup('ip@codes.co.th');
    for (let i = 0; i < 20; i++) expect((await post('/signup/verify', { ticket: `nobody-${i}-${'x'.repeat(30)}`, code: '000000' }, '192.0.2.50')).status).toBe(400);
    const blocked = await post('/signup/verify', { ticket: r.body.ticket, code: mailedCode() }, '192.0.2.50');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.message).toContain('รหัสยืนยันผิดหลายครั้ง');
    // from elsewhere the owner's code still works
    expect((await post('/signup/verify', { ticket: r.body.ticket, code: mailedCode() }, '192.0.2.51')).status).toBe(201);
  });

  it('codes are six digits, keep leading zeros, and are stored as an HMAC bound to the ticket', () => {
    for (let i = 0; i < 200; i++) expect(newSignupCode()).toMatch(/^\d{6}$/);
    const h = signupCodeHash('secret', 'ticket-hash', '004219');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(signupCodeHash('secret', 'ticket-hash', '004219')).toBe(h);
    expect(signupCodeHash('secret', 'other-ticket', '004219')).not.toBe(h);
    expect(signupCodeHash('other-secret', 'ticket-hash', '004219')).not.toBe(h);
  });
});

describe('captcha settings for the public forms', () => {
  it('GET /captcha gives the site key without signing in', async () => {
    const r = await t.svc.app.inject({ method: 'GET', url: '/captcha' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ provider: 'turnstile', siteKey: '1x00000000000000000000AA' });
  });

  it('no site key = no widget; a half-configured pair is reported', () => {
    expect(captchaPublicConfig({})).toEqual({ provider: null, siteKey: null });
    expect(captchaPublicConfig({ TURNSTILE_SITE_KEY: '  ' })).toEqual({ provider: null, siteKey: null });
    expect(captchaConfigWarning({})).toBeNull();
    expect(captchaConfigWarning({ TURNSTILE_SECRET: 's', TURNSTILE_SITE_KEY: 'k' })).toBeNull();
    expect(captchaConfigWarning({ TURNSTILE_SECRET: 's' })).toContain('TURNSTILE_SITE_KEY');
    expect(captchaConfigWarning({ TURNSTILE_SITE_KEY: 'k' })).toContain('TURNSTILE_SECRET');
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
    const code = codeMail('to@x.co.th', 'รหัส', ['บรรทัด <b>'], '004219', 'ท้าย & จบ');
    expect(code.text).toContain('รหัสยืนยัน: 004219');
    expect(code.html).toContain('>004219</p>');
    expect(code.html).toContain('บรรทัด &lt;b&gt;');
    expect(code.html).toContain('ท้าย &amp; จบ');
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
