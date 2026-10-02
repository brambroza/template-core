import { describe, expect, it } from 'vitest';
import { base64Bytes, documentFileName, extOf, photoFileName, precheckUpload } from '../src/lib/upload';
import { ensureBuddhistYear } from '../src/lib/dates';

const at = new Date(2026, 9, 3, 14, 25, 1);

describe('mobile upload helpers', () => {
  it('names a camera shot by date and the real output format', () => {
    expect(photoFileName({ uri: 'file:///cache/ImagePicker/abc.jpg' }, at)).toBe('รูป-20261003-142501.jpg');
    expect(photoFileName({ uri: 'file:///cache/x', mimeType: 'image/png' }, at)).toBe('รูป-20261003-142501.png');
    expect(photoFileName({ uri: 'file:///cache/x' }, at)).toBe('รูป-20261003-142501.jpg');
  });

  it('keeps a library photo name but uses the re-encoded extension (iOS HEIC -> JPEG)', () => {
    expect(photoFileName({ uri: 'file:///cache/ImagePicker/1.jpeg', fileName: 'IMG_0001.HEIC', mimeType: 'image/jpeg' }, at)).toBe('IMG_0001.jpg');
    expect(photoFileName({ uri: 'file:///cache/2.png', fileName: 'ป้าย.png' }, at)).toBe('ป้าย.png');
  });

  it('adds a missing document extension from the MIME type', () => {
    expect(documentFileName({ name: 'ใบเสนอราคา', uri: 'content://x', mimeType: 'application/pdf' })).toBe('ใบเสนอราคา.pdf');
    expect(documentFileName({ name: 'stock.xlsx', uri: 'file:///a' })).toBe('stock.xlsx');
    expect(extOf('file:///a/b.PDF?x=1')).toBe('pdf');
  });

  it('checks type and the 5 MB limit in Thai before sending', () => {
    expect(precheckUpload('a.jpg', 1000)).toBeNull();
    expect(precheckUpload('a.jpg', undefined)).toBeNull();
    expect(precheckUpload('a.exe', 10)).toMatch(/ไม่รองรับไฟล์ประเภทนี้/);
    expect(precheckUpload('big.pdf', 6 * 1024 * 1024)).toMatch(/ใหญ่เกิน 5 MB \(6 MB\)/);
    expect(precheckUpload('empty.txt', 0)).toMatch(/ไฟล์ว่างเปล่า/);
  });

  it('measures decoded base64 size', () => {
    expect(base64Bytes(Buffer.from('hello world').toString('base64'))).toBe(11);
    expect(base64Bytes(Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'))).toBe(5 * 1024 * 1024 + 1);
  });

  it('forces the Buddhist year when Intl printed the Gregorian one', () => {
    expect(ensureBuddhistYear('3 ต.ค. 2026', '2026-10-03')).toBe('3 ต.ค. 2569');
    expect(ensureBuddhistYear('3 ต.ค. 2569', '2026-10-03')).toBe('3 ต.ค. 2569');
    expect(ensureBuddhistYear('—', '')).toBe('—');
  });
});
