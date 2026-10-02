/**
 * Shared plumbing for the AI routes under /assist (chat, briefing, find, fill). Server-only.
 * Every route: the user's own ERP token → who they are and what is installed comes from the gateway,
 * the customer's own ANTHROPIC_API_KEY, a small per-token rate limit, Thai messages.
 */
import type { ModuleUi } from '@erp/ui-schema';

export const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Shown when the installation has no ANTHROPIC_API_KEY: every AI feature is optional. */
export const AI_OFFLINE = 'ผู้ช่วย AI ยังไม่ได้เปิดใช้ — ผู้ดูแลระบบใส่ ANTHROPIC_API_KEY ในเครื่องเซิร์ฟเวอร์เว็บแล้วรีสตาร์ท (คำสั่งลัดและการค้นหายังใช้ได้ตามปกติ)';

/** Small per-token limiter so one browser tab cannot run up the AI bill. */
const hits = new Map<string, number[]>();
const LIMIT = Number(process.env.ASSISTANT_RATE_PER_MIN ?? 20);
export function limited(key: string, limit = LIMIT): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > limit;
}

export interface AiEnv { apiKey: string; model?: string; baseUrl?: string; gatewayUrl: string; tenantName?: string }

export function aiEnv(): AiEnv | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    model: process.env.ANTHROPIC_MODEL || undefined,
    baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
    gatewayUrl: (process.env.GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
    tenantName: process.env.COMPANY_NAME || undefined,
  };
}

export interface Who { userId: string; tenantId: string; permissions: string[]; modules: ModuleUi[] }

/** The signed-in user and the installed modules (with screens), from the gateway — never from the browser. Returns a Response on failure. */
export async function whoIsAsking(gatewayUrl: string, authorization: string, shipped: ModuleUi[]): Promise<Who | Response> {
  const [meRes, catRes] = await Promise.all([
    fetch(`${gatewayUrl}/api/identity/me`, { headers: { authorization }, cache: 'no-store' }),
    fetch(`${gatewayUrl}/api/_catalog`, { headers: { authorization }, cache: 'no-store' }),
  ]);
  if (meRes.status === 401) return json({ error: { message: 'กรุณาเข้าสู่ระบบใหม่' } }, 401);
  if (!meRes.ok || !catRes.ok) return json({ error: { message: 'เชื่อมต่อเซิร์ฟเวอร์ ERP ไม่ได้' } }, 502);
  const me = (await meRes.json()) as { id?: string; tenantId?: string; permissions?: string[] };
  const installed = new Set(((await catRes.json()) as { modules: { id: string }[] }).modules.map((m) => m.id));
  return { userId: String(me.id ?? ''), tenantId: String(me.tenantId ?? ''), permissions: me.permissions ?? [], modules: shipped.filter((m) => installed.has(m.module)) };
}

export function bearer(req: Request): string | null {
  const a = req.headers.get('authorization') ?? '';
  return a.startsWith('Bearer ') ? a : null;
}
