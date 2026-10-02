/**
 * Pure helpers for attaching files from the phone (no React Native imports, so they are unit-tested in apps/mobile/test).
 * The server re-checks size, extension AND content; these only give the user a quick Thai answer before a 5 MB upload.
 */
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, formatBytes } from '@erp/ui-schema';

export const ALLOWED_EXT: ReadonlySet<string> = new Set(ATTACHMENT_ACCEPT.split(',').map((x) => x.slice(1)));

/** MIME types offered by the document picker ("แนบไฟล์"): PDF, Excel, Word, CSV, text (+ images, for files saved from LINE etc.). */
export const DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'text/comma-separated-values',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/csv': 'csv',
  'text/comma-separated-values': 'csv',
  'text/plain': 'txt',
};

export function extOf(name: string | null | undefined): string {
  const base = (name ?? '').split(/[?#]/)[0].split('/').pop() ?? '';
  return base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toLowerCase() : '';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "รูป-20261003-142501" — readable default name for a camera shot (the camera gives none). */
export function photoBaseName(now = new Date(), prefix = 'รูป'): string {
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Name to upload a photo under. The picker re-encodes (quality < 1), so the REAL format is the one of the output file
 * (`uri` extension / mimeType), not of the original name — e.g. iOS "IMG_0001.HEIC" comes back as JPEG and must be sent as
 * ".jpg" or the server rejects it ("เนื้อไฟล์ไม่ตรงกับนามสกุล").
 */
export function photoFileName(asset: { uri: string; fileName?: string | null; mimeType?: string | null }, now = new Date()): string {
  const real = [extOf(asset.uri), MIME_EXT[asset.mimeType ?? ''] ?? ''].find((e) => ALLOWED_EXT.has(e)) ?? 'jpg';
  const original = asset.fileName?.trim();
  const base = original ? (original.includes('.') ? original.slice(0, original.lastIndexOf('.')) : original) : photoBaseName(now);
  return `${base || photoBaseName(now)}.${real === 'jpeg' ? 'jpg' : real}`;
}

/** Name to upload a picked document under: keep the user's name, add the extension from the MIME type when it has none. */
export function documentFileName(asset: { name?: string | null; uri: string; mimeType?: string | null }): string {
  const name = (asset.name ?? '').trim() || (asset.uri.split('/').pop() ?? 'ไฟล์');
  if (ALLOWED_EXT.has(extOf(name))) return name;
  const fromMime = MIME_EXT[asset.mimeType ?? ''];
  return fromMime ? `${name}.${fromMime}` : name;
}

/** Thai reason the file cannot be sent, or null. `size` undefined = unknown (the server still checks). */
export function precheckUpload(name: string, size: number | null | undefined, max = ATTACHMENT_MAX_BYTES): string | null {
  const ext = extOf(name);
  if (!ALLOWED_EXT.has(ext)) return `${name}: ไม่รองรับไฟล์ประเภทนี้ (รองรับ ${[...ALLOWED_EXT].join(', ')})`;
  if (size !== null && size !== undefined) {
    if (size > max) return `${name}: ใหญ่เกิน ${formatBytes(max)} (${formatBytes(size)})`;
    if (size === 0) return `${name}: ไฟล์ว่างเปล่า`;
  }
  return null;
}

/** Decoded size of a base64 string (exact check after reading, when the picker did not report a size). */
export function base64Bytes(b64: string): number {
  const s = b64.replace(/\s+/g, '');
  return Math.floor((s.length / 4) * 3) - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
}
