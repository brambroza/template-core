import { getSession } from './session';

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

/** Call a module through the gateway. `baseUrl` overrides the session's gateway (used by login). */
export async function api<T = any>(module: string, path: string, opts: { method?: string; body?: unknown; query?: Record<string, unknown>; baseUrl?: string } = {}): Promise<T> {
  const session = getSession();
  const base = (opts.baseUrl ?? session?.gatewayUrl ?? '').replace(/\/$/, '');
  const qs = Object.entries(opts.query ?? {})
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== false)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  let res: Response;
  try {
    res = await fetch(`${base}/api/${module}${path}${qs ? `?${qs}` : ''}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(session ? { authorization: `Bearer ${session.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตหรือที่อยู่เซิร์ฟเวอร์');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.message && err.message !== 'Validation failed' ? err.message : MESSAGES[res.status] ?? 'ตรวจสอบข้อมูลที่กรอกอีกครั้ง', err.details?.fieldErrors ?? {});
  }
  return data as T;
}
