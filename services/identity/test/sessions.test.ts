import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_REVOKED_MESSAGE, verifyToken } from '@erp/kernel';
import { bootTestService, TEST_INTERNAL_TOKEN, TEST_JWT_SECRET, type TestService } from '@erp/kernel/testing';
import { definition, resetLoginThrottle, revocationCutoff } from '../src/service.ts';
import ui from '../src/ui.ts';

/** Logout everywhere, password change, and revocation on disable / role change / admin action (security review 0.3, SEC-07). */
let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); resetLoginThrottle(); });
afterAll(async () => { await t?.close(); });

async function createTenant(code: string) {
  const res = await t.svc.app.inject({
    method: 'POST', url: '/tenants', headers: { 'x-internal-token': TEST_INTERNAL_TOKEN },
    payload: { code, name: `${code} co`, admin: { email: `admin@${code}.co`, name: 'Admin', password: 'password123' } },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function login(tenant: string, email: string, password: string) {
  const res = await t.svc.app.inject({ method: 'POST', url: '/auth/login', payload: { tenant, email, password } });
  return { status: res.statusCode, body: res.json() };
}

const me = (token: string) => t.api('GET', '/me', undefined, { token });
const revocations = async (userId: string) => (await t.published('identity.tokens_revoked')).filter((e) => e.data.userId === userId).map((e) => e.data);

/** tenant with an admin and a clerk (role with a few permissions) */
async function setup(code: string) {
  const { tenant } = await createTenant(code);
  const admin = (await login(code, `admin@${code}.co`, 'password123')).body;
  const role = (await t.api('POST', '/roles', { name: 'Clerk', permissions: ['sales.order.read'] }, { token: admin.token })).body;
  const clerkUser = (await t.api('POST', '/users', { email: `clerk@${code}.co`, name: 'สมศรี', password: 'password123', roleIds: [role.id] }, { token: admin.token })).body;
  const clerk = (await login(code, `clerk@${code}.co`, 'password123')).body;
  return { tenant, admin, role, clerkUser, clerk };
}

describe('logout everywhere', () => {
  it('revokes every token of the user at once (identity itself) and emits identity.tokens_revoked; a new login works right away', async () => {
    const { clerk, clerkUser } = await setup('lo-a');
    const other = (await login('lo-a', 'clerk@lo-a.co', 'password123')).body; // a second device
    expect((await me(clerk.token)).status).toBe(200);
    const out = await t.api('POST', '/logout', undefined, { token: clerk.token });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ ok: true, message: 'ออกจากระบบทุกอุปกรณ์แล้ว' });
    for (const tok of [clerk.token, other.token]) {
      const r = await me(tok);
      expect(r.status).toBe(401);
      expect(r.body.error).toEqual({ code: 'session_revoked', message: SESSION_REVOKED_MESSAGE });
    }
    const ev = await revocations(clerkUser.id);
    expect(ev).toEqual([{ userId: clerkUser.id, before: out.body.revokedBefore, reason: 'logout' }]);
    expect(out.body.revokedBefore).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000));
    // logging in again in the same second is not refused: the new token is issued at the cutoff
    const again = (await login('lo-a', 'clerk@lo-a.co', 'password123')).body;
    expect(verifyToken(TEST_JWT_SECRET, again.token).issuedAt).toBeGreaterThanOrEqual(out.body.revokedBefore);
    expect((await me(again.token)).status).toBe(200);
  });

  it('needs a signed-in user and only logs out that user', async () => {
    const { admin, clerk } = await setup('lo-b');
    expect((await t.raw('POST', '/logout', undefined, { token: null })).status).toBe(401);
    await t.api('POST', '/logout', undefined, { token: clerk.token });
    expect((await me(admin.token)).status).toBe(200);
  });

  it('cuts off at the next second, so a token from earlier in the same second is refused too', () => {
    expect(revocationCutoff(1_700_000_000_999)).toBe(1_700_000_001);
    expect(revocationCutoff(1_700_000_000_000)).toBe(1_700_000_001);
    // a token issued at an earlier cutoff (login right after a logout) must die on the next revocation in the same second
    expect(revocationCutoff(1_700_000_000_000, 1_700_000_001)).toBe(1_700_000_002);
  });

  it('a second revocation in the same second also kills the token issued at the first cutoff', async () => {
    await setup('lo-c');
    const first = (await login('lo-c', 'clerk@lo-c.co', 'password123')).body;
    const out1 = await t.api('POST', '/logout', undefined, { token: first.token });
    const second = (await login('lo-c', 'clerk@lo-c.co', 'password123')).body; // iat = first cutoff
    expect((await me(second.token)).status).toBe(200);
    const out2 = await t.api('POST', '/logout', undefined, { token: second.token });
    expect(out2.body.revokedBefore).toBeGreaterThan(out1.body.revokedBefore);
    expect((await me(second.token)).status).toBe(401);
    const third = (await login('lo-c', 'clerk@lo-c.co', 'password123')).body;
    expect((await me(third.token)).status).toBe(200);
  });
});

describe('change own password', () => {
  it('checks the current password and the new one', async () => {
    const { clerk } = await setup('pw-a');
    const wrong = await t.api('POST', '/me/password', { currentPassword: 'nope-nope', newPassword: 'newpassword1' }, { token: clerk.token });
    expect(wrong.status).toBe(400); // not 401: the web app would log the user out
    expect(wrong.body.error.details.fieldErrors.currentPassword).toEqual(['รหัสผ่านปัจจุบันไม่ถูกต้อง']);
    const short = await t.api('POST', '/me/password', { currentPassword: 'password123', newPassword: 'short' }, { token: clerk.token });
    expect(short.status).toBe(400);
    expect(short.body.error.details.fieldErrors.newPassword[0]).toContain('8');
    const same = await t.api('POST', '/me/password', { currentPassword: 'password123', newPassword: 'password123' }, { token: clerk.token });
    expect(same.status).toBe(400);
    expect((await me(clerk.token)).status).toBe(200); // nothing revoked
    expect((await t.raw('POST', '/me/password', { currentPassword: 'password123', newPassword: 'newpassword1' }, { token: null })).status).toBe(401);
  });

  it('changes it, revokes older tokens and hands back a new token (body + x-erp-session-token)', async () => {
    const { clerk, clerkUser } = await setup('pw-b');
    const res = await t.raw('POST', '/me/password', { currentPassword: 'password123', newPassword: 'newpassword1' }, { token: clerk.token });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body.toString());
    expect(body.message).toContain('เปลี่ยนรหัสผ่านแล้ว');
    expect(res.headers['x-erp-session-token']).toBe(body.token);
    expect((await me(clerk.token)).status).toBe(401);
    const fresh = await me(body.token);
    expect(fresh.status).toBe(200);
    expect(fresh.body.permissions).toEqual(['sales.order.read']);
    expect((await login('pw-b', 'clerk@pw-b.co', 'password123')).status).toBe(401);
    expect((await login('pw-b', 'clerk@pw-b.co', 'newpassword1')).status).toBe(200);
    expect((await revocations(clerkUser.id)).map((e) => e.reason)).toEqual(['password_changed']);
    // the new password is never written to the audit log
    const audit = await t.svc.db.tx(body.token ? verifyToken(TEST_JWT_SECRET, body.token).tenantId : '', async (c) =>
      (await c.query(`select summary from _audit where route = '/me/password'`)).rows);
    expect(JSON.stringify(audit)).not.toContain('newpassword1');
  });
});

describe('admin actions revoke the user’s sessions', () => {
  it('disabling a user revokes their tokens', async () => {
    const { admin, clerk, clerkUser } = await setup('ad-a');
    expect((await t.api('POST', `/users/${clerkUser.id}/deactivate`, undefined, { token: admin.token })).status).toBe(200);
    expect((await me(clerk.token)).status).toBe(401);
    expect((await revocations(clerkUser.id)).map((e) => e.reason)).toEqual(['user_disabled']);
  });

  it('changing a user’s roles revokes their tokens, so the new permissions apply at once', async () => {
    const { admin, clerk, clerkUser } = await setup('ad-b');
    const role2 = (await t.api('POST', '/roles', { name: 'Viewer', permissions: ['inventory.balance.read'] }, { token: admin.token })).body;
    const r = await t.api('PUT', `/users/${clerkUser.id}/roles`, { roleIds: [role2.id] }, { token: admin.token });
    expect(r.status).toBe(200);
    expect(r.body.message).toContain('เข้าสู่ระบบใหม่');
    expect((await me(clerk.token)).status).toBe(401);
    expect((await revocations(clerkUser.id)).map((e) => e.reason)).toEqual(['roles_changed']);
    expect((await login('ad-b', 'clerk@ad-b.co', 'password123')).body.permissions).toEqual(['inventory.balance.read']);
  });

  it('"บังคับออกจากระบบ": needs identity.user.write, cannot target someone with more rights, then revokes', async () => {
    const { tenant, admin, clerk, clerkUser } = await setup('ad-c');
    const hrRole = (await t.api('POST', '/roles', { name: 'HR', permissions: ['identity.user.read', 'identity.user.write', 'sales.order.read'] }, { token: admin.token })).body;
    await t.api('POST', '/users', { email: 'hr@x.co', name: 'HR', password: 'password123', roleIds: [hrRole.id] }, { token: admin.token });
    const hr = (await login('ad-c', 'hr@x.co', 'password123')).body;
    expect((await t.api('POST', `/users/${clerkUser.id}/revoke-sessions`, undefined, { token: clerk.token })).status).toBe(403);
    expect((await t.api('POST', `/users/${admin.user.id}/revoke-sessions`, undefined, { token: hr.token })).status).toBe(403);
    expect((await me(admin.token)).status).toBe(200);
    const ok = await t.api('POST', `/users/${clerkUser.id}/revoke-sessions`, undefined, { token: hr.token });
    expect(ok.status).toBe(200);
    expect(ok.body.message).toBe('บังคับให้ สมศรี ออกจากระบบทุกอุปกรณ์แล้ว');
    expect((await me(clerk.token)).status).toBe(401);
    expect((await revocations(clerkUser.id)).map((e) => e.reason)).toEqual(['admin']);
    // the user detail shows it
    const detail = await t.api('GET', `/users/${clerkUser.id}`, undefined, { token: hr.token });
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: clerkUser.id, name: 'สมศรี', roles: ['Clerk'], sessions_revoked_reason: 'ผู้ดูแลบังคับออกจากระบบ' });
    expect(detail.body).not.toHaveProperty('password_hash');
    expect(detail.body.sessions_revoked_at).toBeTruthy();
    // a user may still log in again (unlike a disabled one)
    expect((await login('ad-c', 'clerk@ad-c.co', 'password123')).status).toBe(200);
    expect(tenant.id).toBeTruthy();
  });

  it('GET /users/:id needs identity.user.read and stays within the company', async () => {
    const a = await setup('ad-d');
    const b = await setup('ad-e');
    expect((await t.api('GET', `/users/${a.clerkUser.id}`, undefined, { token: a.clerk.token })).status).toBe(403);
    expect((await t.api('GET', `/users/${a.clerkUser.id}`, undefined, { token: b.admin.token })).status).toBe(404);
    expect((await t.api('POST', `/users/${a.clerkUser.id}/revoke-sessions`, undefined, { token: b.admin.token })).status).toBe(404);
    expect((await me(a.clerk.token)).status).toBe(200);
  });
});

describe('screens', () => {
  it('offers change password to everyone and force logout on the user detail', () => {
    const cp = ui.screens.changePassword;
    expect(cp.kind).toBe('form');
    expect(cp.perm).toBeUndefined();
    expect(ui.menu.some((m) => m.screen === 'changePassword')).toBe(false); // linked from the user box, not the admin menu
    const detail = ui.screens.userDetail;
    expect(detail.kind === 'detail' && detail.actions?.find((x) => x.id === 'forceLogout')).toMatchObject({ endpoint: '/users/:id/revoke-sessions', perm: 'identity.user.write' });
  });
});
