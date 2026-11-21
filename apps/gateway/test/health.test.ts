import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ErrorContext, ModuleManifest } from '@erp/kernel';
import { createGateway, installationHealth, type Gateway } from '../src/gateway.ts';

/** /api/_health for UptimeRobot: the whole installation, each module checked through its own /_health (database included). */
const manifest = (id: string): ModuleManifest => ({
  id, name: id, nameTh: id, version: '0.0.1', tier: 'core', description: id, requires: [], enhancedBy: [], publishes: [], subscribes: [], permissions: [],
});

const apps: FastifyInstance[] = [];
let dbUp = true;
async function fake(id: string, health: () => { code: number; status: string }): Promise<string> {
  const app = Fastify();
  app.get('/_manifest', async () => manifest(id));
  app.get('/_health', async (_req, reply) => { const h = health(); reply.code(h.code); return { status: h.status }; });
  app.get('/crash', async () => { throw new Error('bug in module'); });
  apps.push(app);
  return app.listen({ port: 0, host: '127.0.0.1' });
}

let gw: Gateway;
let modules: Record<string, string>;
const reported: ErrorContext[] = [];
beforeAll(async () => {
  modules = {
    identity: await fake('identity', () => ({ code: 200, status: 'ok' })),
    sales: await fake('sales', () => (dbUp ? { code: 200, status: 'ok' } : { code: 503, status: 'down' })),
  };
  gw = createGateway({ modules, internalToken: 'health-test-token', errors: { enabled: true, report: async (_e, ctx = {}) => { reported.push(ctx); } } });
  await gw.discover();
});
afterAll(async () => { await gw?.app.close(); for (const a of apps) await a.close(); });

describe('installation health', () => {
  it('200 "ok" when every module and its database answer', async () => {
    dbUp = true;
    const r = await gw.app.inject({ method: 'GET', url: '/api/_health' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.json()).toEqual({ status: 'ok', modules: { identity: 'ok', sales: 'ok' } });
  });

  it('503 naming the module that is down — never its address', async () => {
    dbUp = false;
    const r = await gw.app.inject({ method: 'GET', url: '/api/_health' });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ status: 'down', modules: { identity: 'ok', sales: 'down' } });
    expect(r.body).not.toContain('127.0.0.1');
    dbUp = true;
  });

  it('an unreachable module counts as down', async () => {
    const h = await installationHealth({ ...modules, ghost: 'http://127.0.0.1:1' }, 500);
    expect(h).toEqual({ ok: false, modules: { identity: 'ok', sales: 'ok', ghost: 'down' } });
  });
});

describe('module outage through the proxy', () => {
  it('a module that is down answers a Thai 502 and is not reported as a bug', async () => {
    const down = createGateway({ modules: { ghost: 'http://127.0.0.1:1' }, internalToken: 'x', errors: { enabled: true, report: async (_e, ctx = {}) => { reported.push(ctx); } } });
    reported.length = 0;
    const r = await down.app.inject({ method: 'GET', url: '/api/ghost/anything' });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toMatchObject({ code: 'module_unavailable' });
    expect(reported).toHaveLength(0);
    await down.app.close();
  });
});
