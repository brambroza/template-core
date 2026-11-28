/**
 * Cloudflare Turnstile check for public forms (sign-up, forgot password). TURNSTILE_SECRET unset = no check (local demo, tests);
 * in production set it together with TURNSTILE_SITE_KEY: the web app reads the site key from `GET /captcha` at run time, so one
 * build serves any installation (a web app built with NEXT_PUBLIC_TURNSTILE_SITE_KEY still works without it).
 */
type Env = Record<string, string | undefined>;

/** What the public forms need to show the widget: the site key (public by design), or null when no CAPTCHA is configured. */
export function captchaPublicConfig(env: Env): { provider: 'turnstile' | null; siteKey: string | null } {
  const siteKey = (env.TURNSTILE_SITE_KEY ?? '').trim();
  return siteKey ? { provider: 'turnstile', siteKey } : { provider: null, siteKey: null };
}

/**
 * A warning for the log when the two halves do not match: a secret without a site key refuses every sign-up unless the web app was
 * built with its own key; a site key without a secret shows the widget but checks nothing. Null when the settings are consistent.
 */
export function captchaConfigWarning(env: Env): string | null {
  const secret = !!env.TURNSTILE_SECRET;
  const siteKey = !!(env.TURNSTILE_SITE_KEY ?? '').trim();
  if (secret && !siteKey) return 'TURNSTILE_SECRET is set without TURNSTILE_SITE_KEY: sign-up and forgot-password fail unless the web app was built with NEXT_PUBLIC_TURNSTILE_SITE_KEY';
  if (!secret && siteKey) return 'TURNSTILE_SITE_KEY is set without TURNSTILE_SECRET: the widget is shown but its answer is not checked';
  return null;
}

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
