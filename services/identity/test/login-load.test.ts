import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, TEST_INTERNAL_TOKEN, type TestService } from '@erp/kernel/testing';
import { definition, resetLoginThrottle } from '../src/service.ts';

/**
 * Regression: login held its transaction while the throttle took a second pool connection, so as many simultaneous logins as the
 * pool has connections (10 by default) waited for each other forever — the demo seed hung on 9 parallel logins with a pool of 2.
 */
let t: TestService;
beforeAll(async () => {
  t = await bootTestService(definition);
  await resetLoginThrottle();
  await t.svc.app.inject({ method: 'POST', url: '/tenants', headers: { 'x-internal-token': TEST_INTERNAL_TOKEN }, payload: { code: 'busy', name: 'Busy', admin: { email: 'owner@busy.co', name: 'Owner', password: 'password123' } } });
});
afterAll(async () => { await t?.close(); });

const within = <T>(ms: number, p: Promise<T>) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error(`still waiting after ${ms} ms (deadlock)`)), ms))]);
const login = (password: string, ip: string) =>
  t.svc.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'owner@busy.co', password }, headers: { 'x-erp-client-ip': ip } });

describe('many logins at once', () => {
  it('30 right and 30 wrong passwords at the same moment all answer (more than the pool has connections)', async () => {
    const ok = await within(30_000, Promise.all(Array.from({ length: 30 }, (_, i) => login('password123', `198.51.100.${i}`))));
    expect(ok.map((r) => r.statusCode)).toEqual(Array(30).fill(200));
    const bad = await within(30_000, Promise.all(Array.from({ length: 30 }, (_, i) => login('wrong-password', `203.0.113.${i}`))));
    expect(bad.every((r) => r.statusCode === 401 || r.statusCode === 429)).toBe(true);
  }, 70_000);

  it('a wrong current password is still counted although the change is refused', async () => {
    const token = (await login('password123', '192.0.2.1')).json().token as string;
    const change = (current: string) => t.svc.app.inject({ method: 'POST', url: '/me/password', headers: { authorization: `Bearer ${token}` }, payload: { currentPassword: current, newPassword: 'another-pass-1' } });
    expect((await change('nope-nope')).statusCode).toBe(400);
    const n = Number((await t.svc.db.pool.query(`select count(*) as n from auth_attempts where key like 'me|%'`)).rows[0].n);
    expect(n).toBe(1);
  });
});
