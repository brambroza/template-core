'use client';

import { clearSession, loadSession } from './session';

export class ApiError extends Error {
  constructor(public status: number, message: string, public fieldErrors: Record<string, string[]> = {}) {
    super(message);
  }
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
  if (!res.ok) {
    if (res.status === 401 && session) {
      clearSession();
      window.location.href = '/login?expired=1';
    }
    const err = data?.error ?? {};
    const fieldErrors = err.details?.fieldErrors ?? {};
    // server messages are specific (e.g. "สต็อกไม่พอ: RM-STEEL …"); fall back to Thai generic text
    throw new ApiError(res.status, thaiMessage(res.status, err.message), fieldErrors);
  }
  return data as T;
}
