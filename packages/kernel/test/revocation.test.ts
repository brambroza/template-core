import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createService, isKernelSubscription, KERNEL_SUBSCRIPTIONS, RevocationList, SESSION_REVOKED_MESSAGE, signToken, verifyToken, type ServiceDefinition } from '../src/index.ts';
import { bootTestService, TEST_INTERNAL_TOKEN, TEST_JWT_SECRET, type TestService } from '../src/testing.ts';

/** token revocation, security review 0.3 SEC-07 */
const seen: string[] = [];
const def = (subscribes: string[] = [], withHandler = false): ServiceDefinition => ({
  manifest: {
    id: 'notes', name: 'Notes', nameTh: 'โน้ต', version: '0.0.1', tier: 'feature', description: 'fixture',
    requires: [], enhancedBy: [], publishes: [], subscribes: subscribes as never[], permissions: [],
  },
  migrationsDir: fileURLToPath(new URL('./fixture/migrations', import.meta.url)),
  routes(app) {
    app.get('/whoami', async (req) => { const a = auth(req); return { userId: a.userId, tokenId: a.tokenId ?? null }; });
  },
  ...(withHandler ? { handlers: { 'identity.tokens_revoked': async (d: { userId: string }) => { seen.push(d.userId); } } } : {}),
});

const nowSec = () => Math.floor(Date.now() / 1000);
const tok = (tenantId: string, userId: string, iat?: number) => signToken(TEST_JWT_SECRET, { tenantId, userId, perms: ['*'] }, 3600, { iat });

let t: TestService;
beforeAll(async () => { t = await bootTestService(def()); });
afterAll(async () => { await t?.close(); });

describe('token claims', () => {
  it('gives every token a unique jti and keeps accepting tokens without one', () => {
    const a = verifyToken('s', signToken('s', { tenantId: 't', userId: 'u', perms: [] }));
    const b = verifyToken('s', signToken('s', { tenantId: 't', userId: 'u', perms: [] }));
    expect(a.tokenId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a.tokenId).not.toBe(b.tokenId);
    expect(a.issuedAt).toBeGreaterThan(0);
    // a pre-wave-9 token (no jti) still verifies
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ sub: 'u', tid: 't', perms: [], iat: nowSec(), exp: nowSec() + 60 })).toString('base64url');
    const old = `${h}.${p}.${createHmac('sha256', 's').update(`${h}.${p}`).digest('base64url')}`;
    expect(verifyToken('s', old).tokenId).toBeUndefined();
  });

  it('refuses a token issued before the cutoff, by user and company, with session_revoked', () => {
    const list = new RevocationList();
    const iat = nowSec();
    list.note('t1', 'u1', iat + 1);
    expect(() => verifyToken('s', signToken('s', { tenantId: 't1', userId: 'u1', perms: [] }), list.before)).toThrow(SESSION_REVOKED_MESSAGE);
    // issued at the cutoff → fine; other user / other company → fine
    expect(verifyToken('s', signToken('s', { tenantId: 't1', userId: 'u1', perms: [] }, 60, { iat: iat + 1 }), list.before).userId).toBe('u1');
    expect(verifyToken('s', signToken('s', { tenantId: 't1', userId: 'u2', perms: [] }), list.before).userId).toBe('u2');
    expect(verifyToken('s', signToken('s', { tenantId: 't2', userId: 'u1', perms: [] }), list.before).userId).toBe('u1');
    // an older cutoff never lowers a newer one
    list.note('t1', 'u1', 5);
    expect(list.before('t1', 'u1')).toBe(iat + 1);
  });

  it('lists the kernel subscriptions', () => {
    expect(KERNEL_SUBSCRIPTIONS).toContain('identity.tokens_revoked');
    expect(isKernelSubscription('identity.tokens_revoked')).toBe(true);
    expect(isKernelSubscription('sales.invoiced')).toBe(false);
  });
});

describe('revocation in a service (kernel subscription)', () => {
  it('refuses the user’s older tokens after identity.tokens_revoked is delivered, even though module.json does not subscribe', async () => {
    const userId = randomUUID();
    const old = tok(t.tenantId, userId);
    const bystander = tok(t.tenantId, randomUUID());
    expect((await t.api('GET', '/whoami', undefined, { token: old })).status).toBe(200);
    const d = await t.deliver('identity.tokens_revoked', { userId, before: nowSec() + 1, reason: 'logout' });
    expect(d.body.status).toBe('handled');
    const refused = await t.api('GET', '/whoami', undefined, { token: old });
    expect(refused.status).toBe(401);
    expect(refused.body.error).toEqual({ code: 'session_revoked', message: SESSION_REVOKED_MESSAGE });
    expect((await t.api('GET', '/whoami', undefined, { token: bystander })).status).toBe(200);
    // a token issued after the revocation (a new login) works
    const fresh = tok(t.tenantId, userId, nowSec() + 1);
    expect((await t.api('GET', '/whoami', undefined, { token: fresh })).status).toBe(200);
  });

  it('is idempotent: a duplicate delivery is ignored and an older cutoff never lowers the stored one', async () => {
    const userId = randomUUID();
    const id = randomUUID();
    const before = nowSec() + 1;
    expect((await t.deliver('identity.tokens_revoked', { userId, before, reason: 'admin' }, { id })).body.status).toBe('handled');
    expect((await t.deliver('identity.tokens_revoked', { userId, before, reason: 'admin' }, { id })).body.status).toBe('duplicate');
    expect((await t.deliver('identity.tokens_revoked', { userId, before: before - 1000, reason: 'logout' })).body.status).toBe('handled');
    const rows = await t.svc.db.tx(t.tenantId, async (c) => (await c.query('select before, reason from _revoked_tokens where user_id = $1', [userId])).rows);
    expect(rows).toEqual([{ before: String(before), reason: 'admin' }]);
    expect(t.svc.kernel.revocations.before(t.tenantId, userId)).toBe(before);
    expect((await t.api('GET', '/whoami', undefined, { token: tok(t.tenantId, userId, before - 1) })).status).toBe(401);
  });

  it('isolates _revoked_tokens by tenant (row-level security) and never revokes the same user id in another company', async () => {
    const userId = randomUUID();
    await t.deliver('identity.tokens_revoked', { userId, before: nowSec() + 1, reason: 'user_disabled' }, { tenantId: t.otherTenantId });
    expect((await t.api('GET', '/whoami', undefined, { token: tok(t.tenantId, userId) })).status).toBe(200);
    expect((await t.api('GET', '/whoami', undefined, { token: tok(t.otherTenantId, userId) })).status).toBe(401);
    const mine = await t.svc.db.tx(t.tenantId, async (c) => (await c.query('select tenant_id from _revoked_tokens where user_id = $1', [userId])).rows);
    expect(mine).toEqual([]);
    const theirs = await t.svc.db.tx(t.otherTenantId, async (c) => (await c.query('select tenant_id from _revoked_tokens where user_id = $1', [userId])).rows);
    expect(theirs).toEqual([{ tenant_id: t.otherTenantId }]);
    // without a tenant (and without the kernel's load flag) nothing is visible
    expect((await t.svc.db.pool.query('select * from _revoked_tokens')).rowCount).toBe(0);
    // and a tenant transaction cannot write another tenant's row
    await expect(t.svc.db.tx(t.tenantId, (c) => c.query('insert into _revoked_tokens (tenant_id, user_id, before, reason) values ($1, $2, 1, $3)', [t.otherTenantId, userId, 'admin']))).rejects.toThrow(/row-level security/);
  });

  it('another instance of the module picks the revocation up on reload (boot and periodic)', async () => {
    const userId = randomUUID();
    const second = createService(def(), { DATABASE_URL: (t.svc.db.pool as any).options.connectionString, JWT_SECRET: TEST_JWT_SECRET, INTERNAL_TOKEN: TEST_INTERNAL_TOKEN, NODE_ENV: 'test' });
    await second.app.ready();
    try {
      const old = tok(t.tenantId, userId);
      await t.deliver('identity.tokens_revoked', { userId, before: nowSec() + 1, reason: 'password_changed' });
      const call = () => second.app.inject({ method: 'GET', url: '/whoami', headers: { authorization: `Bearer ${old}` } });
      expect((await call()).statusCode).toBe(200); // not delivered to this instance yet
      expect(await second.reloadRevocations()).toBeGreaterThan(0);
      expect((await call()).statusCode).toBe(401);
      // a third instance booting now loads it before serving
      const third = createService(def(), { DATABASE_URL: (t.svc.db.pool as any).options.connectionString, JWT_SECRET: TEST_JWT_SECRET, INTERNAL_TOKEN: TEST_INTERNAL_TOKEN, NODE_ENV: 'test' });
      await third.app.ready();
      expect((await third.app.inject({ method: 'GET', url: '/whoami', headers: { authorization: `Bearer ${old}` } })).statusCode).toBe(401);
      await third.close();
    } finally {
      await second.close();
    }
  });

  it('accepts a module.json that lists the kernel subscription, and runs the module’s own handler after the kernel’s', async () => {
    seen.length = 0;
    const listed = await bootTestService(def(['identity.tokens_revoked'], true));
    try {
      const userId = randomUUID();
      const old = tok(listed.tenantId, userId);
      expect((await listed.deliver('identity.tokens_revoked', { userId, before: nowSec() + 1, reason: 'roles_changed' })).body.status).toBe('handled');
      expect(seen).toEqual([userId]);
      expect((await listed.api('GET', '/whoami', undefined, { token: old })).status).toBe(401);
    } finally {
      await listed.close();
    }
    // listing it without a handler is fine too
    const noHandler = await bootTestService(def(['identity.tokens_revoked']));
    await noHandler.close();
  });
});
