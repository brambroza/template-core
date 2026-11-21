/** Reusable request schemas so every module validates the same way. */
import { z } from 'zod';

export const uuid = z.string().uuid();
export const code = z.string().trim().min(1).max(50);
export const name = z.string().trim().min(1).max(200);
export const positiveQty = z.number().finite().positive();
export const money = z.number().finite().min(0);
/** True when "YYYY-MM-DD" names a real calendar day (rejects 2026-02-31, 2026-13-01, 2025-02-29). */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1 || mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/**
 * Years from here on are Buddhist-era (พ.ศ.) typed into a Christian-era field: 2400 BE = 1857 CE, and no business date is that
 * far ahead. Without this check "2569-11-20" would be saved as the year 2569 and the document numbers would read PO-3112-….
 */
export const FIRST_BE_YEAR = 2400;

/** Thai 400 message when `value` looks like a Buddhist-era date (year ≥ FIRST_BE_YEAR), else null. */
export function buddhistYearProblem(value: string): string | null {
  const y = Number(/^(\d{4})-/.exec(value)?.[1]);
  return y >= FIRST_BE_YEAR ? `ปี ${y} เป็น พ.ศ. — ระบบรับปี ค.ศ. (${y - 543})` : null;
}

/**
 * A calendar date "YYYY-MM-DD" in the Christian era. Impossible dates and Buddhist-era years are a 400 field error,
 * never a database error or a date 543 years ahead.
 */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD')
  .refine((v) => !/^\d{4}-\d{2}-\d{2}$/.test(v) || isCalendarDate(v), 'วันที่ไม่ถูกต้อง (ไม่มีวันนี้ในปฏิทิน)')
  .superRefine((v, ctx) => {
    const problem = buddhistYearProblem(v);
    if (problem && isCalendarDate(v)) ctx.addIssue({ code: 'custom', message: problem });
  });

/** A line that points at an item owned by master-data (snapshot of code/name travels with it). */
export const itemLine = z.object({ itemId: uuid, itemCode: code, itemName: z.string().max(200).optional(), qty: positiveQty });
export const pricedItemLine = itemLine.extend({ unitPrice: money });

export const listQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
