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

/** Replace the stored token (after a password change the old one is revoked and the server returns a new one). */
export function replaceSessionToken(token: string): void {
  const s = loadSession();
  if (s && token && s.token !== token) saveSession({ ...s, token });
}

/** Why the login page was opened: `?expired=1` (token expired / invalid) or `?revoked=1` (logged out elsewhere, password changed, disabled…). */
export type LoginReason = 'expired' | 'revoked' | 'logout' | null;

export function loginNotice(reason: LoginReason): string | null {
  if (reason === 'revoked') return 'เซสชันถูกยกเลิก (ออกจากระบบจากอุปกรณ์อื่น เปลี่ยนรหัสผ่าน หรือผู้ดูแลปรับสิทธิ์) กรุณาเข้าสู่ระบบใหม่';
  if (reason === 'expired') return 'หมดเวลาการใช้งาน เข้าสู่ระบบอีกครั้ง';
  if (reason === 'logout') return 'ออกจากระบบทุกอุปกรณ์แล้ว';
  return null;
}

export function loginReasonFrom(search: string): LoginReason {
  const q = new URLSearchParams(search);
  return q.has('revoked') ? 'revoked' : q.has('expired') ? 'expired' : q.has('logout') ? 'logout' : null;
}

/** A 401 the kernel answers for a revoked token (error code `session_revoked`, Thai message "เซสชันถูกยกเลิก…"). */
export function isRevokedError(err: { code?: string; message?: string } | undefined): boolean {
  return err?.code === 'session_revoked' || /เซสชันถูกยกเลิก/.test(err?.message ?? '');
}

/**
 * Log out everywhere: ask identity to revoke every token of this user (so a copied token stops working too), then forget the
 * local session. The local session is cleared even if the server cannot be reached.
 */
export async function logout(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const s = loadSession();
  let revoked = false;
  if (s) {
    try {
      const res = await fetchImpl('/api/identity/logout', { method: 'POST', headers: { authorization: `Bearer ${s.token}` }, cache: 'no-store' });
      revoked = res.ok;
    } catch { /* offline: the token still expires on its own */ }
  }
  clearSession();
  return revoked;
}
