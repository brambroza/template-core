'use client';
/**
 * Cloudflare Turnstile ("ฉันไม่ใช่โปรแกรมอัตโนมัติ") on the public forms. Shown only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set at
 * build time; identity checks the token when its TURNSTILE_SECRET is set. Without a key the forms work without it (local demo).
 */
import { useEffect, useRef } from 'react';

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi { render(el: HTMLElement, opts: Record<string, unknown>): string; reset(id?: string): void; remove(id: string): void }
declare global { interface Window { turnstile?: TurnstileApi } }

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

/** The widget. `onToken('')` when it expires or fails, so the form asks again. `resetKey` changes → a fresh challenge. */
export function Turnstile({ onToken, resetKey = 0 }: { onToken: (token: string) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !box.current) return;
    let id: string | undefined;
    let gone = false;
    loadScript().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      id = window.turnstile.render(box.current, {
        sitekey: TURNSTILE_SITE_KEY, language: 'th', theme: 'auto',
        callback: (t: string) => onToken(t), 'expired-callback': () => onToken(''), 'error-callback': () => onToken(''),
      });
    }).catch(() => onToken(''));
    return () => { gone = true; if (id && window.turnstile) window.turnstile.remove(id); };
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={box} className="turnstile" />;
}
