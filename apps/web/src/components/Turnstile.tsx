'use client';
/**
 * Cloudflare Turnstile ("ฉันไม่ใช่โปรแกรมอัตโนมัติ") on the public forms (sign-up, forgot password).
 * The site key comes from identity at run time (`GET /api/identity/captcha`, its TURNSTILE_SITE_KEY), so one build of the web app
 * serves any installation; NEXT_PUBLIC_TURNSTILE_SITE_KEY baked in at build time still works and wins when set. Identity checks
 * the token when its TURNSTILE_SECRET is set. Without a key the forms work without the widget (local demo).
 */
import { useEffect, useRef, useState } from 'react';
import { captchaSiteKey, TURNSTILE_SITE_KEY } from '@/lib/captcha';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi { render(el: HTMLElement, opts: Record<string, unknown>): string; reset(id?: string): void; remove(id: string): void }
declare global { interface Window { turnstile?: TurnstileApi } }

/**
 * Site key for a form: '' while it is being asked for and when no CAPTCHA is configured. `round` is the form's retry counter
 * (the same one that resets the widget): after a failed submit the key is asked for again if the first request did not get through.
 */
export function useCaptchaSiteKey(round = 0): string {
  const [key, setKey] = useState(TURNSTILE_SITE_KEY);
  useEffect(() => {
    let gone = false;
    void captchaSiteKey().then((k) => { if (!gone && k) setKey(k); });
    return () => { gone = true; };
  }, [round]);
  return key;
}

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { loading = null; reject(new Error('turnstile')); };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * The widget for `siteKey` (from useCaptchaSiteKey; nothing is shown without one). `onToken('')` when it expires or fails, so
 * the form asks again. `resetKey` changes → a fresh challenge (a token can be checked only once).
 */
export function Turnstile({ siteKey, onToken, resetKey = 0 }: { siteKey: string; onToken: (token: string) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey || !box.current) return;
    let id: string | undefined;
    let gone = false;
    loadScript().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, {
        sitekey: siteKey, language: 'th', theme: 'auto',
        callback: (t: string) => onToken(t), 'expired-callback': () => onToken(''), 'error-callback': () => onToken(''),
      });
    }).catch(() => onToken(''));
    return () => { gone = true; if (id && window.turnstile) window.turnstile.remove(id); };
  }, [siteKey, resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!siteKey) return null;
  return <div ref={box} className="turnstile" />;
}
