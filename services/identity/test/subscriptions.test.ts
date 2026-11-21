import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyToken } from '@erp/kernel';
import { bootTestService, TEST_INTERNAL_TOKEN, TEST_JWT_SECRET, type TestService } from '@erp/kernel/testing';
import { definition, resetLoginThrottle } from '../src/service.ts';
import { entitlementOf, GRACE_DAYS, MODULE_NAMES_TH, PLANS, tokenTtl, TRIAL_DAYS, type SubscriptionRow } from '../src/plans.ts';

/** Cloud plans (identity migration 004): trial, plan modules in the token, user limit, payment by transfer, suspension. */
let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); resetLoginThrottle(); });
afterAll(async () => { await t?.close(); });

const internal = { 'x-internal-token': TEST_INTERNAL_TOKEN };
const provision = (code: string, plan?: string) => t.svc.app.inject({
  method: 'POST', url: '/tenants', headers: internal,
  payload: { code, name: `${code} co`, admin: { email: `admin@${code}.co`, name: 'Admin', password: 'password123' }, ...(plan ? { plan } : {}) },
});
const login = async (code: string) => {
  const r = await t.svc.app.inject({ method: 'POST', url: '/auth/login', payload: { email: `admin@${code}.co`, password: 'password123' } });
  return { status: r.statusCode, body: r.json() };
};
const ops = async (code: string, change: object) => {
  const r = await t.svc.app.inject({ method: 'PUT', url: `/_ops/tenants/${code}/subscription`, headers: internal, payload: { by: 'ทีมบัญชี GO Along', ...change } });
  return { status: r.statusCode, body: r.json() };
};
const addUser = (token: string, n: number) => t.svc.app.inject({
  method: 'POST', url: '/users', headers: { authorization: `Bearer ${token}` },
  payload: { email: `staff${n}@seat.co`, name: `พนักงาน ${n}`, password: 'password123' },
});

describe('cloud plans', () => {
  it('a company with a plan starts a 14-day trial; its token lists the plan modules and ends with the trial', async () => {
    const res = await provision('trial-co', 'factory');
    expect(res.statusCode).toBe(201);
    expect(res.json().subscription).toMatchObject({ plan: 'factory', status: 'trial', statusTh: 'ทดลองใช้', daysLeft: TRIAL_DAYS, maxUsers: 50 });
    const r = await login('trial-co');
    expect(r.status).toBe(200);
    expect(r.body.subscription.planName).toBe('Factory');
    const claims = verifyToken(TEST_JWT_SECRET, r.body.token);
    expect(claims.modules).toEqual(PLANS.factory.modules);
    expect(r.body.expiresIn).toBeLessThanOrEqual(12 * 3600);
  });

  it('a company without a plan (self-hosted) has no module list and no limits', async () => {
    await provision('onprem');
    const r = await login('onprem');
    expect(r.status).toBe(200);
    expect(r.body.subscription).toBeNull();
    expect(verifyToken(TEST_JWT_SECRET, r.body.token).modules).toBeUndefined();
  });

  it('GET /subscription shows the plan, seats used and the plan list', async () => {
    const { body } = await login('trial-co');
    const r = await t.svc.app.inject({ method: 'GET', url: '/subscription', headers: { authorization: `Bearer ${body.token}` } });
    expect(r.json()).toMatchObject({ subscription: { plan: 'factory' }, usedUsers: 1, plan_text: 'Factory · 3,490 บาท/เดือน (ไม่รวม VAT)', users_text: '1 / 50 คน' });
    expect(r.json().status_text).toBe('ทดลองใช้ · เหลือ 14 วัน');
    expect(r.json().plans.map((p: { id: string }) => p.id)).toEqual(['starter', 'factory', 'business']);
  });

  it('the user limit counts active users; the last seat is refused in Thai', async () => {
    await provision('seat', 'starter');
    expect((await ops('seat', { maxUsers: 2 })).status).toBe(200);
    const { body } = await login('seat');
    expect((await addUser(body.token, 1)).statusCode).toBe(201);
    const full = await addUser(body.token, 2);
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toMatchObject({ code: 'user_limit' });
    expect(full.json().error.message).toContain('ใช้ได้ 2 ผู้ใช้');
  });

  it('trial over → 402 with the reason; a confirmed transfer opens it again and revokes old tokens', async () => {
    await provision('late', 'starter');
    const before = await login('late');
    expect((await ops('late', { trialDays: 0 })).status).toBe(200);
    const closed = await login('late');
    expect(closed.status).toBe(402);
    expect(closed.body.error).toMatchObject({ code: 'subscription_inactive' });
    expect(closed.body.error.message).toContain('ทดลองใช้ครบ 14 วันแล้ว');

    expect((await ops('late', { status: 'active' })).status).toBe(400); // paid through is required
    const paid = await ops('late', { status: 'active', paidThrough: '2099-12-31', plan: 'factory' });
    expect(paid.status).toBe(200);
    expect(paid.body.subscription).toMatchObject({ status: 'active', plan: 'factory', blocked: null });
    expect(paid.body.revokedUsers).toBe(1);
    const again = await login('late');
    expect(again.status).toBe(200);
    expect(verifyToken(TEST_JWT_SECRET, again.body.token).modules).toEqual(PLANS.factory.modules);
    // the trial-era token was revoked with the change (identity's own copy of the cutoff)
    const me = await t.svc.app.inject({ method: 'GET', url: '/me', headers: { authorization: `Bearer ${before.body.token}` } });
    expect(me.statusCode).toBe(401);
  });

  it('suspended → 402; the back office lists companies and keeps a log', async () => {
    await ops('trial-co', { status: 'suspended', note: 'ขอระงับชั่วคราว' });
    expect((await login('trial-co')).status).toBe(402);
    const list = (await t.svc.app.inject({ method: 'GET', url: '/_ops/tenants?q=trial', headers: internal })).json();
    expect(list).toEqual([expect.objectContaining({ code: 'trial-co', activeUsers: 1, subscription: expect.objectContaining({ status: 'suspended' }), note: 'ขอระงับชั่วคราว' })]);
    const log = (await t.svc.app.inject({ method: 'GET', url: '/_ops/tenants/trial-co/subscription-log', headers: internal })).json();
    expect(log[0]).toMatchObject({ by_name: 'ทีมบัญชี GO Along', change: { status: 'suspended' } });
    expect(log.at(-1)).toMatchObject({ by_name: 'สมัครใช้งาน' });
    // back-office routes need the internal token
    expect((await t.svc.app.inject({ method: 'GET', url: '/_ops/tenants' })).statusCode).toBe(401);
  });

  it('a company without a plan gets one only when the plan is named', async () => {
    expect((await ops('onprem', { status: 'active', paidThrough: '2099-01-01' })).status).toBe(400);
    expect((await ops('nobody', { plan: 'starter' })).status).toBe(404);
  });
});

describe('entitlement rules', () => {
  const row = (over: Partial<SubscriptionRow>): SubscriptionRow => ({
    tenant_id: 't', plan: 'starter', status: 'active', modules: null, max_users: null, trial_ends_at: null, paid_through: null, note: null, ...over,
  });
  const now = new Date('2026-11-20T05:00:00Z');

  it('paid companies keep working GRACE_DAYS after the paid-through day (Bangkok)', () => {
    expect(entitlementOf(row({ paid_through: '2026-11-15' }), now).blocked).toBeNull();
    expect(GRACE_DAYS).toBe(7);
    expect(entitlementOf(row({ paid_through: '2026-11-12' }), now).blocked).toContain('เลยกำหนดชำระ');
  });

  it('overrides win over the plan; tokens never outlive access', () => {
    const e = entitlementOf(row({ status: 'trial', trial_ends_at: '2026-11-20T06:00:00Z', modules: ['hr'], max_users: 3 }), now);
    expect(e).toMatchObject({ modules: ['hr'], maxUsers: 3, blocked: null });
    expect(tokenTtl(43200, e, now)).toBe(3600);
    expect(tokenTtl(43200, null, now)).toBe(43200);
  });
});

describe('plan catalogue', () => {
  it('every plan module exists, and its Thai name matches module.json', () => {
    for (const id of PLANS.business.modules) {
      const m = JSON.parse(readFileSync(new URL(`../../${id}/module.json`, import.meta.url), 'utf8'));
      expect(m.tier).toBe('feature');
      expect(MODULE_NAMES_TH[id]).toBe(m.nameTh);
    }
    // each plan includes the one below it
    expect(PLANS.starter.modules.every((m) => PLANS.factory.modules.includes(m))).toBe(true);
    expect(PLANS.factory.modules.every((m) => PLANS.business.modules.includes(m))).toBe(true);
  });
});
