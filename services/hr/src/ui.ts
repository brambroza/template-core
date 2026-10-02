import { defineUi } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */
export default defineUi({
  module: 'hr',
  label: 'บุคคลและลงเวลา',
  glyph: 'บ',
  menu: [{ label: 'บุคคลและลงเวลา', screen: 'records' }],
  screens: {
    records: {
      kind: 'list', title: 'บุคคลและลงเวลา', endpoint: '/records', perm: 'hr.record.read', mobile: true,
      columns: [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }, { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' }],
      create: 'recordNew', createLabel: 'เพิ่ม', rowLink: { screen: 'record' }, empty: 'ยังไม่มีรายการ',
    },
    recordNew: {
      kind: 'form', title: 'เพิ่มบุคคลและลงเวลา', method: 'POST', endpoint: '/records', perm: 'hr.record.write', mobile: true,
      fields: [{ name: 'code', label: 'รหัส', type: 'text', required: true }, { name: 'name', label: 'ชื่อ', type: 'text', required: true }],
      submitLabel: 'บันทึก', after: { screen: 'record', idFrom: 'id' },
    },
    record: {
      kind: 'detail', title: 'บุคคลและลงเวลา', endpoint: '/records/:id', perm: 'hr.record.read', heading: 'code', mobile: true,
      fields: [{ key: 'name', label: 'ชื่อ' }, { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' }],
    },
  },
});
