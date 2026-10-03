import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleManifest } from '@erp/kernel';
import { createGateway, routeTargets, type Gateway } from '../src/gateway.ts';

/** Event router: kernel subscriptions (identity.tokens_revoked, security review 0.3 SEC-07) reach every installed module. */
const TOKEN = 'router-test-internal-token';
const manifest = (id: string, subscribes: string[] = [], tier: 'core' | 'feature' = 'feature'): ModuleManifest => ({
  id, name: id, nameTh: id, version: '0.0.1', tier, description: id, requires: [], enhancedBy: [], publishes: [], subscribes: subscribes as never[], permissions: [],
});

const received: Record<string, string[]> = {};
const fakes: FastifyInstance[] = [];
let gw: Gateway;

async function fakeModule(m: ModuleManifest): Promise<string> {
  const app = Fastify();
  received[m.id] = [];
  app.get('/_manifest', async () => m);
  app.get('/export', async (_req, reply) => {
    reply.header('content-type', 'text/plain; charset=utf-8').header('content-disposition', 'attachment; filename="x.txt"');
    reply.header('x-rd-prep-layout', 'unverified').header('x-internal-secret', 'nope');
    return 'a|b';
  });
  app.post('/_events', async (req) => {
    if (req.headers['x-internal-token'] !== TOKEN) return { status: 'bad token' };
    received[m.id].push((req.body as { type: string }).type);
    return { status: 'handled' };
  });
  fakes.push(app);
  return app.listen({ port: 0, host: '127.0.0.1' });
}

beforeAll(async () => {
  const modules: Record<string, string> = {};
  for (const m of [manifest('identity', [], 'core'), manifest('master-data', [], 'core'), manifest('sales', ['inventory.stock_moved']), manifest('inventory', ['sales.delivered'])]) {
    modules[m.id] = await fakeModule(m);
  }
  gw = createGateway({ modules, internalToken: TOKEN });
  await gw.discover();
});
afterAll(async () => {
  await gw?.app.close();
  for (const f of fakes) await f.close();
});

const publish = (event: Record<string, unknown>, token = TOKEN) =>
  gw.app.inject({ method: 'POST', url: '/_events/publish', headers: { 'x-internal-token': token }, payload: event });
const reset = () => { for (const k of Object.keys(received)) received[k] = []; };

describe('event router', () => {
  it('fans identity.tokens_revoked out to every installed module except the publisher, whatever module.json subscribes', async () => {
    reset();
    const res = await publish({ id: crypto.randomUUID(), type: 'identity.tokens_revoked', tenantId: crypto.randomUUID(), source: 'identity', occurredAt: new Date().toISOString(), data: { userId: crypto.randomUUID(), before: 1, reason: 'logout' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().delivered.map((d: { module: string }) => d.module).sort()).toEqual(['inventory', 'master-data', 'sales']);
    expect(received).toEqual({ identity: [], 'master-data': ['identity.tokens_revoked'], sales: ['identity.tokens_revoked'], inventory: ['identity.tokens_revoked'] });
  });

  it('still sends ordinary events only to their subscribers', async () => {
    reset();
    const res = await publish({ id: crypto.randomUUID(), type: 'sales.delivered', tenantId: crypto.randomUUID(), source: 'sales', occurredAt: new Date().toISOString(), data: {} });
    expect(res.json().delivered.map((d: { module: string }) => d.module)).toEqual(['inventory']);
    expect(received.inventory).toEqual(['sales.delivered']);
    expect(received['master-data']).toEqual([]);
  });

  it('refuses a publish without the internal token', async () => {
    expect((await publish({ type: 'identity.tokens_revoked', source: 'x' }, 'wrong')).statusCode).toBe(401);
  });

  it('routeTargets', () => {
    const ms = [manifest('identity'), manifest('a', ['x.y']), manifest('b')];
    expect(routeTargets(ms, { type: 'identity.tokens_revoked', source: 'identity' }).map((m) => m.id)).toEqual(['a', 'b']);
    expect(routeTargets(ms, { type: 'x.y', source: 'b' }).map((m) => m.id)).toEqual(['a']);
    expect(routeTargets(ms, { source: 'b' })).toEqual([]);
  });
});

describe('proxy', () => {
  it('passes the RD Prep "unverified" marker and download headers through, but not arbitrary module headers', async () => {
    const res = await gw.app.inject({ method: 'GET', url: '/api/sales/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-rd-prep-layout']).toBe('unverified');
    expect(res.headers['content-disposition']).toContain('x.txt');
    expect(res.headers['x-internal-secret']).toBeUndefined();
    expect(res.body).toBe('a|b');
  });
});
