/**
 * Audit log — every successful write (POST/PUT/PATCH/DELETE answered < 400) by a signed-in user is recorded in the
 * module's own `_audit` table (tenant-isolated with row-level security). Written by the kernel, no module code needed.
 *
 *   GET /_audit?from=&to=&userId=&q=&ref=&limit=     perm `<module>.audit.read` (or `<module>.*` / `*`)
 *
 * Event handlers (`/_events`) and public/internal routes are not user actions and are not recorded.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePerm } from './auth.ts';
import type { Db } from './db.ts';
import { parse } from './errors.ts';

export const AUDIT_SUMMARY_MAX = 2048;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** body fields never written to the log: credentials and file contents */
const DROP_KEY = /(password|passwd|secret|token|base64$|^logo)/i;
/**
 * body fields kept only as their last 4 characters: bank account / card / national-ID numbers. Modules that promise never to store a full
 * number (payroll keeps `bank_account_last4`) must not have it written in full to the audit log either (bugs-0.4 PAY-01).
 */
const MASK_KEY = /(bank_?account|account_?(no|number)|card_?(no|number)|national_?id|id_?card|citizen_?id)/i;
const mask = (v: unknown) => {
  const digits = String(v).replace(/[^0-9A-Za-z]/g, '');
  return digits ? `••••${digits.slice(-4)}` : null;
};
const MAX_STRING = 200;
const MAX_ITEMS = 20;
const MAX_DEPTH = 4;

/** A copy of a request body without secrets and file contents, with long strings/arrays shortened. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => redact(v, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `…(+${value.length - MAX_ITEMS})`] : items;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DROP_KEY.test(k)) continue;
    out[k] = MASK_KEY.test(k) && v !== null && v !== undefined && typeof v !== 'object' ? mask(v) : redact(v, depth + 1);
  }
  return out;
}

/** The stored body summary: redacted, at most AUDIT_SUMMARY_MAX bytes of JSON (larger bodies keep a truncated preview). */
export function auditSummary(body: unknown): unknown {
  if (body === undefined || body === null || (typeof body === 'object' && !Object.keys(body as object).length)) return null;
  const r = redact(body);
  const json = JSON.stringify(r);
  if (Buffer.byteLength(json) <= AUDIT_SUMMARY_MAX) return r;
  let preview = json.slice(0, AUDIT_SUMMARY_MAX - 64);
  while (Buffer.byteLength(preview) > AUDIT_SUMMARY_MAX - 64) preview = preview.slice(0, -16);
  return { _truncated: true, preview };
}

/** id of the record a write touched: a route-provided id, the `:id` (or first) route param, else the `id` of a JSON object response. */
function entityOf(req: FastifyRequest, payload: unknown): string | null {
  if (req.auditEntityId) return req.auditEntityId;
  const params = (req.params ?? {}) as Record<string, string>;
  const p = params.id ?? Object.entries(params).find(([k]) => k !== '*')?.[1];
  if (p) return String(p).slice(0, 100);
  if (typeof payload === 'string' && payload.startsWith('{') && payload.length < 1_000_000) {
    try {
      const id = (JSON.parse(payload) as { id?: unknown }).id;
      if (typeof id === 'string' || typeof id === 'number') return String(id).slice(0, 100);
    } catch { /* not JSON */ }
  }
  return null;
}

/** Called from the kernel's onSend hook. Never throws into the request (logging must not break a committed write). */
export async function recordAudit(db: Db, req: FastifyRequest, status: number, payload: unknown): Promise<void> {
  const a = req.authCtx;
  if (!a || !WRITE_METHODS.has(req.method) || status >= 400) return;
  const route = req.routeOptions?.url ?? req.url.split('?')[0];
  try {
    await db.tx(a.tenantId, (c) => c.query(
      `insert into _audit (user_id, user_name, method, route, entity_id, status, summary) values ($1, $2, $3, $4, $5, $6, $7)`,
      [a.userId, a.userName ?? null, req.method, route, entityOf(req, payload), status, JSON.stringify(auditSummary(req.body))],
    ));
  } catch (e) {
    req.log.error({ err: e }, 'audit write failed');
  }
}

/** Short "field: value · …" text of a stored summary for list cells (max ~160 characters). */
export function summaryText(summary: unknown): string {
  if (summary === null || summary === undefined) return '';
  if (typeof summary !== 'object') return String(summary);
  const s = summary as Record<string, unknown>;
  const text = s._truncated
    ? String(s.preview ?? '')
    : Object.entries(s).map(([k, v]) => `${k}: ${v !== null && typeof v === 'object' ? (Array.isArray(v) ? `${v.length} รายการ` : '{…}') : String(v)}`).join(' · ');
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AuditQuery = z.object({
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  userId: z.string().max(100).optional(),
  ref: z.string().max(100).optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export function mountAudit(app: FastifyInstance, o: { db: Db; permPrefix: string }): void {
  app.get('/_audit', async (req) => {
    const a = req.authCtx!;
    requirePerm(a, `${o.permPrefix}.audit.read`);
    const f = parse(AuditQuery, req.query);
    const where: string[] = [];
    const args: unknown[] = [];
    const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
    // a bare date is a Bangkok calendar day; `to` is inclusive
    if (f.from) add(DAY.test(f.from) ? `at >= (?::date)::timestamp at time zone 'Asia/Bangkok'` : 'at >= ?::timestamptz', f.from);
    if (f.to) add(DAY.test(f.to) ? `at < (?::date + 1)::timestamp at time zone 'Asia/Bangkok'` : 'at <= ?::timestamptz', f.to);
    if (f.userId) add('user_id = ?', f.userId);
    if (f.ref) add('entity_id = ?', f.ref.includes(':') ? f.ref.slice(f.ref.indexOf(':') + 1) : f.ref);
    if (f.q) add(`(route || ' ' || coalesce(user_name, '') || ' ' || coalesce(entity_id, '') || ' ' || coalesce(summary::text, '')) ilike ?`, `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    args.push(f.limit);
    return o.db.tx(a.tenantId, async (c) => (await c.query(
      `select id, at, user_id, user_name, method, route, entity_id, status, summary from _audit
       ${where.length ? `where ${where.join(' and ')}` : ''} order by at desc, id desc limit $${args.length}`, args,
    )).rows.map((r) => ({ ...r, id: String(r.id), action: `${r.method} ${r.route}`, summary_text: summaryText(r.summary) })));
  });
}
