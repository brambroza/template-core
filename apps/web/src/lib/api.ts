'use client';

import { applyCompanyNumberFormat } from './number-format';
import { SESSION_TOKEN_HEADER } from './proxy-headers';
import { clearSession, isRevokedError, loadSession, replaceSessionToken } from './session';
import { SHOWCASE_READ_ONLY } from './showcase';
import { toast } from './toast';

export class ApiError extends Error {
  constructor(public status: number, message: string, public fieldErrors: Record<string, string[]> = {}, public code?: string) {
    super(message);
  }
}

/** A write the public showcase refused (it never saves). The toast is already shown — callers just stop, without a red error. */
export function isShowcaseRefusal(e: unknown): boolean {
  return e instanceof ApiError && e.code === SHOWCASE_READ_ONLY;
}

const MESSAGES: Record<number, string> = {
  401: 'กรุณาเข้าสู่ระบบใหม่',
  403: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้',
  404: 'ไม่พบข้อมูล',
  409: 'ทำรายการนี้ไม่ได้ในสถานะปัจจุบัน',
};

/**
 * Kernel defaults are English ("Purchase order not found", "Missing permission: x", "Duplicate value") — users see Thai.
 * Module messages are already Thai and pass through unchanged.
 */
export function thaiMessage(status: number, message?: string): string {
  const m = (message ?? '').trim();
  if (!m || m === 'Validation failed') return MESSAGES[status] ?? 'ตรวจสอบข้อมูลที่กรอกอีกครั้ง';
  if (/[\u0E00-\u0E7F]/.test(m)) return m;
  if (/ not found$/i.test(m)) return MESSAGES[404];
  if (/^(Missing permission|Permission denied)/i.test(m)) return MESSAGES[403];
  if (m === 'Duplicate value') return 'ข้อมูลนี้มีอยู่แล้ว (ซ้ำกับรายการเดิม)';
  if (m.startsWith('Referenced record')) return 'ข้อมูลที่อ้างถึงไม่มีอยู่แล้ว หรือยังถูกใช้งานอยู่';
  if (m === 'Value not allowed') return 'ค่าที่กรอกไม่อยู่ในตัวเลือกที่ระบบรับ';
  if (m === 'Internal error' || status >= 500) return 'ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง';
  if (status === 401) return MESSAGES[401];
  return m;
}

/** Call a module through the gateway: api('purchasing', '/purchase-orders', …). */
export async function api<T = any>(module: string, path: string, opts: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '' && v !== false) qs.set(k, String(v));
  const session = loadSession();
  const res = await fetch(`/api/${module}${path}${qs.size ? `?${qs}` : ''}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(session ? { authorization: `Bearer ${session.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  // the server rotated the login token (password change revokes the old one): keep working with the new one
  const rotated = res.ok ? res.headers.get(SESSION_TOKEN_HEADER) : null;
  if (rotated) {
    replaceSessionToken(rotated);
    if (typeof data?.message === 'string') toast({ title: data.message, tone: 'ok' });
  }
  if (!res.ok) {
    if (res.status === 401 && session) {
      clearSession();
      window.location.href = isRevokedError(data?.error) ? '/login?revoked=1' : '/login?expired=1';
    }
    const err = data?.error ?? {};
    if (res.status === 403 && err.code === SHOWCASE_READ_ONLY) {
      toast({ title: 'โหมดตัวอย่าง — ไม่บันทึกข้อมูล', body: 'ลองกดดูได้ทุกปุ่ม ระบบจริงจะบันทึกให้ทันที ติดต่อทีม GO Along เพื่อทดลองระบบเต็ม', tone: 'info' });
      throw new ApiError(403, String(err.message ?? 'โหมดตัวอย่าง — ไม่บันทึกข้อมูล'), {}, SHOWCASE_READ_ONLY);
    }
    const fieldErrors = err.details?.fieldErrors ?? {};
    // server messages are specific (e.g. "สต็อกไม่พอ: RM-STEEL …"); fall back to Thai generic text
    throw new ApiError(res.status, thaiMessage(res.status, err.message), fieldErrors, err.code);
  }
  // the company profile carries the number format (comma, decimals): every read or save of it keeps the screens in step
  if (module === 'identity' && path === '/company') applyCompanyNumberFormat(data);
  return data as T;
}
