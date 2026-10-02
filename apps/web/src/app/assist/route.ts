import type { NextRequest } from 'next/server';
import { moduleUis } from '@/modules.generated';
import { runAssistant, type ChatMessage } from '@/lib/assistant';

export const dynamic = 'force-dynamic';

/** Small per-token limiter so one browser tab cannot run up the AI bill. */
const hits = new Map<string, number[]>();
const LIMIT = Number(process.env.ASSISTANT_RATE_PER_MIN ?? 20);
function limited(key: string) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > LIMIT;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * POST /assist { messages: [{ role, content }] } with the user's Authorization header.
 * Lives outside /api because /api/* is proxied straight to the gateway.
 */
export async function POST(req: NextRequest) {
  const authorization = req.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: { message: 'กรุณาเข้าสู่ระบบ' } }, 401);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ offline: true, reply: 'ผู้ช่วย AI ยังไม่ได้เปิดใช้ — ผู้ดูแลระบบใส่ ANTHROPIC_API_KEY ในเครื่องเซิร์ฟเวอร์เว็บแล้วรีสตาร์ท (คำสั่งลัดและการค้นหายังใช้ได้ตามปกติ)', actions: [] });
  }
  let body: any;
  try { body = await req.json(); } catch { return json({ error: { message: 'รูปแบบคำขอไม่ถูกต้อง' } }, 400); }
  const messages: ChatMessage[] = Array.isArray(body?.messages)
    ? body.messages
      .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-12)
      .map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    : [];
  if (!messages.length || messages[messages.length - 1].role !== 'user') return json({ error: { message: 'พิมพ์คำถามก่อน' } }, 400);
  if (messages[0].role !== 'user') messages.shift();
  if (limited(authorization)) return json({ error: { message: 'ถามถี่เกินไป รอสักครู่แล้วลองใหม่' } }, 429);

  const gatewayUrl = (process.env.GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
  try {
    // who is asking and what is installed — from the gateway, never from the browser
    const [meRes, catRes] = await Promise.all([
      fetch(`${gatewayUrl}/api/identity/me`, { headers: { authorization }, cache: 'no-store' }),
      fetch(`${gatewayUrl}/api/_catalog`, { headers: { authorization }, cache: 'no-store' }),
    ]);
    if (meRes.status === 401) return json({ error: { message: 'กรุณาเข้าสู่ระบบใหม่' } }, 401);
    if (!meRes.ok || !catRes.ok) return json({ error: { message: 'เชื่อมต่อเซิร์ฟเวอร์ ERP ไม่ได้' } }, 502);
    const me = (await meRes.json()) as { permissions: string[]; name?: string };
    const installed = new Set(((await catRes.json()) as { modules: { id: string }[] }).modules.map((m) => m.id));
    const result = await runAssistant({
      messages, authorization, apiKey, gatewayUrl,
      modules: moduleUis.filter((m) => installed.has(m.module)),
      permissions: me.permissions ?? [],
      model: process.env.ANTHROPIC_MODEL || undefined,
      baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
      tenantName: process.env.COMPANY_NAME || undefined,
    });
    return json(result);
  } catch (e) {
    console.error('[assist]', e);
    return json({ error: { message: 'ผู้ช่วย AI ไม่ตอบในตอนนี้ ลองใหม่อีกครั้ง' } }, 502);
  }
}
