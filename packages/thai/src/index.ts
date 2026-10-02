/**
 * Thai pack — localisation helpers every module may use.
 * Pure functions only (no I/O) so they are safe to call anywhere and easy to test.
 */

/** Round half-up to `dp` decimals (money default 2). Avoids 1.005 -> 1.00 float issues. */
export function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  // toPrecision(15) removes binary noise (100.005 * 100 = 10000.499999999998) before rounding
  const scaled = Number((Math.abs(value) * f).toPrecision(15));
  return (Math.sign(value) * Math.round(scaled)) / f || 0;
}

export const VAT_RATE = 0.07;

export interface VatResult {
  /** amount before VAT */
  net: number;
  vat: number;
  /** amount including VAT */
  gross: number;
}

/**
 * Calculate VAT.
 * - `exclusive`: `amount` is before VAT (most B2B quotations)
 * - `inclusive`: `amount` already contains VAT (retail prices)
 */
export function calcVat(amount: number, mode: 'exclusive' | 'inclusive' = 'exclusive', rate = VAT_RATE): VatResult {
  if (mode === 'exclusive') {
    const net = round(amount);
    const vat = round(net * rate);
    return { net, vat, gross: round(net + vat) };
  }
  const gross = round(amount);
  const net = round(gross / (1 + rate));
  return { net, vat: round(gross - net), gross };
}

/** Christian year -> Buddhist Era year (2026 -> 2569). */
export function toBuddhistYear(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.getUTCFullYear() + 543;
}

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** Format a date the Thai way: "2 ตุลาคม 2569" or short "2 ต.ค. 69". Uses the UTC calendar day of an ISO date. */
export function formatThaiDate(date: Date | string, style: 'long' | 'short' = 'long'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = d.getUTCDate();
  const m = d.getUTCMonth();
  const y = toBuddhistYear(d);
  return style === 'long' ? `${day} ${TH_MONTHS[m]} ${y}` : `${day} ${TH_MONTHS_SHORT[m]} ${String(y).slice(-2)}`;
}

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const POSITIONS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

function readBelowMillion(n: number, hasHigher = false): string {
  // n: 0..999999
  const s = String(n);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const digit = Number(s[i]);
    const pos = s.length - i - 1;
    if (digit === 0) continue;
    if (pos === 0 && digit === 1 && (s.length > 1 || hasHigher)) out += 'เอ็ด';
    else if (pos === 1 && digit === 2) out += 'ยี่';
    else if (pos === 1 && digit === 1) out += '';
    else out += DIGITS[digit];
    out += POSITIONS[pos];
  }
  return out;
}

function readInteger(n: number): string {
  if (n === 0) return DIGITS[0];
  let out = '';
  const millions = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;
  if (millions > 0) out += readInteger(millions) + 'ล้าน';
  if (rest > 0) out += readBelowMillion(rest, millions > 0);
  return out;
}

/** Amount in Thai words as printed on tax invoices: 1234.5 -> "หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์". */
export function bahtText(amount: number): string {
  if (!Number.isFinite(amount)) throw new Error('amount must be finite');
  const negative = amount < 0;
  const satangTotal = Math.round(Math.abs(amount) * 100);
  const baht = Math.floor(satangTotal / 100);
  const satang = satangTotal % 100;
  let out = '';
  if (baht > 0 || satang === 0) out += readInteger(baht) + 'บาท';
  out += satang === 0 ? 'ถ้วน' : readInteger(satang) + 'สตางค์';
  return (negative ? 'ลบ' : '') + out;
}

/** Validate a 13-digit Thai tax ID / national ID (mod-11 checksum). */
export function isValidThaiTaxId(id: string): boolean {
  const digits = id.replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(digits[12]);
}

function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(input, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/**
 * PromptPay QR payload (EMVCo). Render the returned string with any QR library.
 * @param target mobile number (0812345678) or 13-digit tax/national ID
 * @param amount optional fixed amount in THB
 */
export function promptPayPayload(target: string, amount?: number): string {
  const clean = target.replace(/[^0-9]/g, '');
  let account: string;
  if (clean.length === 10 && clean.startsWith('0')) account = tlv('01', ('0000000000000' + '66' + clean.slice(1)).slice(-13));
  else if (clean.length === 13) account = tlv('02', clean);
  else throw new Error('PromptPay target must be a 10-digit mobile or 13-digit ID');
  const merchant = tlv('29', tlv('00', 'A000000677010111') + account);
  let payload = tlv('00', '01') + tlv('01', amount ? '12' : '11') + merchant + tlv('53', '764') + tlv('58', 'TH');
  if (amount) payload += tlv('54', amount.toFixed(2));
  payload += '6304';
  return payload + crc16ccitt(payload);
}

/** Totals of a priced document (quotation, PO, SO, invoice). Line amounts are rounded per line, as Thai invoices print them. */
export function documentTotals(lines: { qty: number; unitPrice: number }[], mode: 'exclusive' | 'inclusive' = 'exclusive', rate = VAT_RATE) {
  const amounts = lines.map((l) => round(l.qty * l.unitPrice));
  const sum = round(amounts.reduce((a, b) => a + b, 0));
  return { amounts, ...calcVat(sum, mode, rate) };
}
