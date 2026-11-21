import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { duplicateValue, HttpError, parse, s, toErrorBody } from '../src/index.ts';

/** Validation errors a self-serve user can act on: Thai, and inside a list they name the row. */
const Po = z.object({
  supplierName: s.name,
  email: z.string().email().optional(),
  vatMode: z.enum(['exclusive', 'inclusive', 'none']),
  lines: z.array(s.itemLine).min(1),
});

const failure = (input: unknown): HttpError => {
  try { parse(Po, input); } catch (e) { return e as HttpError; }
  throw new Error('expected a validation error');
};

describe('validation errors in Thai', () => {
  it('names the row and column of a bad line, and says how many more problems there are', () => {
    const item = { itemId: '6f1c1d52-3d3a-4b8e-9b55-0b6a2b8f0e11', itemCode: 'RM-01' };
    const e = failure({ supplierName: 'Siam Steel', vatMode: 'exclusive', lines: [{ ...item, qty: 5 }, { ...item, qty: -3 }] });
    expect(e.status).toBe(400);
    expect(e.message).toBe('ข้อมูลไม่ถูกต้อง — lines › แถวที่ 2 › qty: ต้องมากกว่า 0');
    expect((e.details as any).fieldErrors).toEqual({ lines: ['แถวที่ 2 › qty: ต้องมากกว่า 0'] });
    expect((e.details as any).issues).toEqual([{ path: 'lines.1.qty', message: 'ต้องมากกว่า 0' }]);
  });

  it('translates the built-in checks (required, enum, e-mail, empty list)', () => {
    const e = failure({ email: 'nope', vatMode: 'x', lines: [] });
    const fe = (e.details as any).fieldErrors;
    expect(fe.supplierName).toEqual(['จำเป็นต้องกรอก']);
    expect(fe.email).toEqual(['อีเมลไม่ถูกต้อง']);
    expect(fe.vatMode).toEqual(['เลือกได้เฉพาะ: exclusive, inclusive, none']);
    expect(fe.lines).toEqual(['ต้องมีอย่างน้อย 1 รายการ']);
    expect(e.message).toMatch(/^ข้อมูลไม่ถูกต้อง — supplierName: จำเป็นต้องกรอก \(และอีก 3 จุด\)$/);
  });

  it('keeps messages a schema wrote itself', () => {
    expect(() => parse(z.object({ at: s.isoDate }), { at: '2026-02-31' })).toThrow('วันที่ไม่ถูกต้อง (ไม่มีวันนี้ในปฏิทิน)');
  });
});

describe('database and request errors in Thai', () => {
  it('a duplicate says which value, without the tenant id', () => {
    expect(duplicateValue('Key (tenant_id, code)=(6f1c1d52-3d3a-4b8e-9b55-0b6a2b8f0e11, RM-01) already exists.')).toBe('"RM-01"');
    expect(duplicateValue('something else')).toBeNull();
    const r = toErrorBody({ code: '23505', detail: 'Key (tenant_id, code)=(6f1c1d52-3d3a-4b8e-9b55-0b6a2b8f0e11, RM-01) already exists.' });
    expect(r.status).toBe(409);
    expect((r.body as any).error.message).toBe('"RM-01" มีอยู่ในระบบแล้ว — ใช้ค่าอื่น หรือแก้ไขรายการเดิม');
  });

  it('broken JSON from the client', () => {
    const r = toErrorBody({ statusCode: 400, code: 'FST_ERR_CTP_INVALID_JSON_BODY', message: "Body is not valid JSON but content-type is set to 'application/json'" });
    expect(r).toEqual({ status: 400, body: { error: { code: 'FST_ERR_CTP_INVALID_JSON_BODY', message: 'รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง (JSON เสีย)' } } });
  });
});
