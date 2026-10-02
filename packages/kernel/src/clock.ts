/**
 * Business clock. Thai documents are dated in Asia/Bangkok (UTC+7, no daylight saving) — the database runs in UTC,
 * so `current_date` there is *yesterday* between 00:00 and 07:00 Thai time. Services compute business dates here and
 * pass them to SQL explicitly.
 *
 * Tests can freeze time: `setClock('2026-10-02T19:00:00Z')` (02:00 on 3 Oct in Bangkok) or the env var
 * `ERP_CLOCK=2026-10-02T19:00:00Z` (read on every call). `setClock(null)` restores the real clock.
 */

const BANGKOK_OFFSET_MS = 7 * 3600_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

let override: (() => Date) | null = null;

/** Freeze (Date / ISO string) or drive (function) the business clock — tests only. `null` restores the real clock. */
export function setClock(c: Date | string | (() => Date) | null): void {
  if (c === null) override = null;
  else if (typeof c === 'function') override = c;
  else {
    const d = new Date(c);
    if (Number.isNaN(d.getTime())) throw new Error(`setClock: invalid time ${String(c)}`);
    override = () => new Date(d.getTime());
  }
}

/** Current instant: the test override, else `ERP_CLOCK`, else the system clock. */
export function now(): Date {
  if (override) return override();
  const env = process.env.ERP_CLOCK;
  if (env) {
    const d = new Date(env);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** The Bangkok calendar day of an instant as YYYY-MM-DD. */
export function thaiDate(d: Date): string {
  return new Date(d.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today in Thailand (Asia/Bangkok) as YYYY-MM-DD — use for every default document / business date. */
export function thaiToday(): string {
  return thaiDate(now());
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDaysIso(day: string, n: number): string {
  if (!DAY.test(day)) throw new Error(`addDaysIso: expected YYYY-MM-DD, got ${day}`);
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
