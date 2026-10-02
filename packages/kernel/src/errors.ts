import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Permission denied') => new HttpError(403, 'forbidden', message);
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);

/** Parse untrusted input with a zod schema; throws a 400 with field errors. */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw badRequest('Validation failed', r.error.flatten());
  return r.data;
}

export function toErrorBody(err: unknown): { status: number; body: unknown } {
  if (err instanceof HttpError) return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details } } };
  if (err instanceof ZodError) return { status: 400, body: { error: { code: 'bad_request', message: 'Validation failed', details: err.flatten() } } };
  const pgErr = err as { code?: string; detail?: string; constraint?: string };
  if (pgErr?.code === '23505') return { status: 409, body: { error: { code: 'conflict', message: 'Duplicate value', details: pgErr.detail } } };
  if (pgErr?.code === '23503') return { status: 409, body: { error: { code: 'conflict', message: 'Referenced record is missing or still in use', details: pgErr.detail } } };
  if (pgErr?.code === '23514') return { status: 400, body: { error: { code: 'bad_request', message: 'Value not allowed', details: pgErr.constraint } } };
  // database busy/unavailable (too many connections, shutting down, can't connect): tell the client to retry
  if (pgErr?.code && ['53300', '57P01', '57P03', '08001', '08006', 'ECONNREFUSED'].includes(pgErr.code)) {
    return { status: 503, body: { error: { code: 'unavailable', message: 'ระบบฐานข้อมูลไม่ว่างชั่วคราว ลองใหม่อีกครั้ง', details: pgErr.code } } };
  }
  const e = err as { statusCode?: number; message?: string; code?: string };
  if (e?.statusCode && e.statusCode < 500) return { status: e.statusCode, body: { error: { code: e.code ?? 'bad_request', message: e.message } } };
  return { status: 500, body: { error: { code: 'internal', message: 'Internal error' } } };
}
