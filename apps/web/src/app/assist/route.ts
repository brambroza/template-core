import type { NextRequest } from 'next/server';
import { moduleUis } from '@/modules.generated';
import { runAssistant, type ChatMessage } from '@/lib/assistant';
import { aiEnv, aiOfflineText, bearer, json, limited, whoIsAsking } from '@/lib/assist-server';

export const dynamic = 'force-dynamic';

/**
 * POST /assist { messages: [{ role, content }] } with the user's Authorization header.
 * Lives outside /api because /api/* is proxied straight to the gateway.
 */
export async function POST(req: NextRequest) {
  const authorization = bearer(req);
  if (!authorization) return json({ error: { message: 'กรุณาเข้าสู่ระบบ' } }, 401);
  const env = aiEnv();
  if (!env) return json({ offline: true, reply: aiOfflineText(), actions: [] });
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

  try {
    const who = await whoIsAsking(env.gatewayUrl, authorization, moduleUis);
    if (who instanceof Response) return who;
    const result = await runAssistant({ ...env, messages, authorization, modules: who.modules, permissions: who.permissions });
    return json(result);
  } catch (e) {
    console.error('[assist]', e);
    return json({ error: { message: 'ผู้ช่วย AI ไม่ตอบในตอนนี้ ลองใหม่อีกครั้ง' } }, 502);
  }
}
