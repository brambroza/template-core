/**
 * Numbers as the company writes them: thousands comma, decimals of money and decimals of quantities.
 * The setting lives in the company profile (identity `GET /company`: `number_comma`, `money_decimals`, `qty_decimals`),
 * the apps load it once and put it here; `formatValue` (display) and the number inputs (typing) both read it.
 *
 * What a form keeps and what goes to the API is always a plain number ("1250.5") — commas are only on screen.
 * Pure and browser-safe, like the rest of this package.
 */

export interface NumberFormat {
  /** group thousands with a comma: 1,250 */
  comma: boolean;
  /** decimals of money (`money` / `accounting`), 0–4 */
  moneyDecimals: number;
  /** decimals of quantities (`qty`), 0–4 */
  qtyDecimals: number;
}

/** Thousands comma and 2 decimals: what every company starts with. */
export const DEFAULT_NUMBER_FORMAT: Readonly<NumberFormat> = Object.freeze({ comma: true, moneyDecimals: 2, qtyDecimals: 2 });

/** Money and quantities are stored as numeric(18,4): more decimals than this cannot be kept. */
export const NUMBER_DECIMALS_MAX = 4;

/** Decimals a plain number may carry (a field without `format` and without `step`). */
const PLAIN_DECIMALS_TYPED = 6;
/** Decimals a plain number is shown with at most (as `qty` was before the company setting existed). */
const PLAIN_DECIMALS_SHOWN = 4;

/** The part of the company profile that says how numbers are written. */
export interface NumberFormatSource {
  number_comma?: boolean | null;
  money_decimals?: number | string | null;
  qty_decimals?: number | string | null;
}

const decimalsOr = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= NUMBER_DECIMALS_MAX ? n : fallback;
};

/** The company's number format from its profile; anything missing or out of range falls back to the default. */
export function numberFormatOf(company: NumberFormatSource | null | undefined): NumberFormat {
  return {
    comma: typeof company?.number_comma === 'boolean' ? company.number_comma : DEFAULT_NUMBER_FORMAT.comma,
    moneyDecimals: decimalsOr(company?.money_decimals, DEFAULT_NUMBER_FORMAT.moneyDecimals),
    qtyDecimals: decimalsOr(company?.qty_decimals, DEFAULT_NUMBER_FORMAT.qtyDecimals),
  };
}

let current: NumberFormat = DEFAULT_NUMBER_FORMAT;
const listeners = new Set<() => void>();

/** The number format in use now. The same object until it changes (safe as a `useSyncExternalStore` snapshot). */
export function getNumberFormat(): NumberFormat {
  return current;
}

/**
 * Use this number format from now on (`null` = back to the default). Screens that subscribed are told when it changed.
 * Browser/phone only: one user, one company. Never call it on a server that renders for several companies.
 */
export function setNumberFormat(next: Partial<NumberFormat> | null | undefined): void {
  const nf: NumberFormat = {
    comma: typeof next?.comma === 'boolean' ? next.comma : DEFAULT_NUMBER_FORMAT.comma,
    moneyDecimals: decimalsOr(next?.moneyDecimals, DEFAULT_NUMBER_FORMAT.moneyDecimals),
    qtyDecimals: decimalsOr(next?.qtyDecimals, DEFAULT_NUMBER_FORMAT.qtyDecimals),
  };
  if (nf.comma === current.comma && nf.moneyDecimals === current.moneyDecimals && nf.qtyDecimals === current.qtyDecimals) return;
  current = nf;
  for (const tell of [...listeners]) tell();
}

/** Be told when the number format changes; returns the unsubscribe function. */
export function subscribeNumberFormat(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const formatters = new Map<string, Intl.NumberFormat>();

/** "1,250.50": between `min` and `max` decimals, grouped or not. A value that rounds to zero never shows a minus sign. */
function write(n: number, min: number, max: number, comma: boolean): string {
  const id = `${min}:${max}:${comma ? 1 : 0}`;
  let f = formatters.get(id);
  if (!f) {
    // en-US = Latin digits, "," thousands and "." decimals on every engine (browsers, Node, Hermes)
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: comma });
    formatters.set(id, f);
  }
  const text = f.format(n);
  return /^-[0.,]*$/.test(text) ? text.slice(1) : text;
}

/** What a number is: money and quantities follow the company's decimals; `number` is anything else (days, hours, a count, a rate). */
export type NumberKind = 'money' | 'qty' | 'number';

/**
 * A number as text: `money` and `qty` at exactly the company's decimals ("1,250.00"); `number` as it is,
 * up to 4 decimals and never padded ("5", "2.5"). The thousands comma follows the company setting.
 */
export function formatNumber(value: number, kind: NumberKind = 'number', nf: NumberFormat = current): string {
  if (kind === 'money') return write(value, nf.moneyDecimals, nf.moneyDecimals, nf.comma);
  if (kind === 'qty') return write(value, nf.qtyDecimals, nf.qtyDecimals, nf.comma);
  return write(value, 0, PLAIN_DECIMALS_SHOWN, nf.comma);
}

/** The parts of a field that decide how its number is typed (see `Field` in index.ts). */
export interface NumberFieldLike {
  format?: 'money' | 'qty';
  step?: number;
  comma?: boolean;
}

/** How a number field is typed and shown. */
export interface NumberSpec {
  /** most decimals that can be typed */
  decimals: number;
  /** decimals always shown once the field is left ("1,250.00"); 0 = nothing is padded */
  pad: number;
  /** money / quantity: shown rounded to exactly `decimals`; false = a plain number, shown as stored */
  fixed: boolean;
  /** group thousands */
  comma: boolean;
}

/** 0.01 -> 2, 0.5 -> 1, 0.25 -> 2, 1 -> 0, 0.000001 -> 6. */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return PLAIN_DECIMALS_TYPED;
  const frac = step.toFixed(8).replace(/0+$/, '').split('.')[1] ?? '';
  return frac.length;
}

/**
 * Typing rules of a number field: `format: 'money' | 'qty'` = the company's decimals, padded; otherwise as many decimals
 * as `step` allows (none = up to 6) and nothing padded. `comma: false` on the field (a year, a sequence number) wins over the company setting.
 */
export function numberSpec(field: NumberFieldLike, nf: NumberFormat = current): NumberSpec {
  const comma = field.comma === false ? false : nf.comma;
  if (field.format === 'money') return { decimals: nf.moneyDecimals, pad: nf.moneyDecimals, fixed: true, comma };
  if (field.format === 'qty') return { decimals: nf.qtyDecimals, pad: nf.qtyDecimals, fixed: true, comma };
  return { decimals: field.step !== undefined ? stepDecimals(field.step) : PLAIN_DECIMALS_TYPED, pad: 0, fixed: false, comma };
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/**
 * The text of a number field while it is being typed: only digits, one decimal point and a leading minus survive,
 * decimals beyond `spec.decimals` are dropped, and thousands are grouped as the digits come ("1234567.5" -> "1,234,567.5").
 * Thai digits are accepted. A pasted "฿1,250.50 บาท" becomes "1,250.50".
 */
export function typeNumber(text: string, spec: NumberSpec): string {
  const s = String(text ?? '').replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
  const negative = /^[^0-9.]*-/.test(s);
  const kept = s.replace(/[^0-9.]/g, '');
  const dot = kept.indexOf('.');
  let whole = (dot < 0 ? kept : kept.slice(0, dot)).replace(/^0+(?=\d)/, '');
  const frac = dot < 0 ? '' : kept.slice(dot + 1).replace(/\./g, '').slice(0, spec.decimals);
  const point = dot >= 0 && spec.decimals > 0;
  if (point && whole === '') whole = '0';
  if (spec.comma) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${whole}${point ? `.${frac}` : ''}`;
}

/**
 * Typed or shown text back to the plain number a form keeps: "1,250.50" -> "1250.50", "12." -> "12".
 * Nothing typed yet ("", "-", ".") -> "".
 */
export function plainNumber(text: unknown): string {
  const s = String(text ?? '').replace(/[,\s]/g, '').replace(/\.$/, '');
  return s === '-' ? '' : s;
}

/**
 * The text of a number field that is not being edited: grouped, and for money/quantities padded to the company's
 * decimals ("1250.5" -> "1,250.50"). A plain number shows what is stored (up to 6 decimals), never rounded to its step.
 */
export function showNumber(value: unknown, spec: NumberSpec): string {
  if (value === null || value === undefined || value === '') return '';
  const plain = plainNumber(value);
  const n = plain === '' ? NaN : Number(plain);
  if (!Number.isFinite(n)) return String(value);
  return spec.fixed ? write(n, spec.pad, spec.decimals, spec.comma) : write(n, 0, PLAIN_DECIMALS_TYPED, spec.comma);
}

/** Digits, the decimal point and the minus sign: the characters of a number that stay when it is regrouped. */
const SIGNIFICANT = /[0-9๐-๙.\-]/;

/**
 * Where the caret belongs after `typeNumber` regrouped the text: behind the same number of digits it was behind before
 * (commas come and go, so the raw index is useless). `before` is the text as the browser left it, `caret` the caret in it.
 */
export function caretAfterTyping(before: string, caret: number, after: string): number {
  let wanted = 0;
  for (let i = 0; i < Math.min(caret, before.length); i++) if (SIGNIFICANT.test(before[i])) wanted++;
  if (wanted === 0) return 0;
  let seen = 0;
  for (let i = 0; i < after.length; i++) {
    if (SIGNIFICANT.test(after[i]) && ++seen === wanted) return i + 1;
  }
  return after.length;
}
