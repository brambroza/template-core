import { now } from '@erp/kernel';
/** Bookings are entered and shown in Thai local time (Asia/Bangkok, UTC+7, no daylight saving). */
export const TZ = 'Asia/Bangkok';
export const OFFSET = '+07:00';
const OFFSET_MS = 7 * 3600 * 1000;

const shifted = (d: Date) => new Date(d.getTime() + OFFSET_MS).toISOString();
/** Bangkok day of an instant (default: now on the kernel business clock — tests freeze it with setClock). */
export const localDate = (d: Date = now()): string => shifted(d).slice(0, 10);
export const hhmm = (d: Date): string => shifted(d).slice(11, 16);
/** start of a local day as an instant */
export const dayStart = (date: string): Date => new Date(`${date}T00:00:00${OFFSET}`);
export const at = (date: string, time: string): Date => new Date(`${date}T${time}:00${OFFSET}`);

export const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Monday of the local week containing `date`. */
export const weekStart = (date: string): string => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
};

/** "2/10/2569 09:00–10:30 น." (Buddhist year), spelling out the end date when it differs. */
export function thaiRange(start: Date, end: Date): string {
  const d = (x: Date) => {
    const [y, m, dd] = localDate(x).split('-').map(Number);
    return `${dd}/${m}/${y + 543}`;
  };
  return localDate(start) === localDate(end)
    ? `${d(start)} ${hhmm(start)}–${hhmm(end)} น.`
    : `${d(start)} ${hhmm(start)} – ${d(end)} ${hhmm(end)} น.`;
}
