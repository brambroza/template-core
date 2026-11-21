import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createErrorReporter, notFound, parseDsn, sentryEvent, stackFrames, type ServiceDefinition } from '../src/index.ts';
import { bootTestService, type TestService } from '../src/testing.ts';

/**
 * Production monitoring: unexpected errors (500) reach Sentry with ids only — never e-mails, bodies, headers or query strings —
 * and /_health answers 503 when the module cannot reach its database (what UptimeRobot watches through the gateway).
 */
const envelopes: { headers: IncomingMessage['headers']; url: string; lines: any[] }[] = [];
const sentry = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    envelopes.push({ headers: req.headers, url: req.url ?? '', lines: body.trim().split('\n').map((l) => JSON.parse(l)) });
    res.end('{}');
  });
});
let dsn = '';

const def: ServiceDefinition = {
  manifest: {
    id: 'notes', name: 'Notes', nameTh: 'โน้ต', version: '1.2.3', tier: 'feature', description: 'fixture',
    requires: [], enhancedBy: [], publishes: [], subscribes: [], permissions: [],
  },
  migrationsDir: fileURLToPath(new URL('./fixture/migrations', import.meta.url)),
  routes(app) {
    app.post('/boom/:id', async (req) => { auth(req); throw new Error('kaboom'); });
    app.get('/missing', async () => { throw notFound('ไม่พบ'); });
  },
};

let t: TestService;
beforeAll(async () => {
  await new Promise<void>((r) => sentry.listen(0, '127.0.0.1', r));
  dsn = `http://publickey@127.0.0.1:${(sentry.address() as AddressInfo).port}/42`;
  t = await bootTestService(def, { SENTRY_DSN: dsn, SENTRY_ENVIRONMENT: 'staging' });
});
afterAll(async () => { await t?.close(); sentry.close(); });

const waitFor = async (n: number) => { for (let i = 0; i < 50 && envelopes.length < n; i++) await new Promise((r) => setTimeout(r, 20)); };

describe('Sentry DSN', () => {
  it('builds the envelope URL; bad or empty DSNs turn reporting off', () => {
    expect(parseDsn('https://abc@o1.ingest.sentry.io/456')).toMatchObject({ url: 'https://o1.ingest.sentry.io/api/456/envelope/', publicKey: 'abc' });
    expect(parseDsn('https://abc@glitchtip.example.co.th/sub/7')?.url).toBe('https://glitchtip.example.co.th/sub/api/7/envelope/');
    expect(parseDsn('')).toBeNull();
    expect(parseDsn('not a url')).toBeNull();
    expect(parseDsn('https://o1.ingest.sentry.io/456')).toBeNull(); // no key
    const warnings: string[] = [];
    expect(createErrorReporter('x', '1', { SENTRY_DSN: 'nope' }, { warn: (m) => warnings.push(m) }).enabled).toBe(false);
    expect(warnings[0]).toContain('not a valid DSN');
    expect(createErrorReporter('x', '1', {}).enabled).toBe(false);
  });

  it('stack frames are oldest first and mark library code', () => {
    const frames = stackFrames('Error: x\n    at inner (/app/src/a.ts:10:5)\n    at /app/node_modules/fastify/lib/x.js:1:2\n    at node:internal/process:3:4');
    expect(frames.map((f) => f.lineno)).toEqual([3, 1, 10]);
    expect(frames.map((f) => f.in_app)).toEqual([false, false, true]);
    const ev = sentryEvent('plain string', {}, { module: 'm', release: 'm@1', environment: 'production' });
    expect(ev.exception).toMatchObject({ values: [{ type: 'Error', value: 'plain string' }] });
  });
});

describe('error reporting', () => {
  it('a 500 is reported with module, route pattern and ids — nothing the user typed', async () => {
    envelopes.length = 0;
    const token = t.token(['*'], t.tenantId, { userId: '11111111-2222-3333-4444-555555555555', userName: 'สมชาย ใจดี' });
    const r = await t.svc.app.inject({
      method: 'POST', url: '/boom/77?email=somchai@example.co.th', headers: { authorization: `Bearer ${token}`, cookie: 'secret=1' },
      payload: { taxId: '0105536000313' },
    });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: { code: 'internal', message: 'Internal error' } }); // the client never sees the error text
    await waitFor(1);
    expect(envelopes).toHaveLength(1);
    const [{ headers, url, lines }] = envelopes;
    expect(url).toBe('/api/42/envelope/');
    expect(headers['x-sentry-auth']).toContain('sentry_key=publickey');
    expect(lines[1]).toEqual({ type: 'event' });
    expect(lines[2]).toMatchObject({
      level: 'error', release: 'notes@1.2.3', environment: 'staging',
      tags: { module: 'notes', kind: 'request', tenant_id: t.tenantId },
      user: { id: '11111111-2222-3333-4444-555555555555' },
      request: { method: 'POST', url: '/boom/:id' },
      exception: { values: [{ type: 'Error', value: 'kaboom' }] },
    });
    const raw = JSON.stringify(lines);
    for (const leak of ['somchai', '0105536000313', 'สมชาย', 'Bearer', 'secret=1', '/boom/77']) expect(raw).not.toContain(leak);
  });

  it('expected answers (4xx) are not reported', async () => {
    envelopes.length = 0;
    expect((await t.api('GET', '/missing')).status).toBe(404);
    expect((await t.api('GET', '/nothing-here')).status).toBe(404);
    await new Promise((r) => setTimeout(r, 100));
    expect(envelopes).toHaveLength(0);
  });

  it('at most N reports a minute, and a dead Sentry never breaks the caller', async () => {
    let calls = 0;
    const fake = (async () => { calls++; return new Response('{}'); }) as typeof fetch;
    const rep = createErrorReporter('m', '1', { SENTRY_DSN: dsn }, { perMinute: 3, fetch: fake });
    for (let i = 0; i < 10; i++) await rep.report(new Error(`e${i}`));
    expect(calls).toBe(3);
    const warnings: string[] = [];
    const down = createErrorReporter('m', '1', { SENTRY_DSN: 'http://k@127.0.0.1:1/1' }, { warn: (m) => warnings.push(m) });
    await expect(down.report(new Error('x'))).resolves.toBeUndefined();
    await down.report(new Error('y'));
    expect(warnings).toHaveLength(1);
  });
});

describe('health', () => {
  it('ok while the database answers, 503 when it does not', async () => {
    const ok = await t.svc.app.inject({ method: 'GET', url: '/_health' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: 'ok', module: 'notes', version: '1.2.3', db: 'ok' });
    const original = t.svc.db.pool.query.bind(t.svc.db.pool);
    (t.svc.db.pool as { query: unknown }).query = async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); };
    try {
      const down = await t.svc.app.inject({ method: 'GET', url: '/_health' });
      expect(down.statusCode).toBe(503);
      expect(down.json()).toMatchObject({ status: 'down', db: 'down' });
    } finally {
      (t.svc.db.pool as { query: unknown }).query = original;
    }
  });
});
