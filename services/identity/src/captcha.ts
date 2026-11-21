/**
 * Cloudflare Turnstile check for public forms (sign-up, forgot password). TURNSTILE_SECRET unset = no check (local demo, tests);
 * in production set it together with the web app's NEXT_PUBLIC_TURNSTILE_SITE_KEY.
 */
type Env = Record<string, string | undefined>;

/** True when the token passes, or when no secret is configured. Network errors count as a failure (fail closed). */
export async function captchaOk(env: Env, token: string | undefined, ip: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== 'direct') body.set('remoteip', ip);
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const r = (await res.json()) as { success?: boolean };
    return r.success === true;
  } catch {
    return false;
  }
}
