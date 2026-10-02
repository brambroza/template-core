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

/** A calendar date "YYYY-MM-DD". Impossible dates are a 400 field error, never a database error. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD')
  .refine((v) => !/^\d{4}-\d{2}-\d{2}$/.test(v) || isCalendarDate(v), 'วันที่ไม่ถูกต้อง (ไม่มีวันนี้ในปฏิทิน)');

/** A line that points at an item owned by master-data (snapshot of code/name travels with it). */
export const itemLine = z.object({ itemId: uuid, itemCode: code, itemName: z.string().max(200).optional(), qty: positiveQty });
export const pricedItemLine = itemLine.extend({ unitPrice: money });

export const listQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
