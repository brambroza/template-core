/**
 * LINE to the person: link ERP users to LINE users of the company's LINE Official Account,
 * receive the LINE webhook (signed), answer a few Thai commands, and push personal alerts.
 *
 * Env: LINE_CHANNEL_SECRET (webhook signature), LINE_CHANNEL_ACCESS_TOKEN (push/reply), LINE_OA_ID (e.g. @123abcd, add-friend link),
 * PUBLIC_BASE_URL (public https address in front of /api — shown as the webhook URL), PUBLIC_APP_URL (web app, "open" links in LINE messages).
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { auth, badRequest, notFound, parse, requirePerm, s, z, type Client, type Kernel, type ServiceDefinition } from '@erp/kernel';
import { sendLine, type Delivery } from './engine.ts';

export const LINK_TTL_MINUTES = 10;
const MAX_WRONG_CODES = 5; // per LINE account per 15 minutes
/** per company per 15 minutes: guessing with many throw-away LINE accounts stops here (security review 0.3, SEC-09) */
export const MAX_WRONG_CODES_PER_TENANT = 30;

// fastify types without depending on fastify directly (the kernel owns it)
type FastifyInstance = Parameters<ServiceDefinition['routes']>[0];
type FastifyRequest = Parameters<typeof auth>[0];

// ---------- pure helpers ----------

/** LINE signs the raw request body: base64(HMAC-SHA256(channel secret, body)). Constant-time compare. */
export function verifyLineSignature(secret: string | undefined, raw: Buffer, signature: string | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  let given: Buffer;
  try { given = Buffer.from(signature, 'base64'); } catch { return false; }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Webhook key = tenant id without dashes (32 hex) + secret (32 hex). Tenant from the key, secret checked inside the tenant's RLS transaction. */
export function makeWebhookKey(tenantId: string, secret: string): string {
  return tenantId.replace(/-/g, '').toLowerCase() + secret;
}

export function parseWebhookKey(key: string): { tenantId: string; secret: string } | null {
  if (!/^[0-9a-f]{64}$/i.test(key)) return null;
  const t = key.slice(0, 32).toLowerCase();
  return { tenantId: `${t.slice(0, 8)}-${t.slice(8, 12)}-${t.slice(12, 16)}-${t.slice(16, 20)}-${t.slice(20)}`, secret: key.slice(32).toLowerCase() };
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Thai digits → 0-9, trim, single spaces (people type "ผูกบัญชี ๑๒๓๔๕๖" on Thai keyboards). */
export function normalizeText(text: string): string {
  return text.replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50)).replace(/\s+/g, ' ').trim();
}

export type LineCommand =
  | { kind: 'link'; code: string }
  | { kind: 'notifications' } | { kind: 'unlink' } | { kind: 'help' } | { kind: 'groupId' };

/** The commands the bot understands. Anything else gets no reply (the OA may also be used for human chat). */
export function parseCommand(text: string): LineCommand | null {
  const t = normalizeText(text);
  const link = t.match(/^(?:ผูกบัญชี|ผูก ?line|ผูกไลน์|link)?\s*:?\s*(\d{6})$/i);
  if (link) return { kind: 'link', code: link[1] };
  if (/^(ยกเลิกผูกบัญชี|ยกเลิกการผูกบัญชี|unlink)$/i.test(t)) return { kind: 'unlink' };
  if (/^(แจ้งเตือน|การแจ้งเตือน)$/.test(t)) return { kind: 'notifications' };
  if (/^(ช่วยเหลือ|help|เมนู|คำสั่ง|\?)$/i.test(t)) return { kind: 'help' };
  if (/^(ไอดีกลุ่ม|group ?id)$/i.test(t)) return { kind: 'groupId' };
  return null;
}

export const HELP_TEXT = [
  'คำสั่งที่ใช้ได้ (พิมพ์ในแชตนี้):',
  '• ผูกบัญชี 123456 — ผูก LINE กับบัญชี ERP (รับรหัสจากเมนู ระบบอัตโนมัติ → ผูก LINE ของฉัน)',
  '• แจ้งเตือน — การแจ้งเตือนส่วนตัว 5 รายการล่าสุด',
  '• ยกเลิกผูกบัญชี — หยุดรับแจ้งเตือนส่วนตัวทาง LINE',
  '• ช่วยเหลือ — แสดงคำสั่งทั้งหมด',
  'ในกลุ่ม LINE: พิมพ์ "ไอดีกลุ่ม" เพื่อดูรหัสกลุ่มไว้ตั้งกฎส่งเข้ากลุ่ม',
].join('\n');

const NOT_LINKED = 'บัญชี LINE นี้ยังไม่ได้ผูกกับระบบ ERP\nเข้าระบบ → ระบบอัตโนมัติ → ผูก LINE ของฉัน → กด "ขอรหัสผูกบัญชี" แล้วพิมพ์ "ผูกบัญชี" ตามด้วยรหัส 6 หลักในแชตนี้';
const LINKED_OK = 'ผูกบัญชีเรียบร้อย คุณจะได้รับแจ้งเตือนส่วนตัวทาง LINE';

// ---------- decide from LINE (approval cards) ----------

/** How long an "อนุมัติ" button on a LINE card stays usable. */
export const DECISION_TTL_HOURS = 72;

export type DecisionPostback = { step: 'ask' | 'go' | 'no'; id: string };

/** Postback data of our decision buttons: "erp:ask:<uuid>" (first tap) → "erp:go:<uuid>" (confirmed) / "erp:no:<uuid>" (cancelled). */
export function parseDecisionPostback(data: string | undefined): DecisionPostback | null {
  const m = /^erp:(ask|go|no):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(data ?? '');
  return m ? { step: m[1].toLowerCase() as DecisionPostback['step'], id: m[2].toLowerCase() } : null;
}

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/**
 * The LINE Flex card for one decision: what it is, the alert text, an "อนุมัติ" button (postback → confirm step) and
 * "เปิดดู / ไม่อนุมัติ" (the record in the web app — rejecting needs a reason, typed there). `altText` shows in the chat list.
 */
export function decisionFlex(o: { heading: string; title: string; text: string; actionId: string; openUrl?: string | null }) {
  const footer: unknown[] = [
    { type: 'button', style: 'primary', height: 'sm', color: '#2F5BFF', action: { type: 'postback', label: 'อนุมัติ', data: `erp:ask:${o.actionId}`, displayText: 'อนุมัติ' } },
  ];
  if (o.openUrl) footer.push({ type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: 'เปิดดู / ไม่อนุมัติ', uri: o.openUrl } });
  return {
    type: 'flex',
    altText: clip(`${o.heading}: ${o.text}`, 390),
    contents: {
      type: 'bubble',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'text', text: clip(o.heading, 60), size: 'xs', color: '#6B7690' },
          { type: 'text', text: clip(o.title, 120), weight: 'bold', size: 'md', wrap: true },
          { type: 'text', text: clip(o.text, 900), size: 'sm', color: '#3B4560', wrap: true },
          { type: 'text', text: `ปุ่มอนุมัติใช้ได้ ${DECISION_TTL_HOURS} ชั่วโมง`, size: 'xxs', color: '#98A2B8', margin: 'md' },
        ],
      },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer },
    },
  };
}

/** The confirm question after the first tap (a mistaken tap must not approve). */
export function decisionConfirm(title: string, actionId: string) {
  return {
    type: 'template',
    altText: clip(`ยืนยันอนุมัติ ${title}?`, 390),
    template: {
      type: 'confirm',
      text: clip(`ยืนยันอนุมัติ ${title}?`, 240),
      actions: [
        { type: 'postback', label: 'ยืนยัน', data: `erp:go:${actionId}`, displayText: 'ยืนยันอนุมัติ' },
        { type: 'postback', label: 'ยกเลิก', data: `erp:no:${actionId}`, displayText: 'ยกเลิก' },
      ],
    },
  };
}

const when = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Public address of the installation (for the webhook URL): PUBLIC_BASE_URL, else the host the request came in on. */
export function publicBase(req: FastifyRequest, env: NodeJS.ProcessEnv): { url: string; fromEnv: boolean } {
  if (env.PUBLIC_BASE_URL) return { url: env.PUBLIC_BASE_URL.replace(/\/+$/, ''), fromEnv: true };
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host) || 'localhost';
  const proto = first(req.headers['x-forwarded-proto']) || 'http';
  return { url: `${proto}://${host}`, fromEnv: false };
}

// ---------- LINE API ----------

async function lineCall(path: string, env: NodeJS.ProcessEnv, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; json: any; detail: string }> {
  const base = env.LINE_API_URL ?? 'https://api.line.me';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET', signal: ctrl.signal, redirect: 'error',
      headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { ok: res.ok, status: res.status, json, detail: res.ok ? `HTTP ${res.status}` : `HTTP ${res.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, status: 0, json: null, detail: (e as Error).name === 'AbortError' ? 'หมดเวลา 5 วินาที' : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

export type LineMessage = string | Record<string, unknown>;
const asMessage = (m: LineMessage) => (typeof m === 'string' ? { type: 'text', text: m.slice(0, 4900) } : m);

/** Reply API (free, needs the event's replyToken, valid ~1 minute). A string is sent as text; an object as-is (flex, template). */
export async function replyLine(replyToken: string, message: LineMessage, env: NodeJS.ProcessEnv): Promise<Delivery> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return { ok: false, detail: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN' };
  const r = await lineCall('/v2/bot/message/reply', env, { method: 'POST', body: { replyToken, messages: [asMessage(message)] } });
  return { ok: r.ok, detail: r.detail };
}

/** Push API to one LINE user (text or a flex/template object). */
export async function pushLineMessage(to: string, message: LineMessage, env: NodeJS.ProcessEnv): Promise<Delivery> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return { ok: false, detail: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN' };
  const r = await lineCall('/v2/bot/message/push', env, { method: 'POST', body: { to, messages: [asMessage(message)] } });
  return { ok: r.ok, detail: r.detail };
}

/**
 * Personal decision cards: for each recipient with a linked LINE, a line_actions row (the button's only key) and a Flex card.
 * Never throws; same tally as pushToUsers.
 */
export async function pushDecisionToUsers(c: Client, userIds: string[], d: { target: string; entityId: string; heading: string; title: string; text: string; openUrl?: string | null },
  env: NodeJS.ProcessEnv): Promise<{ sent: number; notLinked: number; failed: string[] }> {
  const out = { sent: 0, notLinked: 0, failed: [] as string[] };
  if (!userIds.length) return out;
  const links = new Map((await c.query('select user_id, line_user_id from line_links where user_id = any($1::uuid[])', [userIds])).rows.map((r) => [r.user_id as string, r.line_user_id as string]));
  for (const u of userIds) {
    const to = links.get(u);
    if (!to) { out.notLinked++; continue; }
    const row = (await c.query(
      `insert into line_actions (user_id, target, entity_id, title, expires_at) values ($1,$2,$3,$4, now() + make_interval(hours => $5)) returning id`,
      [u, d.target, d.entityId, d.title, DECISION_TTL_HOURS])).rows[0];
    const r = await pushLineMessage(to, decisionFlex({ heading: d.heading, title: d.title, text: d.text, actionId: row.id, openUrl: d.openUrl }), env);
    if (r.ok) out.sent++; else out.failed.push(r.detail);
  }
  return out;
}

/**
 * Remember the permissions of a valid token for the user's LINE link (and pending link code), so a LINE decision can carry them.
 * Written at most every 5 minutes unless they changed. Called from routes every signed-in user hits (bell, LINE pages).
 */
export async function touchLinePerms(c: Client, a: { userId: string; perms: string[] }): Promise<void> {
  await c.query(
    `update line_links set perms = $2, perms_at = now() where user_id = $1 and (perms is distinct from $2 or perms_at is null or perms_at < now() - interval '5 minutes')`,
    [a.userId, a.perms]);
}

/** Display name of a LINE user who added the OA (best effort). */
async function lineDisplayName(lineUserId: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return null;
  const r = await lineCall(`/v2/bot/profile/${encodeURIComponent(lineUserId)}`, env);
  return r.ok && typeof r.json?.displayName === 'string' ? r.json.displayName.slice(0, 100) : null;
}

/** Personal pushes for one action: each ERP user → their linked LINE id. Never throws. */
export async function pushToUsers(c: Client, userIds: string[], text: string, env: NodeJS.ProcessEnv): Promise<{ sent: number; notLinked: number; failed: string[] }> {
  const out = { sent: 0, notLinked: 0, failed: [] as string[] };
  if (!userIds.length) return out;
  const links = new Map((await c.query('select user_id, line_user_id from line_links where user_id = any($1::uuid[])', [userIds])).rows.map((r) => [r.user_id as string, r.line_user_id as string]));
  for (const u of userIds) {
    const to = links.get(u);
    if (!to) { out.notLinked++; continue; }
    const d = await sendLine(to, text, env);
    if (d.ok) out.sent++; else out.failed.push(d.detail);
  }
  return out;
}

// ---------- webhook ----------

interface LineEvent {
  type?: string;
  mode?: string;
  replyToken?: string;
  source?: { type?: string; userId?: string; groupId?: string; roomId?: string };
  message?: { type?: string; text?: string };
  postback?: { data?: string };
}

/**
 * A tap on a decision card. Only the ERP user the card was pushed to (through their linked LINE) may use it, once, before it
 * expires. "ask" → confirm question, "go" → publish automation.line_decision (the owning module decides and answers with
 * <module>.line_decision_result, which is pushed back), "no" → nothing happens.
 */
async function handleDecision(c: Client, k: Pick<Kernel, 'emit'>, lineUserId: string, pb: DecisionPostback): Promise<LineMessage> {
  const link = (await c.query('select user_id, user_name, perms, perms_at from line_links where line_user_id = $1', [lineUserId])).rows[0];
  if (!link) return NOT_LINKED;
  const act = (await c.query('select * from line_actions where id = $1', [pb.id])).rows[0];
  // a card pushed to someone else (forwarded, or a re-linked LINE): answer as if it did not exist
  if (!act || act.user_id !== link.user_id) return 'ไม่พบรายการนี้ หรือรายการนี้ไม่ได้ส่งถึงบัญชีของคุณ';
  if (act.confirmed_at) return act.result_message ?? `${act.title}: กดอนุมัติไปแล้ว กำลังดำเนินการ`;
  if (new Date(act.expires_at).getTime() < Date.now()) return `ปุ่มนี้หมดอายุแล้ว (${DECISION_TTL_HOURS} ชั่วโมง) — เปิดแอปเพื่ออนุมัติ ${act.title}`;
  if (pb.step === 'no') return `ยกเลิกแล้ว — ยังไม่ได้อนุมัติ ${act.title}`;
  if (pb.step === 'ask') return decisionConfirm(act.title, act.id);
  if (!link.perms || !link.perms_at) return 'ระบบยังไม่รู้สิทธิ์ของบัญชีนี้ — เปิดแอป ERP หนึ่งครั้ง แล้วกดอนุมัติใน LINE อีกครั้ง';
  const claimed = (await c.query('update line_actions set confirmed_at = now() where id = $1 and confirmed_at is null returning id', [act.id])).rowCount;
  if (!claimed) return `${act.title}: กดอนุมัติไปแล้ว กำลังดำเนินการ`;
  await k.emit(c, 'automation.line_decision', {
    lineActionId: act.id, userId: link.user_id, userName: link.user_name ?? null, perms: link.perms,
    permsAt: Math.floor(new Date(link.perms_at).getTime() / 1000), target: act.target, entityId: act.entity_id, decision: 'approved',
  });
  return `กำลังอนุมัติ ${act.title}… จะแจ้งผลในแชตนี้`;
}

/** One webhook event inside the tenant's transaction → the reply (or null) and, after a link, whose profile to fetch. */
async function handleEvent(c: Client, ev: LineEvent, k: Pick<Kernel, 'emit'>): Promise<{ reply: LineMessage | null; linked?: string }> {
  if (ev.mode === 'standby') return { reply: null }; // another channel (module) has the chat
  const src = ev.source ?? {};
  const lineUserId = src.type === 'user' ? src.userId : undefined;
  const groupId = src.groupId ?? src.roomId;
  if (ev.type === 'postback') {
    const pb = parseDecisionPostback(ev.postback?.data);
    // decisions only in the 1:1 chat (never act on a tap in a group)
    return { reply: pb && lineUserId && !groupId ? await handleDecision(c, k, lineUserId, pb) : null };
  }

  if (ev.type === 'join' && groupId) return { reply: `สวัสดีครับ บอทแจ้งเตือน ERP พร้อมส่งข้อความเข้ากลุ่มนี้แล้ว\nรหัสกลุ่ม: ${groupId}\nนำรหัสนี้ไปใส่ช่อง "LINE group ID" ในกฎอัตโนมัติ` };
  if (ev.type === 'unfollow' && lineUserId) {
    // blocked the OA: pushes would fail from now on
    await c.query('delete from line_links where line_user_id = $1', [lineUserId]);
    return { reply: null };
  }
  if (ev.type !== 'message' || ev.message?.type !== 'text' || typeof ev.message.text !== 'string') return { reply: null };
  const cmd = parseCommand(ev.message.text);
  if (!cmd) return { reply: null };

  if (groupId) {
    // in groups the bot only answers the group-id question (no personal data in a shared chat)
    return { reply: cmd.kind === 'groupId' ? `รหัสกลุ่มนี้: ${groupId}\nนำไปใส่ช่อง "LINE group ID" ในกฎอัตโนมัติ` : null };
  }
  if (!lineUserId) return { reply: null };
  if (cmd.kind === 'help') return { reply: HELP_TEXT };
  if (cmd.kind === 'groupId') return { reply: 'คำสั่งนี้ใช้ในกลุ่ม LINE ที่เชิญบอทเข้าไปแล้ว' };

  if (cmd.kind === 'link') {
    const wrong = (await c.query(`select count(*)::int as n from line_link_attempts where line_user_id = $1 and created_at > now() - interval '15 minutes'`, [lineUserId])).rows[0].n;
    if (wrong >= MAX_WRONG_CODES) return { reply: 'ใส่รหัสผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่' };
    const wrongAll = (await c.query(`select count(*)::int as n from line_link_attempts where created_at > now() - interval '15 minutes'`)).rows[0].n;
    if (wrongAll >= MAX_WRONG_CODES_PER_TENANT) return { reply: 'ระบบพักการผูกบัญชีชั่วคราวเพราะมีการใส่รหัสผิดจำนวนมาก กรุณาลองใหม่ใน 15 นาที' };
    const code = (await c.query(
      `update line_link_codes set used_at = now(), line_user_id = $2 where code = $1 and used_at is null and expires_at > now() returning user_id, user_name, perms, created_at`, [cmd.code, lineUserId])).rows[0];
    if (!code) {
      // LINE re-delivery of a message we already handled: same code, same LINE account → same answer
      const again = (await c.query('select 1 from line_link_codes where code = $1 and line_user_id = $2 and used_at > now() - interval \'1 hour\'', [cmd.code, lineUserId])).rowCount;
      if (again) return { reply: LINKED_OK };
      await c.query(`delete from line_link_attempts where created_at < now() - interval '1 day'`);
      await c.query('insert into line_link_attempts (line_user_id) values ($1)', [lineUserId]);
      return { reply: 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว (ใช้ได้ 10 นาที ครั้งเดียว) ขอรหัสใหม่ได้ที่เมนู ผูก LINE ของฉัน' };
    }
    // one LINE per ERP user and one ERP user per LINE: the newest link wins
    await c.query('delete from line_links where user_id = $1 or line_user_id = $2', [code.user_id, lineUserId]);
    // the code was made on a valid token: its permissions (as of then) stand until the user next uses the app
    await c.query('insert into line_links (user_id, user_name, line_user_id, perms, perms_at) values ($1,$2,$3,$4,$5)', [code.user_id, code.user_name, lineUserId, code.perms ?? null, code.perms ? code.created_at : null]);
    await c.query('delete from line_link_attempts where line_user_id = $1', [lineUserId]);
    return { reply: `${LINKED_OK}${code.user_name ? `\nบัญชี ERP: ${code.user_name}` : ''}\nพิมพ์ "ช่วยเหลือ" เพื่อดูคำสั่ง`, linked: lineUserId };
  }

  const link = (await c.query('select user_id, user_name from line_links where line_user_id = $1', [lineUserId])).rows[0];
  if (!link) return { reply: NOT_LINKED };
  if (cmd.kind === 'unlink') {
    await c.query('delete from line_links where line_user_id = $1', [lineUserId]);
    return { reply: 'ยกเลิกการผูกบัญชีแล้ว จะไม่ได้รับแจ้งเตือนส่วนตัวทาง LINE อีก (ผูกใหม่ได้ทุกเมื่อ)' };
  }
  // notifications: the last 5 addressed to this person (automation's own data)
  const notes = (await c.query('select title, body, created_at from notifications where recipient_user_id = $1 order by created_at desc limit 5', [link.user_id])).rows;
  if (!notes.length) return { reply: 'ยังไม่มีการแจ้งเตือนส่วนตัวถึงคุณ' };
  return { reply: ['การแจ้งเตือนล่าสุดของคุณ:', ...notes.map((n) => `• ${when.format(new Date(n.created_at))} ${n.title}${n.body ? `\n  ${n.body}` : ''}`)].join('\n') };
}

// ---------- routes ----------

const KeyParam = z.object({ key: z.string().max(100) });

async function settingsRow(c: Client, userId: string) {
  await c.query('insert into line_settings (webhook_secret, created_by) values ($1,$2) on conflict (tenant_id) do nothing', [randomBytes(16).toString('hex'), userId]);
  return (await c.query('select * from line_settings')).rows[0];
}

export function lineRoutes(app: FastifyInstance, k: Kernel) {
  const env = k.env;

  async function settingsView(req: FastifyRequest, tenantId: string, row: any, c: Client) {
    const base = publicBase(req, env);
    const webhookUrl = `${base.url}/api/automation/line/webhook/${makeWebhookKey(tenantId, row.webhook_secret)}`;
    const linked = (await c.query('select count(*)::int as n from line_links')).rows[0].n;
    const missing = [
      ...(env.LINE_CHANNEL_SECRET ? [] : ['LINE_CHANNEL_SECRET']),
      ...(env.LINE_CHANNEL_ACCESS_TOKEN ? [] : ['LINE_CHANNEL_ACCESS_TOKEN']),
      ...(base.fromEnv ? [] : ['PUBLIC_BASE_URL']),
    ];
    const oa = env.LINE_OA_ID?.trim();
    return {
      id: row.id,
      status: missing.length ? `ยังตั้งค่าไม่ครบ: ${missing.join(', ')}` : 'พร้อมใช้งาน',
      ready: missing.length === 0,
      webhook_url: webhookUrl,
      webhook_note: [
        base.fromEnv ? null : 'URL นี้เดาจากที่อยู่ที่เปิดหน้าจอ — ตั้ง PUBLIC_BASE_URL เป็นที่อยู่ https สาธารณะของระบบเพื่อให้ถูกต้อง',
        webhookUrl.startsWith('https://') ? null : 'LINE รับเฉพาะ webhook แบบ https',
      ].filter(Boolean).join(' · ') || 'คัดลอกไปวางที่ LINE Developers → Messaging API → Webhook URL แล้วเปิด Use webhook',
      channel_secret_set: Boolean(env.LINE_CHANNEL_SECRET),
      access_token_set: Boolean(env.LINE_CHANNEL_ACCESS_TOKEN),
      public_base_url_set: base.fromEnv,
      oa_id: oa || null,
      add_friend_url: oa ? `https://line.me/R/ti/p/${encodeURIComponent(oa.startsWith('@') ? oa : `@${oa}`)}` : null,
      linked_users: linked,
      rotated_at: row.rotated_at,
    };
  }

  /** Admin: the LINE OA setup page (webhook URL, what is configured — never the secrets themselves). */
  app.get('/line/settings', async (req) => {
    const a = auth(req);
    requirePerm(a, 'automation.line.manage');
    return k.db.tx(a.tenantId, async (c) => settingsView(req, a.tenantId, await settingsRow(c, a.userId), c));
  });

  /** Admin: new webhook URL (the old one stops working — paste the new one into LINE Developers). */
  app.post('/line/settings/rotate', async (req) => {
    const a = auth(req);
    requirePerm(a, 'automation.line.manage');
    return k.db.tx(a.tenantId, async (c) => {
      await settingsRow(c, a.userId);
      const row = (await c.query('update line_settings set webhook_secret = $1, rotated_at = now() returning *', [randomBytes(16).toString('hex')])).rows[0];
      return { ...(await settingsView(req, a.tenantId, row, c)), message: 'สร้าง Webhook URL ใหม่แล้ว — นำไปวางใน LINE Developers แทนอันเดิม' };
    });
  });

  /** Admin: who has linked LINE (unlink people who left the company). */
  app.get('/line/links', async (req) => {
    const a = auth(req);
    requirePerm(a, 'automation.line.manage');
    return k.db.tx(a.tenantId, async (c) => (await c.query('select id, user_id, user_name, line_name, linked_at from line_links order by linked_at desc')).rows);
  });

  app.delete('/line/links/:id', async (req) => {
    const a = auth(req);
    requirePerm(a, 'automation.line.manage');
    const { id } = parse(z.object({ id: s.uuid }), req.params);
    return k.db.tx(a.tenantId, async (c) => {
      const r = await c.query('delete from line_links where id = $1 returning id', [id]);
      if (!r.rowCount) throw notFound('LINE link');
      return { deleted: id };
    });
  });

  /** Me: am I linked, and my current code (if any). */
  async function meView(c: Client, userId: string) {
    const link = (await c.query('select line_name, linked_at from line_links where user_id = $1', [userId])).rows[0];
    const code = (await c.query('select code, expires_at from line_link_codes where user_id = $1 and used_at is null and expires_at > now() order by created_at desc limit 1', [userId])).rows[0];
    const oa = env.LINE_OA_ID?.trim();
    return {
      status: link ? 'ผูก LINE แล้ว' : 'ยังไม่ได้ผูก LINE',
      linked: Boolean(link),
      line_name: link?.line_name ?? null,
      linked_at: link?.linked_at ?? null,
      code: code?.code ?? null,
      code_expires_at: code?.expires_at ?? null,
      send_text: code ? `ผูกบัญชี ${code.code}` : null,
      add_friend_url: oa ? `https://line.me/R/ti/p/${encodeURIComponent(oa.startsWith('@') ? oa : `@${oa}`)}` : null,
      oa_id: oa || null,
      instructions: link
        ? 'แจ้งเตือนส่วนตัว (คำขออนุมัติ ผลอนุมัติ ใบลา ใบเบิก เรื่องแจ้งปัญหา) จะส่งถึง LINE นี้ด้วย · พิมพ์ "ช่วยเหลือ" ในแชตเพื่อดูคำสั่ง'
        : `1) เพิ่มเพื่อน LINE OA ของบริษัท${oa ? ` (${oa} หรือสแกน QR)` : ''}  2) กด "ขอรหัสผูกบัญชี"  3) พิมพ์ "ผูกบัญชี" ตามด้วยรหัส 6 หลักในแชตภายใน ${LINK_TTL_MINUTES} นาที`,
    };
  }

  app.get('/line/me', async (req) => {
    const a = auth(req);
    requirePerm(a, 'automation.notify.read');
    return k.db.tx(a.tenantId, async (c) => { await touchLinePerms(c, a); return meView(c, a.userId); });
  });

  /** A 6-digit one-time code for the signed-in user, valid 10 minutes. A new code replaces the previous one. */
  app.post('/line/link-code', async (req, reply) => {
    const a = auth(req);
    requirePerm(a, 'automation.notify.read');
    reply.code(201);
    return k.db.tx(a.tenantId, async (c) => {
      await c.query('delete from line_link_codes where user_id = $1 and used_at is null', [a.userId]);
      await c.query(`delete from line_link_codes where expires_at < now() - interval '1 day'`);
      let code = '';
      for (let i = 0; i < 20 && !code; i++) {
        const candidate = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const taken = (await c.query('select 1 from line_link_codes where code = $1 and used_at is null and expires_at > now()', [candidate])).rowCount;
        if (!taken) code = candidate;
      }
      if (!code) throw badRequest('สร้างรหัสไม่สำเร็จ ลองใหม่อีกครั้ง');
      await c.query(`insert into line_link_codes (user_id, user_name, code, expires_at, perms) values ($1,$2,$3, now() + make_interval(mins => $4), $5)`, [a.userId, a.userName ?? null, code, LINK_TTL_MINUTES, a.perms]);
      const me = await meView(c, a.userId);
      return { ...me, message: `รหัสของคุณ ${code} — พิมพ์ "ผูกบัญชี ${code}" ใน LINE OA ของบริษัทภายใน ${LINK_TTL_MINUTES} นาที` };
    });
  });

  /** Unlink my own LINE. */
  app.post('/line/unlink', async (req) => {
    const a = auth(req);
    requirePerm(a, 'automation.notify.read');
    return k.db.tx(a.tenantId, async (c) => {
      const n = (await c.query('delete from line_links where user_id = $1', [a.userId])).rowCount ?? 0;
      return { ...(await meView(c, a.userId)), message: n ? 'ยกเลิกการผูก LINE แล้ว' : 'ยังไม่ได้ผูก LINE' };
    });
  });

  /** "ทดสอบส่งถึงฉัน": push a test message to my linked LINE. */
  app.post('/line/test', async (req) => {
    const a = auth(req);
    requirePerm(a, 'automation.notify.read');
    const link = await k.db.tx(a.tenantId, async (c) => (await c.query('select line_user_id from line_links where user_id = $1', [a.userId])).rows[0]);
    if (!link) throw badRequest('คุณยังไม่ได้ผูก LINE — ไปที่ ผูก LINE ของฉัน ก่อน');
    const d = await sendLine(link.line_user_id, `ทดสอบจากระบบ ERP ✅\nถ้าเห็นข้อความนี้ แจ้งเตือนส่วนตัวจะส่งถึง LINE นี้ได้${a.userName ? `\n(${a.userName})` : ''}`, env);
    if (!d.ok) throw badRequest(`ส่ง LINE ไม่สำเร็จ: ${d.detail}`);
    return { ok: true, message: 'ส่งข้อความทดสอบไปที่ LINE ของคุณแล้ว' };
  });

  /**
   * LINE webhook (public). LINE signs the exact bytes, so this route keeps the raw body (own content-type parser in an
   * encapsulated context; the gateway forwards this path byte for byte). Wrong/missing signature → 401, unknown key → 404.
   * After a valid signature we always answer 200 (LINE would otherwise retry); each event is handled on its own.
   */
  app.register(async (raw) => {
    raw.removeAllContentTypeParsers();
    raw.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));
    raw.post('/line/webhook/:key', { config: { public: true } }, async (req, reply) => {
      const { key } = parse(KeyParam, req.params);
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!env.LINE_CHANNEL_SECRET) {
        reply.code(503);
        return { error: { code: 'line_not_configured', message: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_SECRET' } };
      }
      const sig = req.headers['x-line-signature'];
      if (!verifyLineSignature(env.LINE_CHANNEL_SECRET, body, typeof sig === 'string' ? sig : undefined)) {
        reply.code(401);
        return { error: { code: 'bad_signature', message: 'Invalid LINE signature' } };
      }
      const parsedKey = parseWebhookKey(key);
      const ok = parsedKey && await k.db.tx(parsedKey.tenantId, async (c) => {
        const row = (await c.query('select webhook_secret from line_settings')).rows[0];
        return Boolean(row && sameSecret(row.webhook_secret, parsedKey.secret));
      });
      if (!parsedKey || !ok) {
        reply.code(404);
        return { error: { code: 'not_found', message: 'Unknown LINE webhook' } };
      }
      let events: LineEvent[] = [];
      try { events = (JSON.parse(body.toString('utf8') || '{}') as { events?: LineEvent[] }).events ?? []; } catch { throw badRequest('Invalid JSON'); }
      let handled = 0;
      for (const ev of events.slice(0, 100)) {
        try {
          const r = await k.db.tx(parsedKey.tenantId, (c) => handleEvent(c, ev, k));
          handled++;
          if (r.reply && ev.replyToken) {
            const d = await replyLine(ev.replyToken, r.reply, env);
            if (!d.ok) req.log.warn({ detail: d.detail }, 'LINE reply failed');
          }
          if (r.linked) {
            const name = await lineDisplayName(r.linked, env);
            if (name) await k.db.tx(parsedKey.tenantId, (c) => c.query('update line_links set line_name = $1 where line_user_id = $2', [name, r.linked]));
          }
        } catch (e) {
          req.log.error(e);
        }
      }
      return { ok: true, handled };
    });
  });
}
