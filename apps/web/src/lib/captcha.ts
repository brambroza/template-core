'use client';
/**
 * Which CAPTCHA site key the public forms use (components/Turnstile.tsx shows the widget).
 * The key comes from identity at run time (`GET /api/identity/captcha`, its TURNSTILE_SITE_KEY), so one build of the web app
 * serves any installation; NEXT_PUBLIC_TURNSTILE_SITE_KEY baked in at build time still works and wins when set.
 */
import { SHOWCASE } from './showcase';

/** baked in at build time (optional — see above) */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

/** The site key from an answer of `GET /api/identity/captcha` ('' when none is configured or the answer is not what we expect). */
export function siteKeyFrom(answer: unknown): string {
  const key = (answer as { siteKey?: unknown } | null)?.siteKey;
  return typeof key === 'string' ? key.trim() : '';
}

let siteKeyRequest: Promise<string> | null = null;

/**
 * The site key of this installation, asked once per page load. '' = no CAPTCHA. A request that did not get through is asked
 * again by the next call (a form that could not load the key must not stay without its widget for good).
 */
export function captchaSiteKey(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (TURNSTILE_SITE_KEY) return Promise.resolve(TURNSTILE_SITE_KEY);
  if (SHOWCASE) return Promise.resolve(''); // the public showcase sends nothing: no widget
  siteKeyRequest ??= fetchImpl('/api/identity/captcha', { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`captcha ${res.status}`);
      return siteKeyFrom(await res.json());
    })
    .catch(() => { siteKeyRequest = null; return ''; });
  return siteKeyRequest;
}

/** test hook: forget the answer */
export function resetCaptchaSiteKey(): void { siteKeyRequest = null; }
