/**
 * Lock date (วันที่ปิดงวด) for a module's documents that reach the books (tax invoices, receipts, goods receipts, payments).
 * Documents dated on/before the lock date are refused with a Thai 409 unless the user holds `<module>.lock.override`
 * and gives a reason (the request — reason included — lands in the `_audit` log).
 *
 * The lock lives in the kernel table `_lock_date` (one row per tenant, RLS) in each module's own database, so every module
 * keeps its own copy. It moves forward automatically when Accounting closes a period (`accounting.period_closed` →
 * `lockThroughPeriod`) and steps back when that period is reopened (`accounting.period_reopened` → `unlockPeriod`),
 * or is set by hand (`setLockDate`, e.g. a module without Accounting).
 */
import { formatThaiDate } from '@erp/thai';
import { hasPerm, type AuthContext } from './auth.ts';
import { addDaysIso } from './clock.ts';
import { conflict } from './errors.ts';
import type { Client } from './db.ts';

export interface LockInfo {
  /** documents dated on/before this day are locked (YYYY-MM-DD); null = nothing locked */
  lockDate: string | null;
  lockDateTh: string | null;
  /** 'accounting' = moved by a closed accounting period, 'manual' = set by a user */
  source: 'accounting' | 'manual' | null;
  /** the accounting period (YYYY-MM) that set it, when source = accounting */
  period: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function info(r: any): LockInfo {
  const lockDate = r?.lock_date ? String(r.lock_date).slice(0, 10) : null;
  return {
    lockDate, lockDateTh: lockDate ? formatThaiDate(lockDate) : null, source: r?.source ?? null, period: r?.period ?? null,
    updatedAt: r?.updated_at ? new Date(r.updated_at).toISOString() : null, updatedByName: r?.updated_by_name ?? null,
  };
}

/** Current lock of this tenant (inside `db.tx`). */
export async function readLock(c: Client): Promise<LockInfo> {
  return info((await c.query(`select * from _lock_date`)).rows[0]);
}

/** Set (or clear with null) the lock date by hand. */
export async function setLockDate(c: Client, lockDate: string | null, byName: string | null): Promise<LockInfo> {
  const r = await c.query(
    `insert into _lock_date (lock_date, source, period, updated_at, updated_by_name) values ($1::date, 'manual', null, now(), $2)
     on conflict (tenant_id) do update set lock_date = excluded.lock_date, source = 'manual', period = null, updated_at = now(), updated_by_name = excluded.updated_by_name
     returning *`, [lockDate, byName]);
  return info(r.rows[0]);
}

/** Last day of a YYYY-MM period. */
export function periodLastDate(period: string): string {
  if (!MONTH.test(period)) throw new Error(`periodLastDate: expected YYYY-MM, got ${period}`);
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Accounting closed `period`: lock everything up to its last day — forward only (an older close never unlocks). */
export async function lockThroughPeriod(c: Client, period: string, byName: string | null = null): Promise<LockInfo> {
  const last = periodLastDate(period);
  const r = await c.query(
    `insert into _lock_date (lock_date, source, period, updated_at, updated_by_name) values ($1::date, 'accounting', $2, now(), $3)
     on conflict (tenant_id) do update set lock_date = excluded.lock_date, source = 'accounting', period = excluded.period, updated_at = now(), updated_by_name = excluded.updated_by_name
       where _lock_date.lock_date is null or _lock_date.lock_date < excluded.lock_date
     returning *`, [last, period, byName]);
  return r.rowCount ? info(r.rows[0]) : readLock(c);
}

/**
 * Accounting reopened `period`: when the lock came from Accounting and covers that period, step it back to the day before the
 * period starts. A lock set by hand is left alone.
 */
export async function unlockPeriod(c: Client, period: string, byName: string | null = null): Promise<LockInfo> {
  if (!MONTH.test(period)) throw new Error(`unlockPeriod: expected YYYY-MM, got ${period}`);
  const before = addDaysIso(`${period}-01`, -1);
  await c.query(
    `update _lock_date set lock_date = $1::date, period = to_char($1::date, 'YYYY-MM'), updated_at = now(), updated_by_name = $2
     where source = 'accounting' and lock_date > $1::date`, [before, byName]);
  return readLock(c);
}

/**
 * Refuse a document dated on/before the lock date (409, Thai). A user with `<module>.lock.override` passes by giving
 * `overrideReason` (≥ 3 characters); the result says whether the lock was overridden.
 */
export async function guardLockDate(
  c: Client, a: AuthContext,
  opts: { module: string; date: string; what: string; overrideReason?: string | null },
): Promise<{ overridden: boolean; lock: LockInfo }> {
  const lock = await readLock(c);
  if (!lock.lockDate || opts.date > lock.lockDate) return { overridden: false, lock };
  const base = `ลงวันที่${opts.what} ${formatThaiDate(opts.date)} ไม่ได้ — งวดถึงวันที่ ${lock.lockDateTh} ปิดแล้ว${lock.source === 'accounting' && lock.period ? ' (ฝ่ายบัญชีปิดงวด)' : ''}`;
  if (!hasPerm(a, `${opts.module}.lock.override`)) throw conflict(`${base} — ใช้วันที่หลังวันปิดงวด หรือให้ผู้มีสิทธิ์ข้ามการปิดงวดบันทึกพร้อมเหตุผล`);
  if ((opts.overrideReason ?? '').trim().length < 3) throw conflict(`${base} — ระบุเหตุผลที่ต้องบันทึกย้อนหลังเข้างวดที่ปิด (lockOverrideReason)`);
  return { overridden: true, lock };
}
