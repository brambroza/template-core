import { randomUUID } from 'node:crypto';
import { createService, type Service, type ServiceDefinition } from '@erp/kernel';
import { createTestDatabase, TEST_INTERNAL_TOKEN, TEST_JWT_SECRET } from '@erp/kernel/testing';
import { createGateway, type Gateway } from '@erp/gateway';

export interface Installation {
  gateway: Gateway;
  url: string;
  services: Record<string, Service>;
  /** deliver every pending event until the system is quiet (what the background dispatcher does every second) */
  settle(): Promise<void>;
  call<T = any>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: T }>;
  provision(code: string): Promise<{ token: string; tenantId: string }>;
  close(): Promise<void>;
}

/** Boot a real installation: the chosen modules on real ports, each with its own database, behind a gateway. */
export async function install(defs: ServiceDefinition[], extraEnv: Record<string, string> = {}): Promise<Installation> {
  const services: Record<string, Service> = {};
  const envs: Record<string, NodeJS.ProcessEnv> = {};
  const drops: (() => Promise<void>)[] = [];
  const urls: Record<string, string> = {};
  for (const def of defs) {
    const db = await createTestDatabase(`e2e_${def.manifest.id}`);
    drops.push(db.drop);
    envs[def.manifest.id] = { DATABASE_URL: db.url, JWT_SECRET: TEST_JWT_SECRET, INTERNAL_TOKEN: TEST_INTERNAL_TOKEN, NODE_ENV: 'test', ...extraEnv };
    const svc = createService(def, envs[def.manifest.id]);
    urls[def.manifest.id] = await svc.start({ port: 0, host: '127.0.0.1' });
    services[def.manifest.id] = svc;
  }
  const gateway = createGateway({ modules: urls, internalToken: TEST_INTERNAL_TOKEN });
  await gateway.discover();
  const url = await gateway.app.listen({ port: 0, host: '127.0.0.1' });
  for (const env of Object.values(envs)) env.EVENT_ROUTER_URL = `${url}/_events/publish`;

  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };

  return {
    gateway, url, services, call,
    async settle() {
      for (let round = 0; round < 10; round++) {
        let sent = 0;
        for (const svc of Object.values(services)) {
          const r = await svc.dispatch();
          if (r.failed) throw new Error(`${svc.manifest.id}: ${r.failed} event(s) failed to deliver`);
          sent += r.sent;
        }
        if (sent === 0) return;
      }
      throw new Error('events did not settle');
    },
    async provision(code) {
      const identity = urls.identity;
      const res = await fetch(`${identity}/tenants`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': TEST_INTERNAL_TOKEN },
        body: JSON.stringify({ code, name: code, admin: { email: 'admin@example.com', name: 'Admin', password: 'password123' } }),
      });
      if (res.status !== 201) throw new Error(`provision failed: ${await res.text()}`);
      const login = await call('POST', '/api/identity/auth/login', { tenant: code, email: 'admin@example.com', password: 'password123' });
      return { token: login.body.token, tenantId: login.body.tenant.id };
    },
    async close() {
      await gateway.app.close();
      for (const svc of Object.values(services)) await svc.close();
      for (const d of drops) await d();
    },
  };
}

export const uid = () => randomUUID();
