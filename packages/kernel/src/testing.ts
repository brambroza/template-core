/**
 * Test helpers: every service test boots the real service against a fresh Postgres database
 * (owned by the non-superuser role `erp_app`, so row-level security is really enforced).
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { signToken } from './auth.ts';
import { createService, type Service, type ServiceDefinition } from './service.ts';

const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const APP_USER = process.env.TEST_DATABASE_APP_USER ?? 'erp_app';
const APP_PASSWORD = process.env.TEST_DATABASE_APP_PASSWORD ?? 'erp_app';

export const TEST_JWT_SECRET = 'test-jwt-secret';
export const TEST_INTERNAL_TOKEN = 'test-internal-token';

export async function createTestDatabase(label: string): Promise<{ url: string; drop: () => Promise<void> }> {
  const name = `t_${label.replace(/[^a-z0-9]/gi, '_')}_${randomUUID().slice(0, 8)}`.toLowerCase();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name} owner ${APP_USER}`);
  await admin.end();
  const u = new URL(ADMIN_URL);
  u.username = APP_USER;
  u.password = APP_PASSWORD;
  u.pathname = `/${name}`;
  return {
    url: u.toString(),
    drop: async () => {
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

export interface TestService {
  svc: Service;
  tenantId: string;
  otherTenantId: string;
  /** sign a token; `user` sets a fixed userId / display name (default: random id, no name) */
  token(perms?: string[], tenantId?: string, user?: { userId?: string; userName?: string }): string;
  /** call the API as an admin of `tenantId` (default: the main test tenant) */
  api<T = any>(method: string, url: string, body?: unknown, opts?: { token?: string }): Promise<ApiResult<T>>;
  /** deliver an inbound event as the gateway would */
  deliver(type: string, data: unknown, opts?: { id?: string; tenantId?: string }): Promise<ApiResult>;
  /** events this service has published (outbox) */
  published(type?: string): Promise<{ type: string; data: any }[]>;
  close(): Promise<void>;
}

export async function bootTestService(def: ServiceDefinition, extraEnv: Record<string, string> = {}): Promise<TestService> {
  const db = await createTestDatabase(def.manifest.id);
  const env = { DATABASE_URL: db.url, JWT_SECRET: TEST_JWT_SECRET, INTERNAL_TOKEN: TEST_INTERNAL_TOKEN, NODE_ENV: 'test', ...extraEnv };
  const svc = createService(def, env);
  await svc.migrate();
  await svc.app.ready();
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const token = (perms = ['*'], tid = tenantId, user: { userId?: string; userName?: string } = {}) =>
    signToken(TEST_JWT_SECRET, { tenantId: tid, userId: user.userId ?? randomUUID(), perms, ...(user.userName ? { userName: user.userName } : {}) });
  const defaultToken = token();
  return {
    svc, tenantId, otherTenantId, token,
    async api(method, url, body, opts) {
      const res = await svc.app.inject({
        method: method as any, url,
        headers: { authorization: `Bearer ${opts?.token ?? defaultToken}` },
        ...(body !== undefined ? { payload: body as any } : {}),
      });
      return { status: res.statusCode, body: (res.body ? res.json() : undefined) as any };
    },
    async deliver(type, data, opts) {
      const res = await svc.app.inject({
        method: 'POST', url: '/_events', headers: { 'x-internal-token': TEST_INTERNAL_TOKEN },
        payload: { id: opts?.id ?? randomUUID(), type, tenantId: opts?.tenantId ?? tenantId, source: 'test', occurredAt: new Date().toISOString(), data },
      });
      return { status: res.statusCode, body: res.json() };
    },
    async published(type) {
      const r = await svc.db.pool.query<{ type: string; data: { data: unknown } }>(
        `select type, data from _outbox ${type ? 'where type = $1' : ''} order by occurred_at, id`, type ? [type] : [],
      );
      return r.rows.map((x) => ({ type: x.type, data: x.data.data }));
    },
    async close() {
      await svc.close();
      await db.drop();
    },
  };
}
