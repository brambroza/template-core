import { describe, expect, it } from 'vitest';
import { attachmentRef, auditActionLabel, auditPerm, defineUi, endpointsOf, fileKind, formatBytes } from '../src/index.ts';

describe('attachments & audit helpers', () => {
  it('names refs, kinds and sizes', () => {
    expect(attachmentRef('claim', 'abc')).toBe('claim:abc');
    expect(fileKind('image/png')).toBe('image');
    expect(fileKind('image/heic')).toBe('file'); // browsers cannot show HEIC: no thumbnail
    expect(fileKind('application/pdf')).toBe('pdf');
    expect(fileKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('sheet');
    expect(fileKind('text/csv')).toBe('sheet');
    expect(fileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('doc');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('labels audit rows in Thai and names the audit permission', () => {
    expect(auditPerm('master-data')).toBe('master.audit.read');
    expect(auditActionLabel({ method: 'POST', route: '/claims' })).toBe('สร้าง');
    expect(auditActionLabel({ method: 'POST', route: '/claims/:id/approve' })).toBe('อนุมัติ');
    expect(auditActionLabel({ method: 'PUT', route: '/claims/:id' })).toBe('แก้ไข');
    expect(auditActionLabel({ method: 'DELETE', route: '/categories/:id' })).toBe('ลบ');
    expect(auditActionLabel({ method: 'POST', route: '/_attachments' })).toBe('แนบไฟล์');
    expect(auditActionLabel({ method: 'DELETE', route: '/_attachments/:id' })).toBe('ลบไฟล์แนบ');
  });

  it('lists the attachment routes a detail screen calls', () => {
    const ui = defineUi({ module: 'x', label: 'x', glyph: 'x', menu: [], screens: {
      d: { kind: 'detail', title: 'd', endpoint: '/things/:id', heading: 'no', fields: [], attachments: { entity: 'thing' } },
    } });
    expect(endpointsOf(ui).filter((e) => e.path === '/_attachments').map((e) => e.method)).toEqual(['GET', 'POST']);
  });
});
