'use client';

export interface Session {
  token: string;
  tenant: { id: string; code: string; name: string };
  user: { id: string; email: string; name: string };
  permissions: string[];
}

const KEY = 'erp.session';

export function loadSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: session lives only in memory for this tab */
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
