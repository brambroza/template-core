import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, TEST_INTERNAL_TOKEN, type TestService } from '@erp/kernel/testing';
import { definition, resetLoginThrottle } from '../src/service.ts';
import { gatewayBase } from '../src/starter.ts';

/** Identity's side of sample data: the state the banner shows, and the one-time "ล้างข้อมูลตัวอย่าง" (full run: tests/e2e/starter.test.ts). */
let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); await resetLoginThrottle(); });
afterAll(async () => { await t?.close(); });

const internal = { 'x-internal-token': TEST_INTERNAL_TOKEN };
const login = async (email: string) =>
  (await t.svc.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'password123' } })).json().token as string;
const as = (token: string) => async (method: string, url: string, payload?: object) => {
  const r = await t.svc.app.inject({ method: method as 'GET', url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  return { status: r.statusCode, body: r.json() };
};
const waitState = async (call: ReturnType<typeof as>, not: string) => {
  for (let i = 0; i < 50; i++) {
    const s = (await call('GET', '/starter')).body.starter;
    if (s?.state !== not) return s;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('still seeding');
};

describe('gateway address', () => {
  it('GATEWAY_URL, else the event router host', () => {
    expect(gatewayBase({ GATEWAY_URL: 'http://gateway:8080/' })).toBe('http://gateway:8080');
    expect(gatewayBase({ EVENT_ROUTER_URL: 'http://gateway:8080/_events/publish' })).toBe('http://gateway:8080');
    expect(gatewayBase({})).toBeNull();
  });
});

describe('sample data state', () => {
  it('a company without sample data shows nothing and has nothing to clear', async () => {
    await t.svc.app.inject({ method: 'POST', url: '/tenants', headers: internal, payload: { code: 'plain', name: 'Plain', admin: { email: 'admin@plain.co', name: 'A', password: 'password123' } } });
    const call = as(await login('admin@plain.co'));
    expect((await call('GET', '/starter')).body).toEqual({ starter: null });
    expect((await call('POST', '/starter/clear', { confirm: 'ล้างข้อมูลตัวอย่าง' })).status).toBe(409);
  });

  it('no gateway: the run fails with a Thai reason, the company still works and can be cleared once', async () => {
    const r = await t.svc.app.inject({
      method: 'POST', url: '/tenants', headers: internal,
      payload: { code: 'food-co', name: 'Food', plan: 'business', industry: 'food', admin: { email: 'admin@food.co', name: 'Owner', password: 'password123' } },
    });
    expect(r.json().starter).toBe('seeding');
    const call = as(await login('admin@food.co'));
    const s = await waitState(call, 'seeding');
    expect(s).toMatchObject({ state: 'failed', industry: 'food', industryName: 'อาหาร / แปรรูป' });
    expect(s.error).toContain('ใช้งานต่อได้');
    const tenantId = (await t.svc.db.pool.query(`select id from tenants where code = 'food-co'`)).rows[0].id;
    const row = await t.svc.db.tx(tenantId, async (c) => (await c.query('select error from tenant_starter')).rows[0]);
    expect(row.error).toContain('GATEWAY_URL'); // the technical reason is kept for GO Along staff

    // a member without the company-settings right cannot clear
    const staff = as(t.token(['identity.user.read'], tenantId));
    expect((await staff('POST', '/starter/clear', { confirm: 'ล้างข้อมูลตัวอย่าง' })).status).toBe(403);

    expect((await call('POST', '/starter/clear', {})).status).toBe(400);
    const ok = await call('POST', '/starter/clear', { confirm: 'ล้างข้อมูลตัวอย่าง' });
    expect(ok.status).toBe(200);
    const ev = (await t.svc.db.pool.query(`select data from _outbox where type = 'identity.tenant_data_cleared' order by occurred_at desc limit 1`)).rows[0];
    expect(ev.data.data).toEqual({ reason: 'starter', by: 'Owner' });
    expect((await call('GET', '/starter')).body.starter).toBeNull();
    expect((await call('POST', '/starter/clear', { confirm: 'ล้างข้อมูลตัวอย่าง' })).status).toBe(409);
  });

  it('sign-up page lists the industries', async () => {
    const r = (await t.svc.app.inject({ method: 'GET', url: '/plans' })).json();
    expect(r.industries.map((i: { id: string }) => i.id)).toEqual(['trading', 'food', 'metal']);
  });
});
