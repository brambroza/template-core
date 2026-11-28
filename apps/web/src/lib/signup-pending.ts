'use client';
/**
 * A sign-up waiting for its 6-digit code (identity `POST /signup` → page /signup/verify → `POST /signup/verify`).
 * The ticket names the sign-up to the server and only the browser that signed up has it, so it is kept for the tab
 * (sessionStorage): reloading the code page keeps working; a closed tab means signing up again. When the browser refuses
 * storage the sign-up still lives in memory, which is enough to go from the form to the code page (but not for a reload).
 */
export interface PendingSignup {
  ticket: string;
  email: string;
  /** when the sign-up was sent (ms) — the server forgets it after PENDING_MAX_AGE_MS */
  startedAt: number;
  /** when the newest code was mailed (ms) */
  sentAt: number;
  /** minutes a code can be used, and seconds before another one may be asked for (both from the server's answer) */
  codeMinutes: number;
  resendSeconds: number;
}

const KEY = 'erp.signup.pending';
/** identity keeps a pending sign-up for 24 hours (SIGNUP_PENDING_HOURS) */
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const CODE_LENGTH = 6;

/** copy for browsers that refuse sessionStorage (lost on reload) */
let inMemory: string | null = null;

/** A stored value as a pending sign-up, or null when it is not one or is older than the server keeps it. */
export function parsePendingSignup(raw: string | null, now: number): PendingSignup | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<PendingSignup> | null;
    if (!p || typeof p.ticket !== 'string' || !p.ticket || typeof p.email !== 'string' || !p.email) return null;
    const startedAt = Number(p.startedAt);
    if (!Number.isFinite(startedAt) || now - startedAt > PENDING_MAX_AGE_MS) return null;
    const sentAt = Number(p.sentAt);
    return {
      ticket: p.ticket, email: p.email, startedAt, sentAt: Number.isFinite(sentAt) ? sentAt : startedAt,
      codeMinutes: Number(p.codeMinutes) > 0 ? Number(p.codeMinutes) : 10, resendSeconds: Number(p.resendSeconds) > 0 ? Number(p.resendSeconds) : 60,
    };
  } catch {
    return null;
  }
}

/** The sign-up this tab is confirming, or null (none, unreadable, or older than the server keeps it). */
export function loadPendingSignup(now: number = Date.now()): PendingSignup | null {
  let raw = inMemory;
  try {
    raw = window.sessionStorage.getItem(KEY) ?? inMemory;
  } catch {
    /* storage refused: the in-memory copy */
  }
  return parsePendingSignup(raw, now);
}

/** Remember the sign-up for this tab (and in memory, for browsers that refuse storage). */
export function savePendingSignup(p: PendingSignup): void {
  inMemory = JSON.stringify(p);
  try {
    window.sessionStorage.setItem(KEY, inMemory);
  } catch {
    /* private mode without storage: the in-memory copy carries it to the code page */
  }
}

/** Forget the sign-up (confirmed, or the user starts over with another e-mail). */
export function clearPendingSignup(): void {
  inMemory = null;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** What was typed or pasted into the code box, as at most six digits: "123 456", "123-456" and Thai numerals (๑๒๓๔๕๖) all work. */
export function codeDigits(input: string): string {
  return [...input].map((ch) => { const i = THAI_DIGITS.indexOf(ch); return i >= 0 ? String(i) : ch; }).join('').replace(/\D/g, '').slice(0, CODE_LENGTH);
}

/**
 * The digit of a number key the browser will not type as a digit — the Thai keyboard layout puts ๅ / - ภ ถ ุ ึ ค ต จ on the
 * number row, so someone who forgot to switch language would type nothing useful. Null when the key already types a digit
 * (the browser handles it), is not a number key, or is part of a shortcut.
 */
export function digitOfKey(e: { key: string; code: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (/^\d$/.test(e.key)) return null;
  const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
  return m ? m[1] : null;
}

/** Whole seconds from `now` until `until` (ms), never negative. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/** 125 → "2:05" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
