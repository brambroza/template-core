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
  return <span className={numeric ? 'tabular' : undefined}>{text}</span>;
}

export const isNumeric = (f?: Format) => f === 'money' || f === 'qty' || f === 'percent';
