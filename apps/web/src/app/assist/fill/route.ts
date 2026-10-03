import type { NextRequest } from 'next/server';
import { hasPerm } from '@erp/ui-schema';
import { moduleUis } from '@/modules.generated';
import { AiFillError, runAiFill } from '@/lib/ai-fill';
import { aiEnv, aiOfflineText, bearer, json, limited, whoIsAsking } from '@/lib/assist-server';

export const dynamic = 'force-dynamic';

/**
 * POST /assist/fill { module, screen, file: { mediaType, dataBase64, name? } } — "สแกนใบเสร็จ" on a form with `aiFill`.
 * Returns proposed values/lines for the browser to put into the form; nothing is saved here.
 */
export async function POST(req: NextRequest) {
  const authorization = bearer(req);
  if (!authorization) return json({ error: { message: 'กรุณาเข้าสู่ระบบ' } }, 401);
  const env = aiEnv();
  if (!env) return json({ offline: true, message: aiOfflineText() });
  let body: any;
  try { body = await req.json(); } catch { return json({ error: { message: 'ไฟล์ใหญ่เกินไปหรือรูปแบบคำขอไม่ถูกต้อง' } }, 400); }
  if (limited(authorization)) return json({ error: { message: 'สแกนถี่เกินไป รอสักครู่แล้วลองใหม่' } }, 429);
  try {
    const who = await whoIsAsking(env.gatewayUrl, authorization, moduleUis);
    if (who instanceof Response) return who;
    const ui = who.modules.find((m) => m.module === String(body?.module ?? ''));
    const screen = ui?.screens[String(body?.screen ?? '')];
    if (!ui || !screen) return json({ error: { message: 'ไม่พบหน้าจอนี้' } }, 404);
    if (!hasPerm(who.permissions, screen.perm)) return json({ error: { message: 'บัญชีนี้ไม่มีสิทธิ์ใช้หน้านี้' } }, 403);
    const result = await runAiFill({ ...env, ui, screenId: String(body.screen), file: body.file, authorization, permissions: who.permissions });
    return json(result);
  } catch (e) {
    if (e instanceof AiFillError) return json({ error: { message: e.message } }, e.status);
    console.error('[assist/fill]', e);
    return json({ error: { message: 'AI อ่านเอกสารไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง หรือกรอกเอง' } }, 502);
  }
}
