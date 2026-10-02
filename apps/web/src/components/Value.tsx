'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { formatValue, statusTone, type Format } from '@erp/ui-schema';

function Qr({ payload }: { payload: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(payload, { margin: 1, width: 180 }).then(setSrc).catch(() => setSrc('')); }, [payload]);
  return src ? <img className="qr" src={src} alt="QR พร้อมเพย์สำหรับชำระเงิน" width={180} height={180} /> : null;
}

/** The current module's own status wording (ModuleUi.statusLabels), provided by the screen page. */
export const LabelsContext = createContext<Record<string, string> | undefined>(undefined);

export function Value({ value, format }: { value: unknown; format?: Format }) {
  const labels = useContext(LabelsContext);
  if (format === 'status' && typeof value === 'string' && value) {
    return <span className={`status tone-${statusTone(value)}`}>{formatValue(value, 'status', labels)}</span>;
  }
  if (format === 'qr') return value ? <Qr payload={String(value)} /> : <>—</>;
  const text = formatValue(value, format, labels);
  const numeric = format === 'money' || format === 'qty' || format === 'percent';
  return <span className={numeric ? 'tabular nowrap' : keepTogether(text, format) ? 'nowrap' : undefined}>{text}</span>;
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
  if (format && format !== 'text' && format !== 'label') return false;
  return rows.some((r) => { const v = get(r); return typeof v === 'string' && v.length > 36; });
}

export const isNumeric = (f?: Format) => f === 'money' || f === 'qty' || f === 'percent';
