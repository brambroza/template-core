/**
 * Straight-line monthly depreciation (pure functions, no database).
 *
 * Rules (also in CLAUDE.md):
 * - Depreciable amount = cost − salvage value, spread evenly over useful life × 12 months.
 * - The first period is the month of purchase (full month); the last period absorbs rounding so the total is exact.
 * - A month's depreciation is recognised at month end: "as of" a date includes every month whose last day is on/before it.
 * - A disposed asset depreciates up to and including its disposal month, then stops.
 * - method 'none' (land, artwork…) or a useful life of 0 never depreciates: book value = cost.
 */

export interface DepAsset {
  cost: number;
  salvage_value: number;
  useful_life_years: number;
  method: string;
  purchase_date: string;
  disposed_on?: string | null;
}

export interface Period {
  period: string;
  depreciation: number;
  accumulated: number;
  book_value: number;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** "2026-10-15" -> 2026*12 + 9 */
export const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
export const periodOf = (idx: number) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;

/** The last month fully recognised on `date`: the month itself on its last day, otherwise the month before. */
export function closedMonthIndex(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return monthIndex(date) - (d === lastDay ? 0 : 1);
}

export function monthlyAmount(a: DepAsset): number {
  if (a.method !== 'straight_line' || a.useful_life_years <= 0) return 0;
  return round2((a.cost - a.salvage_value) / (a.useful_life_years * 12));
}

/** Every depreciation period of the asset's life (cut at its disposal month). */
export function schedule(a: DepAsset): Period[] {
  if (a.method !== 'straight_line' || a.useful_life_years <= 0) return [];
  const monthly = monthlyAmount(a);
  const months = a.useful_life_years * 12;
  const depreciable = round2(a.cost - a.salvage_value);
  const start = monthIndex(a.purchase_date);
  const stop = a.disposed_on ? Math.min(start + months - 1, monthIndex(a.disposed_on)) : start + months - 1;
  const rows: Period[] = [];
  let acc = 0;
  for (let i = start; i <= stop; i++) {
    const dep = i === start + months - 1 ? round2(depreciable - acc) : monthly;
    acc = round2(acc + dep);
    rows.push({ period: periodOf(i), depreciation: dep, accumulated: acc, book_value: round2(a.cost - acc) });
  }
  return rows;
}

/** Accumulated depreciation through month index `idx` (inclusive). */
export function accumulatedThrough(a: DepAsset, idx: number, rows = schedule(a)): number {
  let acc = 0;
  for (const r of rows) if (monthIndex(`${r.period}-01`) <= idx) acc = r.accumulated;
  return acc;
}

/** Book value of the asset on `date` (cost before purchase; months recognised at month end). */
export function bookValueAt(a: DepAsset, date: string, rows = schedule(a)): { accumulated: number; book_value: number } {
  if (date < a.purchase_date) return { accumulated: 0, book_value: a.cost };
  const accumulated = accumulatedThrough(a, closedMonthIndex(date), rows);
  return { accumulated, book_value: round2(a.cost - accumulated) };
}

/** Depreciation expense of one month (YYYY-MM). */
export function depreciationIn(a: DepAsset, month: string, rows = schedule(a)): number {
  return rows.find((r) => r.period === month)?.depreciation ?? 0;
}
