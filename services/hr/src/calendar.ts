import type { Client } from '@erp/kernel';

/** Thai factories run on Asia/Bangkok (UTC+7, no daylight saving). All "today"/late maths use it. */
export const TZ = 'Asia/Bangkok';
const OFFSET_MS = 7 * 3600 * 1000;

/** 'YYYY-MM-DD' of an instant in Bangkok time. */
export const localDate = (d: Date = new Date()): string => new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
/** minutes since local midnight */
export const localMinutes = (d: Date): number => {
  const x = new Date(d.getTime() + OFFSET_MS);
  return x.getUTCHours() * 60 + x.getUTCMinutes();
};
export const hhmm = (d: Date): string => new Date(d.getTime() + OFFSET_MS).toISOString().slice(11, 16);
export const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
};

export const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const monthRange = (month: string): { from: string; to: string } => {
  const from = `${month}-01`;
  const next = new Date(`${from}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
};

export interface Schedule {
  start_time: string;
  end_time: string;
  grace_minutes: number;
  saturday_workday: boolean;
}

export const DEFAULT_SCHEDULE: Schedule = { start_time: '08:00', end_time: '17:00', grace_minutes: 0, saturday_workday: false };

export async function loadSchedule(c: Client): Promise<Schedule> {
  const r = await c.query(
    `select to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time, grace_minutes, saturday_workday from work_settings limit 1`);
  return r.rows[0] ?? DEFAULT_SCHEDULE;
}

export interface WorkCalendar {
  schedule: Schedule;
  holidays: Map<string, string>;
  isWorkday(date: string): boolean;
}

/** Schedule + holidays between two dates: decides which days count as working days. */
export async function loadCalendar(c: Client, from: string, to: string): Promise<WorkCalendar> {
  const schedule = await loadSchedule(c);
  const holidays = new Map<string, string>(
    (await c.query(`select to_char(holiday_date, 'YYYY-MM-DD') as d, name from holidays where holiday_date between $1 and $2`, [from, to])).rows.map((r) => [r.d, r.name]));
  return {
    schedule,
    holidays,
    isWorkday(date: string) {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (dow === 0) return false;
      if (dow === 6 && !schedule.saturday_workday) return false;
      return !holidays.has(date);
    },
  };
}
