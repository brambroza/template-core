/**
 * Business-hours SLA arithmetic (pure, no I/O).
 * "4 business hours" from Friday 23:04 with a Mon–Fri 08:00–17:00 calendar = Monday 12:00.
 */

export interface BusinessCalendar {
  /** IANA time zone the working hours are written in (Thailand: Asia/Bangkok) */
  timezone: string;
  /** ISO weekdays that are working days: 1 = Monday … 7 = Sunday */
  workDays: number[];
  /** "HH:MM" local start / end of the working day (end > start) */
  workStart: string;
  workEnd: string;
  /** local dates "YYYY-MM-DD" that are not working days */
  holidays: string[];
}

export const DEFAULT_CALENDAR: BusinessCalendar = { timezone: 'Asia/Bangkok', workDays: [1, 2, 3, 4, 5], workStart: '08:00', workEnd: '17:00', holidays: [] };

const DAY = 86_400_000;
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Offset (ms) of `timezone` from UTC at instant `t`. */
function tzOffset(timezone: string, t: number): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** UTC instant of local wall time `minuteOfDay` on the local day whose midnight-as-UTC is `dayUtc`. */
function localToUtc(timezone: string, dayUtc: number, minuteOfDay: number): number {
  const wall = dayUtc + minuteOfDay * 60_000;
  const guess = wall - tzOffset(timezone, wall);
  return wall - tzOffset(timezone, guess);
}

/** Local calendar day of instant `t` as UTC-midnight ms. */
function localDay(timezone: string, t: number): number {
  const local = t + tzOffset(timezone, t);
  return Math.floor(local / DAY) * DAY;
}

const isoDate = (dayUtc: number) => new Date(dayUtc).toISOString().slice(0, 10);
const isoWeekday = (dayUtc: number) => ((new Date(dayUtc).getUTCDay() + 6) % 7) + 1;

/** Add `seconds` of working time to `start` (instant), skipping nights, non-working days and holidays. */
export function addBusinessSeconds(start: Date, seconds: number, cal: BusinessCalendar = DEFAULT_CALENDAR): Date {
  const open = minutes(cal.workStart);
  const close = minutes(cal.workEnd);
  const days = new Set(cal.workDays);
  if (!(close > open) || days.size === 0) return new Date(start.getTime() + seconds * 1000); // no usable calendar: clock time
  const holidays = new Set(cal.holidays);
  let left = seconds * 1000;
  let day = localDay(cal.timezone, start.getTime());
  let cursor = start.getTime();
  for (let i = 0; i < 3660; i++, day += DAY) {
    if (!days.has(isoWeekday(day)) || holidays.has(isoDate(day))) continue;
    const from = Math.max(cursor, localToUtc(cal.timezone, day, open));
    const to = localToUtc(cal.timezone, day, close);
    if (from >= to) continue;
    if (left <= to - from) return new Date(from + left);
    left -= to - from;
    cursor = to;
  }
  return new Date(start.getTime() + seconds * 1000); // calendar without working time for 10 years: give up gracefully
}

