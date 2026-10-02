'use client';

import { loadSession } from './session';

/**
 * Per-user UI preferences (collapsed menu areas, dashboard card choice) in localStorage.
 * Keyed by company + user so two people sharing a PC keep their own layout. Storage may be unavailable
 * (private mode, blocked site data): reads then return the fallback and writes are dropped.
 */
function key(name: string): string {
  const s = loadSession();
  return `erp.pref.${name}.${s?.tenant.code ?? '-'}.${s?.user.email ?? '-'}`;
}

export function readPref<T>(name: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key(name));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writePref(name: string, value: unknown): void {
  try {
    window.localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    /* storage unavailable: the choice lasts until the page is reloaded */
  }
}
