'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { formatValue, isNegative, isNumericFormat, statusTone, type Format } from '@erp/ui-schema';
import { useNumberFormat } from '@/lib/number-format';

function Qr({ payload }: { payload: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(payload, { margin: 1, width: 180 }).then(setSrc).catch(() => setSrc('')); }, [payload]);
  return src ? <img className="qr" src={src} alt="QR พร้อมเพย์สำหรับชำระเงิน" width={180} height={180} /> : null;
}

/** The current module's own status wording (ModuleUi.statusLabels), provided by the screen page. */
export const LabelsContext = createContext<Record<string, string> | undefined>(undefined);

/** Lists of codes (permissions, tags) as chips; in a table cell only the first `max`, the rest as "+n". */
function Chips({ items, max }: { items: string[]; max?: number }) {
  const shown = max && items.length > max + 1 ? items.slice(0, max) : items;
  return (
    <span className="chips" title={shown.length < items.length ? items.join(', ') : undefined}>
      {shown.map((x, i) => <span key={`${x}-${i}`} className={/^[\w.*:/-]+$/.test(x) ? 'chip chip-code' : 'chip'}>{x}</span>)}
      {shown.length < items.length && <span className="chip chip-more">+{items.length - shown.length}</span>}
    </span>
  );
}

export function Value({ value, format, max, cell }: { value: unknown; format?: Format; max?: number; cell?: boolean }) {
  const labels = useContext(LabelsContext);
  useNumberFormat(); // drawn again when the company changes its number format (formatValue reads it)
  // in a table column of yes/no, "ไม่ใช่" on every row is noise: a quiet dash, and a mark for yes
  if (cell && format === 'boolean' && value !== null && value !== undefined && value !== '') {
    return value ? <span className="bool-yes">✓ ใช่</span> : <span className="bool-no" aria-label="ไม่ใช่">–</span>;
  }
  if (format === 'status' && typeof value === 'string' && value) {
    return <span className={`status tone-${statusTone(value)}`}>{formatValue(value, 'status', labels)}</span>;
  }
  if (format === 'qr') return value ? <Qr payload={String(value)} /> : <>—</>;
  if (format === 'list' && Array.isArray(value) && value.length > 1) return <Chips items={value.map(String)} max={max} />;
  const text = formatValue(value, format, labels);
  if (isNumeric(format)) return <span className={`tabular nowrap${isNegative(value, format) ? ' neg' : ''}`}>{text}</span>;
  return <span className={keepTogether(text, format) ? 'nowrap' : undefined}>{text}</span>;
}

/**
 * Values that must not break across lines in a table: document numbers (PO-2569-0001), codes, phone numbers,
 * dates and short single words. Long text without spaces (Thai sentences) still wraps.
 */
export function keepTogether(text: string, format?: Format): boolean {
  if (format === 'date' || format === 'datetime' || format === 'month') return true;
  return text.length <= 16 || (text.length <= 24 && !/\s/.test(text));
}

/** A column whose values are long prose gets a minimum width so it does not collapse to one word per line. */
export function isWideColumn(rows: unknown[], get: (r: unknown) => unknown, format?: Format): boolean {
  if (format === 'list') return rows.some((r) => { const v = get(r); return Array.isArray(v) ? v.length > 3 : typeof v === 'string' && v.length > 36; });
  if (format && format !== 'text' && format !== 'label') return false;
  return rows.some((r) => { const v = get(r); return typeof v === 'string' && v.length > 36; });
}

export const isNumeric = (f?: Format) => isNumericFormat(f);
