import type { NextRequest } from 'next/server';
import { moduleUis } from '@/modules.generated';
import { findScreen } from '@/lib/assistant';
import { AI_OFFLINE, aiEnv, bearer, json, limited, whoIsAsking } from '@/lib/assist-server';

export const dynamic = 'force-dynamic';

/** POST /assist/find { text } — "ค้นหาด้วย AI" in ⌘K: a Thai sentence -> one list screen opened with its filters. */
export async function POST(req: NextRequest) {
  const authorization = bearer(req);
  if (!authorization) return json({ error: { message: 'กรุณาเข้าสู่ระบบ' } }, 401);
  const env = aiEnv();
  if (!env) return json({ offline: true, reply: AI_OFFLINE, actions: [] });
  let body: any;
  try { body = await req.json(); } catch { return json({ error: { message: 'รูปแบบคำขอไม่ถูกต้อง' } }, 400); }
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ error: { message: 'พิมพ์สิ่งที่ต้องการค้นหาก่อน' } }, 400);
  if (limited(authorization)) return json({ error: { message: 'ค้นหาถี่เกินไป รอสักครู่แล้วลองใหม่' } }, 429);
  try {
    const who = await whoIsAsking(env.gatewayUrl, authorization, moduleUis);
    if (who instanceof Response) return who;
    return json(await findScreen({ ...env, text, authorization, modules: who.modules, permissions: who.permissions }));
  } catch (e) {
    console.error('[assist/find]', e);
    return json({ error: { message: 'ค้นหาด้วย AI ไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง' } }, 502);
  }
}
