import { beforeEach, describe, expect, it } from 'vitest';
import { SESSION_TOKEN_HEADER, responseHeaders } from '../src/lib/proxy-headers.ts';
import { isRevokedError, loadSession, loginNotice, loginReasonFrom, logout, replaceSessionToken, saveSession, type Session } from '../src/lib/session.ts';

/** Web side of token revocation (security review 0.3, SEC-07). */
const store = new Map<string, string>();
(globalThis as any).window = {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
};
const session: Session = { token: 'old', tenant: { id: 't', code: 'acme', name: 'Acme' }, user: { id: 'u', email: 'a@x.co', name: 'A' }, permissions: [] };

beforeEach(() => store.clear());

describe('session', () => {
  it('logout calls identity /logout with the token, then clears the local session', async () => {
    saveSession(session);
    const calls: [string, RequestInit | undefined][] = [];
    const ok = await logout((async (url: string, init?: RequestInit) => { calls.push([url, init]); return new Response('{}', { status: 200 }); }) as typeof fetch);
    expect(ok).toBe(true);
    expect(calls[0][0]).toBe('/api/identity/logout');
    expect(calls[0][1]?.method).toBe('POST');
    expect((calls[0][1]?.headers as Record<string, string>).authorization).toBe('Bearer old');
    expect(loadSession()).toBeNull();
  });

  it('logout still clears the session when the server cannot be reached or refuses', async () => {
    saveSession(session);
    expect(await logout((async () => { throw new Error('offline'); }) as typeof fetch)).toBe(false);
    expect(loadSession()).toBeNull();
    saveSession(session);
    expect(await logout((async () => new Response('{}', { status: 401 })) as typeof fetch)).toBe(false);
    expect(loadSession()).toBeNull();
  });

  it('replaces the stored token after a password change', () => {
    saveSession(session);
    replaceSessionToken('new');
    expect(loadSession()?.token).toBe('new');
    expect(loadSession()?.user.name).toBe('A');
  });

  it('recognises a revoked-token 401 and explains it on the login page', () => {
    expect(isRevokedError({ code: 'session_revoked', message: 'x' })).toBe(true);
    expect(isRevokedError({ code: 'unauthorized', message: 'เซสชันถูกยกเลิก กรุณาเข้าสู่ระบบใหม่' })).toBe(true);
    expect(isRevokedError({ code: 'unauthorized', message: 'Token expired' })).toBe(false);
    expect(isRevokedError(undefined)).toBe(false);
    expect(loginReasonFrom('?revoked=1')).toBe('revoked');
    expect(loginReasonFrom('?expired=1')).toBe('expired');
    expect(loginReasonFrom('?logout=1')).toBe('logout');
    expect(loginReasonFrom('')).toBeNull();
    expect(loginNotice('revoked')).toContain('เซสชันถูกยกเลิก');
    expect(loginNotice('expired')).toBe('หมดเวลาการใช้งาน เข้าสู่ระบบอีกครั้ง');
    expect(loginNotice(null)).toBeNull();
  });

  it('the /api proxy passes the rotated session token through', () => {
    expect(responseHeaders(new Headers({ [SESSION_TOKEN_HEADER]: 'abc' })).get(SESSION_TOKEN_HEADER)).toBe('abc');
  });
});
