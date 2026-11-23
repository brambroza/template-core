/**
 * Page arithmetic for the list screens (ListView pages the rows it already loaded; the APIs cap a list at a few hundred rows).
 * Pure functions so they can be tested without a browser.
 */

/** The choices in "แถวต่อหน้า". */
export const PAGE_SIZES = [10, 20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

/**
 * A page size the picker offers; anything else (an old or tampered preference) falls back to the default.
 * @param value the stored or chosen size
 */
export function validPageSize(value: unknown): number {
  return typeof value === 'number' && (PAGE_SIZES as readonly number[]).includes(value) ? value : DEFAULT_PAGE_SIZE;
}

/**
 * How many pages `total` rows fill; an empty list still has page 1.
 * @param total number of rows
 * @param size rows per page (>= 1)
 */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, size)));
}

/**
 * Keep a page number inside 1..pageCount (rows can shrink after a filter or an action on a row).
 * @param page the wanted page, 1-based
 * @param total number of rows
 * @param size rows per page
 */
export function clampPage(page: number, total: number, size: number): number {
  const last = pageCount(total, size);
  return Number.isFinite(page) ? Math.min(last, Math.max(1, Math.trunc(page))) : 1;
}

/**
 * The 1-based first and last row shown on a page, for "แสดง 21–40 จาก 135 รายการ". Both are 0 for an empty list.
 * @param page current page, 1-based
 * @param total number of rows
 * @param size rows per page
 */
export function pageRange(page: number, total: number, size: number): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const p = clampPage(page, total, size);
  return { from: (p - 1) * size + 1, to: Math.min(total, p * size) };
}

/**
 * The page buttons to draw: always the first and last page, the current page with one neighbour each side,
 * and 'gap' where pages are skipped. A gap that would hide a single page shows that page instead.
 * e.g. page 6 of 12 -> [1, 'gap', 5, 6, 7, 'gap', 12]
 * @param page current page, 1-based
 * @param count number of pages
 */
export function pageItems(page: number, count: number): (number | 'gap')[] {
  const keep = new Set([1, count, page - 1, page, page + 1].filter((p) => p >= 1 && p <= count));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  for (const p of sorted) {
    const prev = out.length ? out[out.length - 1] : undefined;
    if (typeof prev === 'number' && p - prev === 2) out.push(prev + 1);
    else if (typeof prev === 'number' && p - prev > 2) out.push('gap');
    out.push(p);
  }
  return out;
}
