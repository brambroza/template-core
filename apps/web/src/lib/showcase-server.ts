/**
 * SHOWCASE MODE (server-only): the public "try the real ERP" site. With `SHOWCASE=1` the /api proxy answers from a recorded
 * snapshot (apps/web/showcase/snapshot.json, written by `pnpm erp showcase-capture`) instead of the gateway:
 *   - GET: exact path+query, then the path without its query (rows filtered in memory by `q`, simple equality params, `limit`), else a Thai 404
 *   - POST identity /auth/login: the recorded session of a persona (admin, sales, …) — no password check, the tokens are fake
 *   - any other write: 403 `showcase_read_only` (the web shows it as a friendly toast)
 * Normal installations never load the snapshot (default off).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RecordedResponse { s: number; b: unknown }

export interface ShowcasePersona {
  id: string;
  label: string;
  description?: string;
  email: string;
  session: { token: string; expiresIn?: number; tenant: { id: string; code: string; name: string }; user: { id: string; email: string; name: string }; permissions: string[] };
}

export interface Snapshot {
  version: 1;
  capturedAt?: string;
  personas: ShowcasePersona[];
  /** "<module>/<path>[?sorted query]" -> recorded answer (as the admin persona saw it) */
  responses: Record<string, RecordedResponse>;
  /** per persona: only the answers that differ from the admin's (their own inbox, notifications, 403s…) */
  overlays?: Record<string, Record<string, RecordedResponse>>;
}

export const SHOWCASE_TOKEN_PREFIX = 'showcase-demo-token.';
export const READ_ONLY = { code: 'showcase_read_only', message: 'โหมดตัวอย่าง — ไม่บันทึกข้อมูล ติดต่อทีม GO Along เพื่อทดลองระบบเต็ม' } as const;
export const NOT_RECORDED = 'ไม่มีข้อมูลนี้ในโหมดตัวอย่าง';

/** On when the server runs with SHOWCASE=1 (or the build baked NEXT_PUBLIC_SHOWCASE=1 in, see next.config.ts). */
export function isShowcase(): boolean {
  return process.env.SHOWCASE === '1' || process.env.NEXT_PUBLIC_SHOWCASE === '1';
}

/** Canonical key: segments joined, query params sorted (repeated keys keep their order), empty values dropped. */
export function snapshotKey(path: string, search: string | URLSearchParams = ''): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  const q = typeof search === 'string' ? new URLSearchParams(search.replace(/^\?/, '')) : search;
  const pairs = [...q.entries()].filter(([, v]) => v !== '').sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.length ? `${clean}?${new URLSearchParams(pairs).toString()}` : clean;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });

/** The persona a request belongs to (fake token `showcase-demo-token.<id>`), or null when the token is missing/unknown. */
export function personaOf(snap: Snapshot, authorization: string | null): ShowcasePersona | null {
  const token = (authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token.startsWith(SHOWCASE_TOKEN_PREFIX)) return null;
  return snap.personas.find((p) => p.session.token === token) ?? null;
}

const textOf = (v: unknown, depth = 0): string[] => {
  if (v === null || v === undefined) return [];
  if (typeof v === 'string' || typeof v === 'number') return [String(v)];
  if (depth < 2 && typeof v === 'object' && !Array.isArray(v)) return Object.values(v as Record<string, unknown>).flatMap((x) => textOf(x, depth + 1));
  return [];
};

/** Paging / search params that never mean "row field equals value". */
const NOT_FIELD_FILTERS = new Set(['q', 'limit', 'offset', 'page', 'pageSize', 'sort', 'order']);

/**
 * A recorded list answered for a query that was not recorded: `q` keeps rows with any text field containing it,
 * `name=value` keeps rows whose own `name` field equals the value (only when rows have that field), `limit` slices.
 * Non-array bodies are returned unchanged.
 */
export function filterRecorded(body: unknown, query: URLSearchParams): unknown {
  if (!Array.isArray(body)) return body;
  let rows = body as unknown[];
  const q = (query.get('q') ?? '').trim().toLowerCase();
  if (q) rows = rows.filter((r) => textOf(r).some((t) => t.toLowerCase().includes(q)));
  for (const [k, v] of query.entries()) {
    if (NOT_FIELD_FILTERS.has(k) || v === '') continue;
    if (!rows.some((r) => r && typeof r === 'object' && k in (r as object))) continue;
    rows = rows.filter((r) => String((r as Record<string, unknown>)[k] ?? '') === v);
  }
  const limit = Number(query.get('limit'));
  if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
  return rows;
}

/** GET from the snapshot: exact match (persona overlay first), then the path without its query, else null. */
export function lookup(snap: Snapshot, persona: string, path: string, search: string): RecordedResponse | null {
  const overlay = snap.overlays?.[persona] ?? {};
  const exact = snapshotKey(path, search);
  const hit = overlay[exact] ?? snap.responses[exact];
  if (hit) return hit;
  const bare = snapshotKey(path);
  const base = overlay[bare] ?? snap.responses[bare];
  if (!base) return null;
  if (base.s !== 200) return base;
  return { s: 200, b: filterRecorded(base.b, new URLSearchParams(search.replace(/^\?/, ''))) };
}

/** Public persona list for the login page (no tokens). */
export function personaList(snap: Snapshot) {
  return snap.personas.map((p) => ({ id: p.id, label: p.label, description: p.description ?? '', email: p.email, name: p.session.user.name, tenant: p.session.tenant.name }));
}

/** Answer one /api/* request in showcase mode. `path` = the segments after /api. */
export async function showcaseResponse(snap: Snapshot, req: Request, path: string[]): Promise<Response> {
  const url = new URL(req.url);
  const joined = path.join('/');
  const method = req.method.toUpperCase();

  if (joined === '_showcase') return json({ showcase: true, capturedAt: snap.capturedAt ?? null, personas: personaList(snap) });

  if (method === 'POST' && joined === 'identity/auth/login') {
    let body: { email?: string; persona?: string } = {};
    try { body = await req.json(); } catch { /* empty body: admin */ }
    const email = String(body.email ?? '').trim().toLowerCase();
    const p = snap.personas.find((x) => x.id === body.persona || x.email.toLowerCase() === email) ?? (email ? null : snap.personas[0]);
    if (!p) return json({ error: { code: 'invalid_credentials', message: 'โหมดตัวอย่าง — เลือกบทบาทจากปุ่ม “เข้าชมในฐานะ …”' } }, 401);
    return json(p.session);
  }
  // logging out only forgets the session in the browser: say OK so the web does not treat it as a failed write
  if (method === 'POST' && (joined === 'identity/logout' || joined === 'identity/auth/logout')) return json({ ok: true });
  if (method !== 'GET' && method !== 'HEAD') return json({ error: READ_ONLY }, 403);

  const persona = personaOf(snap, req.headers.get('authorization'));
  if (!persona) return json({ error: { code: 'showcase_login', message: 'กรุณาเข้าสู่ระบบ' } }, 401);
  const hit = lookup(snap, persona.id, joined, url.search);
  if (!hit) return json({ error: { code: 'showcase_not_recorded', message: NOT_RECORDED } }, 404);
  return json(hit.b ?? null, hit.s);
}

let cached: { snap: Snapshot; day: string } | null = null;

const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Move every recorded date ("2026-10-03") and timestamp ("2026-10-03T01:02:03Z") forward by `days`, so the demo company keeps
 * looking like today (the bot fired "18 นาทีที่แล้ว", due dates stay ahead) however long ago it was captured. Month periods,
 * document numbers and dates inside free text are left as recorded. Pure — exported for tests.
 */
export function shiftDates<T>(v: T, days: number): T {
  if (!days) return v;
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') {
      if (DATE.test(x)) return new Date(Date.parse(`${x}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
      if (STAMP.test(x)) { const t = Date.parse(x); return Number.isNaN(t) ? x : new Date(t + days * DAY).toISOString(); }
      return x;
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(v) as T;
}

/** Whole days between the capture and `now` (0 when unknown, in the future, or SHOWCASE_SHIFT_DATES=0). */
export function daysSinceCapture(capturedAt: string | undefined, now = Date.now()): number {
  if (!capturedAt || process.env.SHOWCASE_SHIFT_DATES === '0') return 0;
  const at = Date.parse(capturedAt.length === 10 ? `${capturedAt}T00:00:00Z` : capturedAt);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.floor((Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - at) / DAY));
}

/**
 * The snapshot, read once per server process (and re-dated when the day changes). Vercel bundles it into the function through
 * `outputFileTracingIncludes` (next.config.ts); `SHOWCASE_SNAPSHOT` points elsewhere (tests, a second snapshot).
 */
export function loadSnapshot(): Snapshot {
  const today = new Date().toISOString().slice(0, 10);
  if (cached?.day === today) return cached.snap;
  const candidates = [process.env.SHOWCASE_SNAPSHOT, join(process.cwd(), 'showcase', 'snapshot.json'), join(process.cwd(), 'apps', 'web', 'showcase', 'snapshot.json')].filter(Boolean) as string[];
  const file = candidates.find((f) => existsSync(f));
  if (!file) throw new Error(`showcase snapshot not found (tried ${candidates.join(', ')}) — run \`pnpm erp showcase-capture\``);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
  const days = daysSinceCapture(raw.capturedAt);
  // keys (paths, queries) stay as recorded; only the answers move
  const snap: Snapshot = days ? {
    ...raw,
    responses: shiftDates(raw.responses, days),
    overlays: shiftDates(raw.overlays, days),
  } : raw;
  cached = { snap, day: today };
  return snap;
}

/** Tests: forget the cached snapshot. */
export function resetSnapshotCache(): void {
  cached = null;
}

/** AI routes in showcase: nothing is sent to an AI provider. */
export const SHOWCASE_AI_OFF = 'ผู้ช่วย AI ไม่ได้เปิดในโหมดตัวอย่าง — ในระบบจริงผู้ช่วยตอบจากข้อมูลบริษัทคุณเป็นภาษาไทย ติดต่อทีม GO Along เพื่อทดลองเต็มรูปแบบ (คำสั่งลัด ⌘K และการค้นหายังลองได้)';
