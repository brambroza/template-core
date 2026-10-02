import { formatDate, formatValue, type Format } from '@erp/ui-schema';

/**
 * Buddhist-era safety net for phones whose JS engine ignores the `-u-ca-buddhist` calendar in Intl (some Android/Hermes
 * builds print "3 ต.ค. 2026"): if the Gregorian year shows and the BE year does not, swap it in. Pure; no RN imports.
 */
export function ensureBuddhistYear(text: string, value: unknown): string {
  const raw = String(value ?? '');
  // plain dates/months by their text; timestamps by the phone's local year (that is what Intl printed)
  const m = /^(\d{4})-\d{2}(-\d{2})?$/.exec(raw);
  const year = m ? Number(m[1]) : new Date(raw).getFullYear();
  if (!Number.isFinite(year) || year < 1000) return text;
  const be = String(year + 543);
  return text.includes(be) ? text : text.replace(String(year), be);
}

/** formatDate with the BE guarantee. */
export function thaiDate(value: string, withTime = false): string {
  return ensureBuddhistYear(formatDate(value, withTime), value);
}

/** formatValue with the BE guarantee on date/datetime. */
export function displayValue(value: unknown, format?: Format, labels?: Record<string, string>): string {
  const out = formatValue(value, format, labels);
  return (format === 'date' || format === 'datetime') && value ? ensureBuddhistYear(out, value) : out;
}
