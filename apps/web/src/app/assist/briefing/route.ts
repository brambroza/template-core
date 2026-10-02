import type { NextRequest } from 'next/server';
import { moduleUis } from '@/modules.generated';
import { BriefingCache, runBriefing } from '@/lib/assistant';
import { AI_OFFLINE, aiEnv, bearer, json, limited, whoIsAsking } from '@/lib/assist-server';

export const dynamic = 'force-dynamic';

/** One AI run per user per 10 minutes, however often the button is pressed. */
const cache = new BriefingCache(Number(process.env.BRIEFING_CACHE_MINUTES ?? 10) * 60_000);

/** POST /assist/briefing — "สรุปให้หน่อย" on the dashboard: ≤ 5 Thai bullets from live data, with buttons to the lists. */
export async function POST(req: NextRequest) {
  const authorization = bearer(req);
  if (!authorization) return json({ error: { message: 'กรุณาเข้าสู่ระบบ' } }, 401);
  const env = aiEnv();
  if (!env) return json({ offline: true, reply: AI_OFFLINE, bullets: [], actions: [] });
  try {
    const who = await whoIsAsking(env.gatewayUrl, authorization, moduleUis);
    if (who instanceof Response) return who;
    // the key is the user, not the token: a new login does not buy a new run; permissions/modules change -> new key
    const key = `${who.tenantId}:${who.userId}:${who.permissions.length}:${who.modules.map((m) => m.module).join(',')}`;
    const result = await cache.get(key, () => {
      if (limited(authorization)) throw Object.assign(new Error('rate'), { rate: true });
      return runBriefing({ ...env, authorization, modules: who.modules, permissions: who.permissions });
    });
    return json(result);
  } catch (e) {
    if ((e as { rate?: boolean }).rate) return json({ error: { message: 'ขอถี่เกินไป รอสักครู่แล้วลองใหม่' } }, 429);
    console.error('[assist/briefing]', e);
    return json({ error: { message: 'สรุปไม่ได้ในตอนนี้ ลองใหม่อีกครั้ง' } }, 502);
  }
}
