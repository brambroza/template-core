/** Pure date / money arithmetic for MA contracts (no database) — unit-tested in test/schedule.test.ts. */

export type BillingPlan = 'one_time' | 'monthly' | 'quarterly' | 'yearly';

export const PLAN_MONTHS: Record<Exclude<BillingPlan, 'one_time'>, number> = { monthly: 1, quarterly: 3, yearly: 12 };

const parts = (iso: string) => iso.split('-').map(Number) as [number, number, number];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

/** Today in Thailand as YYYY-MM-DD. */
export function todayBkk(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Calendar-month addition anchored on the day of month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${pad(ny, 4)}-${pad(nm)}-${pad(Math.min(d, daysInMonth(ny, nm)))}`;
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/**
 * Billing installments of a contract: one per billing period starting on `start` (each period start is an
 * invoice date) while the period starts on/before `end`. The value is split evenly in satang; the last
 * installment takes the rounding remainder so the installments always sum to the contract value.
 * Example: 1 Jan – 31 Dec monthly = 12 installments on the 1st of each month.
 */
export function billingSchedule(start: string, end: string, plan: BillingPlan, value: number): { seq: number; dueDate: string; amount: number }[] {
  const dates: string[] = [];
  if (plan === 'one_time') dates.push(start);
  else for (let i = 0; ; i++) {
    const d = addMonths(start, i * PLAN_MONTHS[plan]);
    if (d > end) break;
    dates.push(d);
  }
  const cents = Math.round(value * 100);
  const base = Math.floor(cents / dates.length);
  return dates.map((dueDate, i) => ({
    seq: i + 1,
    dueDate,
    amount: (i === dates.length - 1 ? cents - base * (dates.length - 1) : base) / 100,
  }));
}

/** PM due dates: `first`, then every `everyMonths` months, never after `end` nor after `until`. */
export function pmDueDates(first: string, everyMonths: number, end: string, until: string): string[] {
  if (everyMonths <= 0) return [];
  const last = end < until ? end : until;
  const out: string[] = [];
  for (let k = 0; ; k++) {
    const d = addMonths(first, k * everyMonths);
    if (d > last) break;
    out.push(d);
  }
  return out;
}

/**
 * Period of a renewal: starts the day after the old end and lasts as long as the old contract
 * (whole months when the old one was whole months, e.g. 1 Jan – 31 Dec → next 1 Jan – 31 Dec; otherwise the same number of days).
 */
export function renewalPeriod(oldStart: string, oldEnd: string): { startDate: string; endDate: string } {
  const startDate = addDays(oldEnd, 1);
  for (let m = 1; m <= 240; m++) {
    const e = addDays(addMonths(oldStart, m), -1);
    if (e === oldEnd) return { startDate, endDate: addDays(addMonths(startDate, m), -1) };
    if (e > oldEnd) break;
  }
  return { startDate, endDate: addDays(startDate, daysBetween(oldStart, oldEnd)) };
}
