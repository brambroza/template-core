import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, checkLicense, createService, secretProblems, generateLicenseKeys, hasPerm, hashPassword, issueLicense, nextDocNo, parse, requirePerm, signToken, verifyPassword, verifyToken, z, type ServiceDefinition } from '../src/index.ts';
import { bootTestService, type TestService } from '../src/testing.ts';

const def: ServiceDefinition = {
  manifest: {
    id: 'notes', name: 'Notes', nameTh: 'โน้ต', version: '0.0.1', tier: 'feature', description: 'fixture',
    requires: [], enhancedBy: [], publishes: ['master.item_upserted'], subscribes: ['master.item_upserted'], permissions: [],
  },
  migrationsDir: fileURLToPath(new URL('./fixture/migrations', import.meta.url)),
  routes(app, k) {
    app.post('/notes', async (req) => {
      const a = auth(req);
      const body = parse(z.object({ body: z.string() }), req.body);
      return k.db.tx(a.tenantId, async (c) => (await c.query('insert into notes(body) values ($1) returning *', [body.body])).rows[0]);
    });
    app.get('/notes', async (req) => k.db.tx(auth(req).tenantId, async (c) => (await c.query('select * from notes')).rows));
    app.post('/docno', async (req) => k.db.tx(auth(req).tenantId, async (c) => ({ no: await nextDocNo(c, 'PO', new Date('2026-10-02')) })));
  },
  handlers: {
    'master.item_upserted': async (data, ctx) => {
      await ctx.client.query('insert into notes(body) values ($1)', [`item ${data.code}`]);
    },
  },
};

let t: TestService;
beforeAll(async () => { t = await bootTestService(def); });
afterAll(async () => { await t?.close(); });

describe('kernel', () => {
  it('isolates tenants with row-level security', async () => {
    await t.api('POST', '/notes', { body: 'mine' });
    const other = t.token(['*'], t.otherTenantId);
    await t.api('POST', '/notes', { body: 'theirs' }, { token: other });
    const mine = await t.api('GET', '/notes');
    expect(mine.body.map((n: any) => n.body)).toEqual(['mine']);
    expect(mine.body[0].tenant_id).toBe(t.tenantId);
    // even a raw query without tenant context sees nothing
    const raw = await t.svc.db.pool.query('select * from notes');
    expect(raw.rowCount).toBe(0);
  });

  it('rejects missing or bad tokens and validates input', async () => {
    const res = await t.svc.app.inject({ method: 'GET', url: '/notes' });
    expect(res.statusCode).toBe(401);
    const bad = await t.api('POST', '/notes', { nope: 1 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('bad_request');
  });

  it('numbers documents per tenant in Buddhist years', async () => {
    expect((await t.api('POST', '/docno')).body.no).toBe('PO-2569-0001');
    expect((await t.api('POST', '/docno')).body.no).toBe('PO-2569-0002');
    expect((await t.api('POST', '/docno', undefined, { token: t.token(['*'], t.otherTenantId) })).body.no).toBe('PO-2569-0001');
  });

  it('handles each inbound event once', async () => {
    const id = crypto.randomUUID();
    const data = { itemId: crypto.randomUUID(), code: 'RM-1', name: 'Steel', type: 'raw', uom: 'kg' };
    expect((await t.deliver('master.item_upserted', data, { id })).body.status).toBe('handled');
    expect((await t.deliver('master.item_upserted', data, { id })).body.status).toBe('duplicate');
    expect((await t.deliver('sales.invoiced', {})).body.status).toBe('ignored');
    const notes = await t.api('GET', '/notes');
    expect(notes.body.filter((n: any) => n.body === 'item RM-1')).toHaveLength(1);
    const unauth = await t.svc.app.inject({ method: 'POST', url: '/_events', payload: {} });
    expect(unauth.statusCode).toBe(401);
  });

  it('exposes health and manifest publicly', async () => {
    const res = await t.svc.app.inject({ method: 'GET', url: '/_manifest' });
    expect(res.json().id).toBe('notes');
  });
});

describe('auth helpers', () => {
  it('signs and verifies tokens, checks permissions', () => {
    const tok = signToken('s', { tenantId: 't', userId: 'u', perms: ['sales.*'] });
    const ctx = verifyToken('s', tok);
    expect(hasPerm(ctx, 'sales.order.create')).toBe(true);
    expect(hasPerm(ctx, 'inventory.move.create')).toBe(false);
    expect(() => requirePerm(ctx, 'inventory.move.create')).toThrow(/Missing permission/);
    expect(() => verifyToken('other', tok)).toThrow(/Invalid token/);
  });

  it('SEC-12 (security review 0.3): refuses tokens without an expiry and expired tokens', () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const forge = (claims: object) => {
      const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}`;
      return `${head}.${createHmac('sha256', 's').update(head).digest('base64url')}`;
    };
    expect(() => verifyToken('s', forge({ sub: 'u', tid: 't', perms: ['*'] }))).toThrow(/Invalid token claims/);
    expect(() => verifyToken('s', forge({ sub: 'u', tid: 't', perms: ['*'], exp: 1 }))).toThrow(/expired/);
    expect(verifyToken('s', forge({ sub: 'u', tid: 't', perms: ['*'], exp: Math.floor(Date.now() / 1000) + 60 })).perms).toEqual(['*']);
    // alg is never taken from the header: an "alg":"none" token without a valid HMAC is rejected
    const none = `${b64({ alg: 'none' })}.${b64({ sub: 'u', tid: 't', perms: ['*'], exp: 9999999999 })}.`;
    expect(() => verifyToken('s', none)).toThrow(/Invalid token/);
  });

  it('SEC-03 (security review 0.3): refuses example / weak secrets', () => {
    expect(secretProblems({ JWT_SECRET: 'replace-with-64-random-characters', INTERNAL_TOKEN: 'x'.repeat(40) })).toHaveLength(1);
    expect(secretProblems({ JWT_SECRET: 'a'.repeat(40), INTERNAL_TOKEN: 'replace-with-another-random-string' })[0]).toMatch(/INTERNAL_TOKEN/);
    expect(secretProblems({ JWT_SECRET: 'short-dev-secret', INTERNAL_TOKEN: 'short-dev-token', NODE_ENV: 'development' })).toEqual([]);
    expect(secretProblems({ JWT_SECRET: 'short-dev-secret', INTERNAL_TOKEN: 'b'.repeat(40), NODE_ENV: 'production' })[0]).toMatch(/shorter than 32/);
    expect(secretProblems({ JWT_SECRET: 'c'.repeat(40), INTERNAL_TOKEN: 'c'.repeat(40), NODE_ENV: 'production' })[0]).toMatch(/different/);
    expect(secretProblems({ JWT_SECRET: 'd'.repeat(40), INTERNAL_TOKEN: 'e'.repeat(40), NODE_ENV: 'production' })).toEqual([]);
  });

  it('SEC-03: a service will not start with the .env.example secret', async () => {
    const svc = createService(def, { DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none', JWT_SECRET: 'replace-with-64-random-characters', INTERNAL_TOKEN: 'x'.repeat(40) });
    await expect(svc.start({ port: 0 })).rejects.toThrow(/refusing to start: JWT_SECRET/);
    await svc.close();
  });

  it('hashes passwords', () => {
    const h = hashPassword('secret');
    expect(verifyPassword('secret', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
  });
});

describe('licensing', () => {
  const keys = generateLicenseKeys();
  const lic = issueLicense(keys.privateKeyPem, { licenseId: 'L1', customer: 'ACME', modules: ['sales'], issuedAt: '2026-10-02' });
  const env = (extra: Record<string, string>) => ({ ERP_LICENSE_PUBLIC_KEY: keys.publicKeyPem, ...extra }) as NodeJS.ProcessEnv;

  it('allows purchased modules and core modules only', () => {
    expect(checkLicense('sales', 'feature', env({ ERP_LICENSE: lic })).ok).toBe(true);
    expect(checkLicense('identity', 'core', env({ ERP_LICENSE: lic })).ok).toBe(true);
    const denied = checkLicense('inventory', 'feature', env({ ERP_LICENSE: lic }));
    expect(denied).toMatchObject({ ok: false, reason: expect.stringContaining('not included') });
  });

  it('rejects tampered or expired licenses and requires one in production', () => {
    const [body, sig] = lic.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), modules: ['sales', 'inventory'] })).toString('base64url');
    expect(checkLicense('inventory', 'feature', env({ ERP_LICENSE: `${forged}.${sig}` })).ok).toBe(false);
    const expired = issueLicense(keys.privateKeyPem, { licenseId: 'L2', customer: 'ACME', modules: ['sales'], issuedAt: '2020-01-01', expiresAt: '2021-01-01' });
    expect(checkLicense('sales', 'feature', env({ ERP_LICENSE: expired })).ok).toBe(false);
    expect(checkLicense('sales', 'feature', env({ NODE_ENV: 'production' })).ok).toBe(false);
    expect(checkLicense('sales', 'feature', env({})).ok).toBe(true);
  });
});
