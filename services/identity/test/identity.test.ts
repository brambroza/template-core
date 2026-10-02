import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyToken } from '@erp/kernel';
import { bootTestService, TEST_INTERNAL_TOKEN, TEST_JWT_SECRET, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

async function createTenant(code: string) {
  const res = await t.svc.app.inject({
    method: 'POST', url: '/tenants', headers: { 'x-internal-token': TEST_INTERNAL_TOKEN },
    payload: { code, name: `${code} co`, admin: { email: 'admin@x.co', name: 'Admin', password: 'password123' } },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function login(tenant: string, email: string, password: string) {
  const res = await t.svc.app.inject({ method: 'POST', url: '/auth/login', payload: { tenant, email, password } });
  return { status: res.statusCode, body: res.json() };
}

describe('identity', () => {
  it('provisions a tenant and logs the admin in with full permissions', async () => {
    const { tenant } = await createTenant('acme');
    const r = await login('acme', 'ADMIN@x.co', 'password123');
    expect(r.status).toBe(200);
    const claims = verifyToken(TEST_JWT_SECRET, r.body.token);
    expect(claims.tenantId).toBe(tenant.id);
    expect(claims.perms).toEqual(['*']);
    expect((await login('acme', 'admin@x.co', 'wrong-pass')).status).toBe(401);
    expect((await login('nope', 'admin@x.co', 'password123')).status).toBe(401);
  });

  it('only provisions tenants with the internal token', async () => {
    const res = await t.svc.app.inject({ method: 'POST', url: '/tenants', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('creates roles and users whose token carries role permissions', async () => {
    await createTenant('beta');
    const admin = await login('beta', 'admin@x.co', 'password123');
    const as = { token: admin.body.token };
    const role = await t.api('POST', '/roles', { name: 'Storekeeper', permissions: ['inventory.*', 'master.item.read'] }, as);
    expect(role.status).toBe(201);
    const user = await t.api('POST', '/users', { email: 'store@x.co', name: 'Store', password: 'password123', roleIds: [role.body.id] }, as);
    expect(user.status).toBe(201);
    const store = await login('beta', 'store@x.co', 'password123');
    expect(store.body.permissions).toEqual(['inventory.*', 'master.item.read']);
    const forbidden = await t.api('POST', '/users', { email: 'x@x.co', name: 'X', password: 'password123' }, { token: store.body.token });
    expect(forbidden.status).toBe(403);
    const users = await t.api('GET', '/users', undefined, as);
    expect(users.body.map((u: any) => u.email)).toEqual(['admin@x.co', 'store@x.co']);
    expect(users.body[0]).not.toHaveProperty('password_hash');
    await t.api('POST', `/users/${user.body.id}/deactivate`, undefined, as);
    expect((await login('beta', 'store@x.co', 'password123')).status).toBe(401);
  });

  it('keeps tenants apart', async () => {
    const acme = await login('acme', 'admin@x.co', 'password123');
    const users = await t.api('GET', '/users', undefined, { token: acme.body.token });
    expect(users.body.map((u: any) => u.email)).toEqual(['admin@x.co']);
    const dup = await t.api('POST', '/users', { email: 'admin@x.co', name: 'Dup', password: 'password123' }, { token: acme.body.token });
    expect(dup.status).toBe(409);
  });
});
