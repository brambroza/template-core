import { describe, expect, it } from 'vitest';
import { HttpError, parse, s, z } from '../src/index.ts';

describe('s.isoDate (KRN-01)', () => {
  it('accepts real calendar days, including 29 Feb in a leap year', () => {
    for (const d of ['2026-10-02', '2024-02-29', '2000-02-29', '2026-12-31', '2026-01-01']) expect(s.isoDate.safeParse(d).success).toBe(true);
  });

  it('rejects impossible dates with a Thai message', () => {
    for (const d of ['2026-02-31', '2026-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32']) {
      const r = s.isoDate.safeParse(d);
      expect(r.success, d).toBe(false);
      if (!r.success) expect(r.error.issues.map((i) => i.message)).toEqual(['วันที่ไม่ถูกต้อง (ไม่มีวันนี้ในปฏิทิน)']);
    }
  });

  it('rejects a wrong format with one format message', () => {
    const r = s.isoDate.safeParse('2/10/2026');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message)).toEqual(['รูปแบบวันที่ต้องเป็น YYYY-MM-DD']);
  });

  it('rejects a Buddhist-era year with a Thai hint, accepts the Christian-era one', () => {
    const r = s.isoDate.safeParse('2569-11-20');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message)).toEqual(['ปี 2569 เป็น พ.ศ. — ระบบรับปี ค.ศ. (2026)']);
    expect(s.isoDate.safeParse('2026-11-20').success).toBe(true);
    expect(s.isoDate.safeParse('2399-12-31').success).toBe(true);
    expect(s.buddhistYearProblem('2026-01-01')).toBeNull();
  });

  it('turns into a 400 field error through parse(), also when optional / nullable', () => {
    const Body = z.object({ due: s.isoDate.nullable().optional(), at: s.isoDate });
    let err: unknown;
    try { parse(Body, { at: '2026-02-31', due: '2026-04-31' }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(HttpError);
    const h = err as HttpError;
    expect(h.status).toBe(400);
    expect((h.details as any).fieldErrors).toEqual({ at: ['วันที่ไม่ถูกต้อง (ไม่มีวันนี้ในปฏิทิน)'], due: ['วันที่ไม่ถูกต้อง (ไม่มีวันนี้ในปฏิทิน)'] });
    expect(parse(Body, { at: '2026-02-28', due: null })).toEqual({ at: '2026-02-28', due: null });
  });
});

describe('database errors', () => {
  it('turns a busy or unreachable database into 503, not a generic 500', async () => {
    const { toErrorBody } = await import('../src/errors.ts');
    expect(toErrorBody(Object.assign(new Error('sorry, too many clients already'), { code: '53300' })).status).toBe(503);
    expect(toErrorBody(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })).status).toBe(503);
    expect(toErrorBody(new Error('boom')).status).toBe(500);
  });
});
