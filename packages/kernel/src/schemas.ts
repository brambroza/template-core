/** Reusable request schemas so every module validates the same way. */
import { z } from 'zod';

export const uuid = z.string().uuid();
export const code = z.string().trim().min(1).max(50);
export const name = z.string().trim().min(1).max(200);
export const positiveQty = z.number().finite().positive();
export const money = z.number().finite().min(0);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** A line that points at an item owned by master-data (snapshot of code/name travels with it). */
export const itemLine = z.object({ itemId: uuid, itemCode: code, itemName: z.string().max(200).optional(), qty: positiveQty });
export const pricedItemLine = itemLine.extend({ unitPrice: money });

export const listQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
