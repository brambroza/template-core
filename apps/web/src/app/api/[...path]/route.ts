import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/** Same-origin proxy to the ERP gateway (GATEWAY_URL read at runtime, so one build serves any installation). */
async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const base = (process.env.GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
  const target = `${base}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const h of ['authorization', 'content-type', 'accept-language', 'x-line-signature']) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  // an empty string body would be sent as text/plain and rejected; forward "no body" instead
  const body = ['GET', 'HEAD'].includes(req.method) ? '' : await req.text();
  if (!body) headers.delete('content-type');
  try {
    const res = await fetch(target, {
      method: req.method,
      headers,
      body: body || undefined,
      cache: 'no-store',
    });
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
  } catch {
    return Response.json({ error: { code: 'gateway_unreachable', message: 'เชื่อมต่อเซิร์ฟเวอร์ ERP ไม่ได้' } }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
