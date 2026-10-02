import { createHmac } from 'node:crypto';
import { get } from '@erp/ui-schema';
import { eventInfo, type ActionSpec, type Condition } from './catalog.ts';

const OPS_TH: Record<Condition['op'], string> = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', contains: 'มีคำว่า' };
const ACTION_TH: Record<ActionSpec['type'], string> = { notify: 'แจ้งเตือนในแอป', line: 'ส่ง LINE', webhook: 'ส่ง webhook' };

export function matches(conditions: Condition[], data: unknown): boolean {
  return conditions.every((c) => {
    const v = get(data, c.field);
    const num = Number(c.value);
    switch (c.op) {
      case 'eq': return String(v) === String(c.value);
      case 'ne': return String(v) !== String(c.value);
      case 'gt': return Number(v) > num;
      case 'gte': return Number(v) >= num;
      case 'lt': return Number(v) < num;
      case 'lte': return Number(v) <= num;
      case 'contains': return String(v ?? '').toLowerCase().includes(String(c.value).toLowerCase());
    }
  });
}

const nf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
/** Thai wording for the English enum codes events carry — `{{decision:th}}`. */
const ENUM_TH: Record<string, string> = {
  approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', returned: 'ส่งกลับแก้ไข', cancelled: 'ยกเลิก',
  low: 'ต่ำ', normal: 'ปกติ', high: 'สูง', urgent: 'ด่วนมาก', pass: 'ผ่าน', fail: 'ไม่ผ่าน', conditional: 'ผ่านแบบมีเงื่อนไข',
  minor: 'เล็กน้อย', major: 'สำคัญ', critical: 'วิกฤต', true: 'ใช่', false: 'ไม่ใช่',
};
/** "{{itemCode}} เหลือ {{onHand}}" with numbers formatted the Thai way; `{{field:th}}` translates enum codes. */
export function render(template: string, data: unknown): string {
  return template.replace(/\{\{\s*([\w.]+)(:th)?\s*\}\}/g, (_, key: string, th?: string) => {
    const v = get(data, key);
    if (v === undefined || v === null) return '-';
    if (th) return ENUM_TH[String(v)] ?? String(v);
    return typeof v === 'number' ? nf.format(v) : String(v);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parsed `to` of a notify action. */
export type Recipients = { kind: 'all' } | { kind: 'fields'; fields: string[] } | { kind: 'user'; userId: string };

/** Parse `to` ('all' | 'field:a,b' | 'user:<uuid>'); returns an error text for anything else. */
export function parseTo(to: string | undefined): Recipients | string {
  const v = (to ?? '').trim();
  if (!v || v === 'all') return { kind: 'all' };
  if (v.startsWith('field:')) {
    const fields = v.slice(6).split(',').map((x) => x.trim()).filter(Boolean);
    return fields.length ? { kind: 'fields', fields } : 'ระบุช่องข้อมูลผู้รับ เช่น field:requesterId';
  }
  if (v.startsWith('user:')) return UUID.test(v.slice(5)) ? { kind: 'user', userId: v.slice(5).toLowerCase() } : 'รหัสผู้ใช้ (user:…) ไม่ถูกต้อง';
  return 'ผู้รับต้องเป็น all, field:<ช่อง> หรือ user:<รหัสผู้ใช้>';
}

/** Who gets a notification for this event: null = everyone (broadcast), otherwise the distinct user ids (may be empty). */
export function resolveRecipients(to: string | undefined, data: unknown): string[] | null {
  const r = parseTo(to);
  if (typeof r === 'string' || r.kind === 'all') return null;
  if (r.kind === 'user') return [r.userId];
  const ids = r.fields.map((f) => get(data, f)).filter((x): x is string => typeof x === 'string' && UUID.test(x)).map((x) => x.toLowerCase());
  return [...new Set(ids)];
}

/** Thai wording of `to` for rule summaries. */
export function describeTo(to: string | undefined, eventType: string): string {
  const r = parseTo(to);
  if (typeof r === 'string' || r.kind === 'all') return 'ทุกคน';
  if (r.kind === 'user') return 'ผู้ใช้ที่เลือก';
  const ev = eventInfo(eventType);
  return r.fields.map((f) => ev?.userFields?.find((x) => x.key === f)?.label ?? f).join(' / ');
}

/** In-app link for a notification: values are path-encoded so event data can never change where it points. */
export function renderLink(template: string, data: unknown): string | null {
  let ok = true;
  const out = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = get(data, key);
    if (v === undefined || v === null || v === '') ok = false;
    return encodeURIComponent(String(v ?? ''));
  });
  return ok && out.startsWith('/') && !out.startsWith('//') ? out : null;
}

/** Human sentence for a rule: เมื่อ … ถ้า … ให้ … */
export function describe(rule: { event_type: string; conditions: Condition[]; actions: ActionSpec[] }): string {
  const ev = eventInfo(rule.event_type);
  const when = `เมื่อ${ev?.label ?? rule.event_type}`;
  const cond = rule.conditions.length
    ? ` ถ้า ${rule.conditions.map((c) => `${ev?.fields.find((f) => f.key === c.field)?.label ?? c.field} ${OPS_TH[c.op]} ${typeof c.value === 'number' ? nf.format(c.value) : c.value}`).join(' และ ')}`
    : '';
  const act = ` ให้${[...new Set(rule.actions.map((a) => (a.type === 'notify' && a.to && a.to !== 'all' ? `${ACTION_TH.notify} (ถึง${describeTo(a.to, rule.event_type)})` : ACTION_TH[a.type])))].join(' + ')}`;
  return `${when}${cond}${act}`;
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)|\.(internal|local|localhost)$/i;

/** Webhook targets must be public https URLs (no SSRF into the customer's network). */
export function webhookProblem(target: string | undefined, env: NodeJS.ProcessEnv): string | null {
  if (!target) return 'ต้องระบุ URL ของ webhook';
  let u: URL;
  try { u = new URL(target); } catch { return 'URL ของ webhook ไม่ถูกต้อง'; }
  const allowPrivate = env.AUTOMATION_ALLOW_PRIVATE_WEBHOOKS === '1';
  if (u.protocol !== 'https:' && !(allowPrivate && u.protocol === 'http:')) return 'webhook ต้องเป็น https';
  if (!allowPrivate && PRIVATE_HOST.test(u.hostname)) return 'ส่ง webhook ไปที่อยู่ภายในเครือข่ายไม่ได้';
  return null;
}

export interface Delivery { ok: boolean; detail: string }

async function post(url: string, body: string, headers: Record<string, string>): Promise<Delivery> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, signal: ctrl.signal, redirect: 'error' });
    return res.ok ? { ok: true, detail: `HTTP ${res.status}` } : { ok: false, detail: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).name === 'AbortError' ? 'หมดเวลา 5 วินาที' : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** LINE Messaging API push (target = user/group id). Needs LINE_CHANNEL_ACCESS_TOKEN. */
export async function sendLine(target: string | undefined, text: string, env: NodeJS.ProcessEnv): Promise<Delivery> {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return { ok: false, detail: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN' };
  if (!target) return { ok: false, detail: 'ยังไม่ได้ระบุ LINE user/group id' };
  const base = env.LINE_API_URL ?? 'https://api.line.me';
  return post(`${base}/v2/bot/message/push`, JSON.stringify({ to: target, messages: [{ type: 'text', text: text.slice(0, 4900) }] }), { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` });
}

/** JSON webhook, signed with HMAC-SHA256 (X-ERP-Signature) when WEBHOOK_SECRET is set. */
export async function sendWebhook(target: string | undefined, payload: unknown, env: NodeJS.ProcessEnv): Promise<Delivery> {
  const problem = webhookProblem(target, env);
  if (problem) return { ok: false, detail: problem };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {};
  if (env.WEBHOOK_SECRET) headers['x-erp-signature'] = createHmac('sha256', env.WEBHOOK_SECRET).update(body).digest('hex');
  return post(target!, body, headers);
}
