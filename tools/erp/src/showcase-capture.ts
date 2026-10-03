/**
 * pnpm erp showcase-capture — record what the web app reads from a running demo, for the public showcase (SHOWCASE=1).
 *
 * Logs into the gateway as each persona, then walks every GET the UI makes, generically from the module screen descriptors
 * (apps/web's generated registry): the catalog, the company profile, every module's widgets, notifications, search
 * sources, command/field lookups, list screens, then for the first rows of each list the screen its rowLink opens (details,
 * sub-lists, edit-form loads, attachments + audit trail of a record) and the records widgets link to.
 * The admin's answers are the base; each other persona keeps only what differs (their own inbox, notifications, 403s…).
 *
 * Secrets never leave: tokens are replaced by fake `showcase-demo-token.<persona>` strings, JWT-looking text and
 * token/secret/password/api-key fields are masked, and the run fails if the site's contact e-mail or JWT_SECRET appears.
 * Output: apps/web/showcase/snapshot.json (keys sorted, re-runnable).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { attachmentRef, fillPath, get, hasPerm, listRows, routeParams, type Field, type ModuleUi, type Screen } from '@erp/ui-schema';
import { REPO_ROOT } from './catalog.ts';
import { moduleUis } from '../../../apps/web/src/modules.generated.ts';
import { snapshotKey, SHOWCASE_TOKEN_PREFIX, type RecordedResponse, type ShowcasePersona, type Snapshot } from '../../../apps/web/src/lib/showcase-server.ts';

export interface PersonaSpec { id: string; email: string; label: string; description: string }

/** The roles a visitor can pick (demo users from tools/erp/src/demo.ts; missing ones are skipped). The first is the default. */
export const PERSONAS: PersonaSpec[] = [
  { id: 'admin', email: 'admin@demo.co.th', label: 'ผู้ดูแลระบบ', description: 'เห็นทุกโมดูล — ภาพรวมทั้งบริษัท โรงงาน การเงิน และบอทอัตโนมัติ' },
  { id: 'sales', email: 'sales@demo.co.th', label: 'ฝ่ายขาย', description: 'ลูกค้า ใบเสนอราคา ใบสั่งขาย และลูกหนี้' },
  { id: 'accounting', email: 'acc@demo.co.th', label: 'ฝ่ายบัญชี', description: 'ใบกำกับภาษี รับ-จ่ายเงิน งบการเงิน และรายงานภาษี' },
  { id: 'tech', email: 'tech@demo.co.th', label: 'ช่างซ่อมบำรุง', description: 'เครื่องจักร ใบแจ้งซ่อม แผน PM — งานหน้างานบนมือถือ' },
  { id: 'hr', email: 'hr@demo.co.th', label: 'ฝ่ายบุคคล', description: 'พนักงาน การลา เวลาทำงาน และเงินเดือน' },
  { id: 'store', email: 'store@demo.co.th', label: 'คลังสินค้า', description: 'รับ-จ่ายของ ยอดสต็อก และของต่ำกว่าจุดสั่งซื้อ' },
];

export interface CaptureOptions {
  gateway?: string;
  tenant?: string;
  password?: string;
  out?: string;
  /** detail pages recorded per list (first N rows) */
  rowsPerList?: number;
  personas?: PersonaSpec[];
  log?: (line: string) => void;
}

const MASK = '••••••';
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
/** the demo's own address in recorded links (webhook URLs, open links): shown as a neutral public host instead */
const LOCAL_URL = /\bhttps?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?::\d+)?/g;
const PUBLIC_HOST = 'https://erp.example.co.th';
/** a long hex path segment is a per-tenant secret path (LINE webhook, signed link) */
const HEX_SEGMENT = /\/[0-9a-f]{40,}(?=$|[/?#"\s])/gi;
/** field names that hold a secret (`line_token`, `apiKey`, `webhook_secret`…) — not `password_source` (a label) */
const SECRET_KEY = /(token|secret|password|passwd|apikey|accesskey|privatekey|signature|credential)s?$/;

/** Mask anything secret-looking, deeply. Pure — exported for tests. */
export function sanitize(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(JWT, MASK).replace(LOCAL_URL, PUBLIC_HOST).replace(HEX_SEGMENT, `/${MASK}`);
  if (Array.isArray(v)) return v.map(sanitize);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const secret = SECRET_KEY.test(k.replace(/[_-]/g, '').toLowerCase());
      out[k] = secret && typeof x === 'string' && x !== '' ? MASK : sanitize(x);
    }
    return out;
  }
  return v;
}

/** "/purchase-orders/abc%20d" + "?x=1" -> snapshot key "purchasing/purchase-orders/abc d?x=1" (the same key the web route computes). */
function keyOf(module: string, path: string, query: Record<string, string | number | undefined> = {}): string {
  const segs = `${module}/${path}`.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  return snapshotKey(segs.join('/'), q);
}

/** The URL for a key: segments re-encoded. */
function urlOf(gateway: string, key: string): string {
  const [p, q] = key.split('?');
  return `${gateway}/api/${p.split('/').map(encodeURIComponent).join('/')}${q ? `?${q}` : ''}`;
}

/** marks a detail screen opened without an id (its endpoint has no :param) */
const NO_ID = '\u0000';

interface Walk { record: (key: string) => Promise<RecordedResponse | null> }

/** Walk every GET the UI makes for a user with these permissions. */
async function walkUi(w: Walk, modules: ModuleUi[], installed: Set<string>, perms: string[], rowsPerList: number): Promise<void> {
  const uis = modules.filter((m) => installed.has(m.module));
  const byId = new Map(uis.map((m) => [m.module, m]));
  const visited = new Set<string>();

  const lookups = async (owner: string, fields: Field[] | undefined) => {
    for (const f of fields ?? []) {
      if (!f.lookup) continue;
      const mod = f.lookup.module ?? owner;
      if (!installed.has(mod)) continue;
      await w.record(keyOf(mod, f.lookup.path, { ...f.lookup.query, limit: 50 }));
    }
  };

  /** A screen opened with an id (row click, widget link, feed link). */
  const visit = async (ui: ModuleUi, screenId: string, id: unknown, depth: number): Promise<void> => {
    const s: Screen | undefined = ui.screens[screenId];
    if (!s || id === undefined || id === null || id === '' || !hasPerm(perms, s.perm)) return;
    const mark = `${ui.module}/${screenId}/${id}`;
    if (visited.has(mark)) return;
    visited.add(mark);
    const sid = String(id);
    try {
      if (s.kind === 'detail') {
        const res = await w.record(keyOf(ui.module, fillPath(s.endpoint, routeParams(s.endpoint, sid))));
        if (!res || res.s !== 200 || sid === NO_ID) return;
        if (s.attachments && hasPerm(perms, s.attachments.perm)) await w.record(keyOf(ui.module, '/_attachments', { ref: attachmentRef(s.attachments.entity, sid) }));
        if (hasPerm(perms, `${ui.module}.audit.read`)) await w.record(keyOf(ui.module, '/_audit', { ref: sid, limit: 200 }));
        if (s.edit) await visit(ui, s.edit, sid, depth);
        for (const a of s.actions ?? []) if (hasPerm(perms, a.perm)) { await lookups(ui.module, a.fields); await lookups(ui.module, a.lines?.fields); }
      } else if (s.kind === 'form') {
        if (s.load) await w.record(keyOf(ui.module, fillPath(s.load, routeParams(s.load, sid))));
        await lookups(ui.module, s.fields);
        await lookups(ui.module, s.lines?.fields);
      } else {
        const res = await w.record(keyOf(ui.module, fillPath(s.endpoint, routeParams(s.endpoint, sid))));
        if (res?.s === 200 && depth < 3) await followRows(ui, s, listRows(s, res.b), depth + 1);
      }
    } catch { /* a template this row cannot fill: the UI could not open it either */ }
  };

  const followRows = async (ui: ModuleUi, s: Extract<Screen, { kind: 'list' }>, rows: Record<string, unknown>[], depth: number) => {
    if (!s.rowLink) return;
    // a report-style list (the ภ.พ.30 year, tax registers by month) is read month by month: its first rows are often the empty
    // months before go-live, so up to a year of its rows open in the showcase
    const n = s.report ? Math.max(rowsPerList, 12) : rowsPerList;
    for (const row of rows.slice(0, n)) await visit(ui, s.rowLink.screen, get(row, s.rowLink.idFrom ?? 'id'), depth);
  };

  /** "/m/<module>/<screen>/<id>" written by a feed row */
  const visitHref = async (href: unknown) => {
    const m = typeof href === 'string' ? href.match(/^\/m\/([^/?#]+)\/([^/?#]+)(?:\/([^/?#]+))?/) : null;
    const ui = m ? byId.get(m[1]) : undefined;
    if (!ui || !m) return;
    const s = ui.screens[m[2]];
    if (m[3]) await visit(ui, m[2], decodeURIComponent(m[3]), 1);
    else if (s?.kind === 'list' && !s.endpoint.includes(':') && hasPerm(perms, s.perm)) await w.record(keyOf(ui.module, s.endpoint));
  };

  for (const ui of uis) {
    for (const wd of ui.widgets ?? []) {
      if (!hasPerm(perms, wd.perm)) continue;
      const res = await w.record(keyOf(ui.module, wd.endpoint));
      if (!res || res.s !== 200) continue;
      if (wd.kind === 'pipeline' || wd.kind === 'floor3d') {
        const rows = (get(res.b, wd.rows) ?? []) as Record<string, unknown>[];
        // the 3D floor is the showpiece: every machine on it opens
        const n = wd.kind === 'floor3d' ? 40 : rowsPerList;
        if (wd.link && Array.isArray(rows)) for (const r of rows.slice(0, n)) await visit(ui, wd.link.screen, get(r, wd.link.idFrom ?? 'id'), 1);
      }
      if (wd.kind === 'feed' && wd.link) {
        const rows = get(res.b, wd.rows);
        if (Array.isArray(rows)) for (const r of rows.slice(0, rowsPerList)) await visitHref(get(r, wd.link));
      }
    }
    if (ui.notifications && hasPerm(perms, ui.notifications.perm)) {
      const res = await w.record(keyOf(ui.module, ui.notifications.endpoint));
      const items = get(res?.b, 'items');
      if (Array.isArray(items)) for (const n of items.slice(0, rowsPerList)) await visitHref(get(n, 'link') ?? get(n, 'href'));
    }
    for (const sr of ui.search ?? []) if (hasPerm(perms, sr.perm)) await w.record(keyOf(ui.module, sr.endpoint, { ...sr.query }));
    for (const c of ui.commands ?? []) {
      if (!c.arg || !hasPerm(perms, c.perm)) continue;
      const mod = c.arg.lookup.module ?? ui.module;
      if (installed.has(mod)) await w.record(keyOf(mod, c.arg.lookup.path, { ...c.arg.lookup.query, limit: 50 }));
    }
    for (const [id, s] of Object.entries(ui.screens)) {
      if (!hasPerm(perms, s.perm)) continue;
      if (s.kind === 'list') {
        await lookups(ui.module, s.filters);
        for (const a of [...(s.actions ?? []), ...(s.rowActions ?? [])]) if (hasPerm(perms, a.perm)) { await lookups(ui.module, a.fields); await lookups(ui.module, a.lines?.fields); }
        if (s.endpoint.includes(':')) continue; // opened with an id: reached through a rowLink
        const res = await w.record(keyOf(ui.module, s.endpoint));
        if (res?.s === 200) await followRows(ui, s, listRows(s, res.b), 1);
      } else if (s.kind === 'form') {
        await lookups(ui.module, s.fields);
        await lookups(ui.module, s.lines?.fields);
        if (s.load && !s.load.includes(':')) await w.record(keyOf(ui.module, s.load));
      } else if (!s.endpoint.includes(':')) {
        await visit(ui, id, NO_ID, 1); // a detail without an id (settings page)
      }
    }
  }
}

export async function captureShowcase(o: CaptureOptions = {}): Promise<{ file: string; bytes: number; responses: number; overlays: Record<string, number>; personas: string[] }> {
  const gateway = (o.gateway ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
  const tenant = o.tenant ?? 'demo';
  const password = o.password ?? 'demo1234';
  const out = o.out ?? join(REPO_ROOT, 'apps', 'web', 'showcase', 'snapshot.json');
  const rowsPerList = o.rowsPerList ?? 5;
  const log = o.log ?? (() => {});

  const personas: ShowcasePersona[] = [];
  const tokens = new Map<string, string>();
  for (const p of o.personas ?? PERSONAS) {
    const res = await fetch(`${gateway}/api/identity/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenant, email: p.email, password }) });
    if (!res.ok) { log(`skip ${p.id}: login ${p.email} → ${res.status}`); continue; }
    const s = (await res.json()) as ShowcasePersona['session'] & { token: string };
    tokens.set(p.id, s.token);
    personas.push({
      id: p.id, label: p.label, description: p.description, email: p.email,
      session: { token: `${SHOWCASE_TOKEN_PREFIX}${p.id}`, expiresIn: s.expiresIn, tenant: s.tenant, user: s.user, permissions: s.permissions },
    });
  }
  if (!personas.length) throw new Error(`could not log into ${gateway} (company ${tenant}) — is the demo running? (pnpm demo)`);

  const responses: Record<string, RecordedResponse> = {};
  const overlays: Record<string, Record<string, RecordedResponse>> = {};

  for (const p of personas) {
    const token = tokens.get(p.id)!;
    const base = p === personas[0];
    const seen = new Map<string, RecordedResponse | null>();
    const record = async (key: string): Promise<RecordedResponse | null> => {
      if (seen.has(key)) return seen.get(key)!;
      seen.set(key, null);
      let rec: RecordedResponse | null = null;
      try {
        const res = await fetch(urlOf(gateway, key), { headers: { authorization: `Bearer ${token}` } });
        const type = res.headers.get('content-type') ?? '';
        if (type.includes('json')) rec = { s: res.status, b: sanitize(await res.json()) };
        else await res.arrayBuffer(); // files, CSV: not part of the showcase
      } catch (e) {
        log(`warn ${key}: ${(e as Error).message}`);
      }
      seen.set(key, rec);
      if (!rec) return null;
      if (base) responses[key] = rec;
      else if (JSON.stringify(responses[key]) !== JSON.stringify(rec)) (overlays[p.id] ??= {})[key] = rec;
      return rec;
    };
    const cat = await record('_catalog');
    const installed = new Set(((cat?.b as { modules?: { id: string }[] })?.modules ?? []).map((m) => m.id));
    await record('identity/company');
    await record('identity/me');
    await walkUi({ record }, moduleUis, installed, p.session.permissions, rowsPerList);
    log(`${p.id.padEnd(11)} ${seen.size} requests${base ? '' : `, ${Object.keys(overlays[p.id] ?? {}).length} differ from ${personas[0].id}`}`);
  }

  const sorted = <T,>(r: Record<string, T>) => Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]]));
  const snap: Snapshot = {
    version: 1,
    capturedAt: new Date().toISOString().slice(0, 10),
    personas,
    responses: sorted(responses),
    overlays: Object.fromEntries(Object.keys(overlays).sort().map((k) => [k, sorted(overlays[k])])),
  };
  const text = `${JSON.stringify(snap)}\n`;
  assertNoSecrets(text);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  return {
    file: out, bytes: Buffer.byteLength(text), responses: Object.keys(responses).length,
    overlays: Object.fromEntries(Object.entries(overlays).map(([k, v]) => [k, Object.keys(v).length])), personas: personas.map((p) => p.id),
  };
}

/** Last line of defence before the file is written: no real tokens, no owner contact e-mail, no server secret. */
export function assertNoSecrets(text: string): void {
  const problems: string[] = [];
  if (JWT.test(text)) problems.push('a JWT');
  JWT.lastIndex = 0;
  try {
    const site = JSON.parse(readFileSync(join(REPO_ROOT, 'site', 'site.config.json'), 'utf8')) as { contact?: { email?: string; phone?: string; line?: string } };
    for (const v of [site.contact?.email, site.contact?.phone, site.contact?.line]) if (v && v.length > 4 && text.includes(v)) problems.push(`site contact "${v}"`);
  } catch { /* no site config */ }
  for (const name of ['JWT_SECRET', 'ANTHROPIC_API_KEY', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET']) {
    const v = process.env[name];
    if (v && v.length > 6 && text.includes(v)) problems.push(name);
  }
  if (problems.length) throw new Error(`snapshot not written — it contains ${problems.join(', ')}`);
}
