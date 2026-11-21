'use client';

/** Save text (CSV) or bytes (an .xlsx template) as a file in the browser. */
export function downloadText(fileName: string, text: string | Uint8Array, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "ใบสั่งซื้อ" -> "ใบสั่งซื้อ-2026-10-02.csv" (characters Windows rejects in file names replaced). */
export function datedFileName(title: string, ext = 'csv') {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export'}-${day}.${ext}`;
}

/** Excel saves "CSV UTF-8" or, on Thai Windows, plain "CSV" in windows-874 (TIS-620): accept both. */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-874').decode(buf);
  }
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
