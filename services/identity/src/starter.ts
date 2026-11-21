/**
 * Sample data of a trial company (phase 2): which industry it started with, whether seeding is running / done / failed, and
 * whether the owner already cleared it. The data itself is put in by @erp/starter through the gateway, as two made-up helpers.
 *
 * The gateway address comes from GATEWAY_URL, or from EVENT_ROUTER_URL (same host, the router lives at /_events/publish).
 * Without either there is no sample data (state "failed" with the reason) and the company works as an empty one.
 */
import { signToken, type Client, type Kernel } from '@erp/kernel';
import { INDUSTRIES, seedStarter, type IndustryId, type StarterSummary } from '@erp/starter';

/** The two helpers the sample documents are recorded / approved by. Not users: they cannot log in and do not count. */
export const STARTER_HELPERS = {
  clerk: { userId: '5a3b1e00-0000-4000-8000-00000000c1e4', userName: 'ผู้บันทึกตัวอย่าง' },
  approver: { userId: '5a3b1e00-0000-4000-8000-0000000a9900', userName: 'ผู้อนุมัติตัวอย่าง' },
} as const;

/** A seeding run that has not finished after this long died with its process. */
export const STARTER_STALE_MINUTES = 15;

export type StarterState = 'seeding' | 'ready' | 'failed' | 'cleared';

export interface StarterRow {
  industry: IndustryId;
  state: StarterState;
  summary: StarterSummary | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  cleared_at: string | null;
  cleared_by: string | null;
}

/** Base URL of the gateway as seen from identity, or null. */
export function gatewayBase(env: NodeJS.ProcessEnv): string | null {
  if (env.GATEWAY_URL) return env.GATEWAY_URL.replace(/\/$/, '');
  const router = env.EVENT_ROUTER_URL;
  if (!router) return null;
  return router.replace(/\/_events\/publish\/?$/, '').replace(/\/$/, '') || null;
}

/** The company's sample-data row (inside its transaction), with a run that died reported as failed. */
export async function starterOf(c: Client): Promise<StarterRow | null> {
  const row = (await c.query<StarterRow & { stale: boolean }>(
    `select *, (state = 'seeding' and started_at < now() - make_interval(mins => $1)) as stale from tenant_starter`, [STARTER_STALE_MINUTES])).rows[0];
  if (!row) return null;
  const { stale, ...rest } = row;
  return stale ? { ...rest, state: 'failed', error: rest.error ?? 'การเตรียมข้อมูลตัวอย่างหยุดกลางคัน' } : rest;
}

/** What the apps show (banner on the home page). */
export function starterView(row: StarterRow | null) {
  if (!row || row.state === 'cleared') return null;
  return {
    industry: row.industry,
    industryName: INDUSTRIES[row.industry]?.nameTh ?? row.industry,
    state: row.state,
    next: row.summary?.next ?? {},
    // the technical reason stays in the row for GO Along staff; the owner gets what to do
    error: row.state === 'failed' ? 'ใส่ข้อมูลตัวอย่างได้ไม่ครบ — ใช้งานต่อได้ตามปกติ หรือกดล้างแล้วเริ่มใช้จริง' : null,
  };
}

/**
 * Seed `industry` into the company and record the outcome. Never throws (a failed run leaves the company usable, empty or half
 * filled, with state "failed" and the reason). `settle` waits for events to be delivered (default: a pause long enough for the
 * outbox dispatcher; tests pass the installation's own).
 */
export async function runStarter(
  k: Kernel,
  p: { tenantId: string; industry: IndustryId; modules: string[] | null; settle?: () => Promise<void>; log?: (m: string) => void },
): Promise<StarterRow | null> {
  const secret = k.env.JWT_SECRET!;
  await k.db.tx(p.tenantId, (c) => c.query(
    `insert into tenant_starter (industry, state) values ($1, 'seeding')
     on conflict (tenant_id) do update set industry = excluded.industry, state = 'seeding', error = null, summary = null, started_at = now(), finished_at = null`,
    [p.industry]));
  const finish = (state: StarterState, extra: { summary?: StarterSummary; error?: string }) => k.db.tx(p.tenantId, async (c) => {
    await c.query(`update tenant_starter set state = $1, summary = $2, error = $3, finished_at = now()`, [state, extra.summary ? JSON.stringify(extra.summary) : null, extra.error ?? null]);
    return starterOf(c);
  });
  const base = gatewayBase(k.env);
  if (!base) return finish('failed', { error: 'ระบบนี้ไม่ได้ตั้ง GATEWAY_URL จึงใส่ข้อมูลตัวอย่างไม่ได้' });
  try {
    const call = (who: keyof typeof STARTER_HELPERS) => {
      const token = signToken(secret, { tenantId: p.tenantId, ...STARTER_HELPERS[who], perms: ['*'], ...(p.modules ? { modules: p.modules } : {}) }, 3600);
      return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
        const res = await fetch(`${base}${path}`, {
          method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
        return (text ? JSON.parse(text) : undefined) as T;
      };
    };
    const clerk = call('clerk');
    const installed = new Set((await clerk<{ modules: { id: string }[] }>('GET', '/api/_catalog')).modules.map((m) => m.id));
    const pause = Number(k.env.STARTER_SETTLE_MS ?? 2500);
    const summary = await seedStarter({
      clerk, approver: call('approver'), has: (m) => installed.has(m),
      settle: p.settle ?? (() => new Promise((r) => setTimeout(r, pause))), log: p.log,
    }, p.industry);
    return finish('ready', { summary });
  } catch (e) {
    p.log?.(`starter failed: ${(e as Error).message}`);
    void k.errors.report(e, { kind: 'event', route: 'starter seed', tenantId: p.tenantId });
    return finish('failed', { error: (e as Error).message.slice(0, 1000) });
  }
}
