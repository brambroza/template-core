import { z, ZodError, ZodIssueCode, type ZodErrorMap, type ZodIssue, type ZodTypeAny } from 'zod';

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

const n = (v: unknown) => (typeof v === 'bigint' || typeof v === 'number' ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v));
const TYPE_TH: Record<string, string> = { string: 'ข้อความ', number: 'ตัวเลข', boolean: 'ใช่/ไม่ใช่', array: 'รายการ', object: 'ข้อมูล', date: 'วันที่' };

/**
 * Thai messages for zod's built-in checks (users see them under the field). Messages a schema sets itself are kept as written.
 * Installed for every module through the kernel (`z.setErrorMap`).
 */
export const thaiErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'จำเป็นต้องกรอก' };
      return { message: `ต้องเป็น${TYPE_TH[issue.expected] ?? ` ${issue.expected}`}` };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: Number(issue.minimum) <= 1 ? 'จำเป็นต้องกรอก' : `ต้องยาวอย่างน้อย ${n(issue.minimum)} ตัวอักษร` };
      if (issue.type === 'array') return { message: `ต้องมีอย่างน้อย ${n(issue.minimum)} รายการ` };
      if (issue.type === 'number' || issue.type === 'bigint') return { message: issue.inclusive ? `ต้องไม่น้อยกว่า ${n(issue.minimum)}` : `ต้องมากกว่า ${n(issue.minimum)}` };
      return { message: 'ค่าน้อยเกินไป' };
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `ยาวได้ไม่เกิน ${n(issue.maximum)} ตัวอักษร` };
      if (issue.type === 'array') return { message: `มีได้ไม่เกิน ${n(issue.maximum)} รายการ` };
      if (issue.type === 'number' || issue.type === 'bigint') return { message: issue.inclusive ? `ต้องไม่เกิน ${n(issue.maximum)}` : `ต้องน้อยกว่า ${n(issue.maximum)}` };
      return { message: 'ค่ามากเกินไป' };
    case ZodIssueCode.invalid_enum_value:
      return { message: `เลือกได้เฉพาะ: ${issue.options.map(String).join(', ')}` };
    case ZodIssueCode.invalid_literal:
      return { message: `ต้องเป็น ${String(issue.expected)}` };
    case ZodIssueCode.invalid_union:
    case ZodIssueCode.invalid_union_discriminator:
      return { message: 'ค่าไม่อยู่ในรูปแบบที่รองรับ' };
    case ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'อีเมลไม่ถูกต้อง' };
      if (issue.validation === 'uuid') return { message: 'รหัสอ้างอิงไม่ถูกต้อง' };
      if (issue.validation === 'url') return { message: 'ลิงก์ (URL) ไม่ถูกต้อง' };
      return { message: 'รูปแบบไม่ถูกต้อง' };
    case ZodIssueCode.not_finite:
      return { message: 'ต้องเป็นตัวเลข' };
    case ZodIssueCode.not_multiple_of:
      return { message: `ต้องเป็นผลคูณของ ${n(issue.multipleOf)}` };
    case ZodIssueCode.invalid_date:
      return { message: 'วันที่ไม่ถูกต้อง' };
    case ZodIssueCode.unrecognized_keys:
      return { message: `มีช่องที่ระบบไม่รู้จัก: ${issue.keys.join(', ')}` };
    default:
      return { message: ctx.defaultError };
  }
};
z.setErrorMap(thaiErrorMap);

/** "lines แถวที่ 2 › qty" for an issue inside an array, "" at the top level. */
function where(path: ZodIssue['path']): string {
  return path.map((p) => (typeof p === 'number' ? `แถวที่ ${p + 1}` : String(p))).join(' › ');
}

/**
 * Field errors keyed by top-level field (what the forms show under each input). Problems inside a list say which row and column,
 * e.g. lines: ["แถวที่ 2 › qty: ต้องมากกว่า 0"], so a long purchase order does not leave the user hunting.
 */
export function fieldErrorsOf(err: ZodError): { fieldErrors: Record<string, string[]>; formErrors: string[]; issues: Array<{ path: string; message: string }> } {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const i of err.issues) {
    if (!i.path.length) { formErrors.push(i.message); continue; }
    const [head, ...rest] = i.path;
    const text = rest.length ? `${where(rest)}: ${i.message}` : i.message;
    (fieldErrors[String(head)] ??= []).push(text);
  }
  return { fieldErrors, formErrors, issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
}

/** Thai one-line summary of a validation failure: the first problem, and how many more. */
export function validationMessage(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return 'ข้อมูลไม่ถูกต้อง';
  const at = where(first.path);
  const more = err.issues.length > 1 ? ` (และอีก ${err.issues.length - 1} จุด)` : '';
  return `ข้อมูลไม่ถูกต้อง — ${at ? `${at}: ` : ''}${first.message}${more}`;
}

/** Parse untrusted input with a zod schema; throws a 400 with field errors (Thai, with row numbers inside lists). */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw badRequest(validationMessage(r.error), fieldErrorsOf(r.error));
  return r.data;
}

/** "Key (tenant_id, code)=(…, RM-01) already exists." → `"RM-01"`; null when the detail has another shape. */
export function duplicateValue(detail?: string): string | null {
  const m = /^Key \((.+)\)=\((.+)\) already exists/.exec(detail ?? '');
  if (!m) return null;
  const cols = m[1].split(',').map((x) => x.trim());
  const vals = m[2].split(',').map((x) => x.trim());
  const shown = vals.filter((_, i) => cols[i] !== 'tenant_id' && !/^[0-9a-f-]{36}$/i.test(vals[i] ?? ''));
  return shown.length ? shown.map((v) => `"${v}"`).join(', ') : null;
}

/** Fastify's own request errors in Thai. */
const FASTIFY_TH: Record<string, string> = {
  FST_ERR_CTP_INVALID_JSON_BODY: 'รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง (JSON เสีย)',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'ไม่มีข้อมูลที่ส่งมา',
  FST_ERR_CTP_BODY_TOO_LARGE: 'ข้อมูลหรือไฟล์ที่ส่งมาใหญ่เกินไป',
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'ชนิดข้อมูลที่ส่งมาไม่รองรับ',
};

export function toErrorBody(err: unknown): { status: number; body: unknown } {
  if (err instanceof HttpError) return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details } } };
  if (err instanceof ZodError) return { status: 400, body: { error: { code: 'bad_request', message: validationMessage(err), details: fieldErrorsOf(err) } } };
  const pgErr = err as { code?: string; detail?: string; constraint?: string };
  if (pgErr?.code === '23505') {
    const dup = duplicateValue(pgErr.detail);
    return { status: 409, body: { error: { code: 'conflict', message: dup ? `${dup} มีอยู่ในระบบแล้ว — ใช้ค่าอื่น หรือแก้ไขรายการเดิม` : 'ข้อมูลนี้มีอยู่ในระบบแล้ว (ซ้ำ)', details: pgErr.detail } } };
  }
  if (pgErr?.code === '23503') return { status: 409, body: { error: { code: 'conflict', message: 'ข้อมูลที่อ้างถึงไม่มีอยู่ หรือยังถูกใช้งานโดยเอกสารอื่น', details: pgErr.detail } } };
  if (pgErr?.code === '23514') return { status: 400, body: { error: { code: 'bad_request', message: 'ค่านี้ไม่อยู่ในเงื่อนไขที่ระบบยอมรับ', details: pgErr.constraint } } };
  // database busy/unavailable (too many connections, shutting down, can't connect): tell the client to retry
  if (pgErr?.code && ['53300', '57P01', '57P03', '08001', '08006', 'ECONNREFUSED'].includes(pgErr.code)) {
    return { status: 503, body: { error: { code: 'unavailable', message: 'ระบบฐานข้อมูลไม่ว่างชั่วคราว ลองใหม่อีกครั้ง', details: pgErr.code } } };
  }
  const e = err as { statusCode?: number; message?: string; code?: string };
  if (e?.statusCode && e.statusCode < 500) return { status: e.statusCode, body: { error: { code: e.code ?? 'bad_request', message: (e.code && FASTIFY_TH[e.code]) || e.message } } };
  return { status: 500, body: { error: { code: 'internal', message: 'Internal error' } } };
}
