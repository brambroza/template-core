import { defineUi } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */
export default defineUi({
  module: 'crm',
  label: 'ลูกค้าสัมพันธ์',
  glyph: 'ล',
  menu: [{ label: 'ลูกค้าสัมพันธ์', screen: 'records' }],
  screens: {
    records: {
      kind: 'list', title: 'ลูกค้าสัมพันธ์', endpoint: '/records', perm: 'crm.record.read', mobile: true,
      columns: [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }, { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' }],
      create: 'recordNew', createLabel: 'เพิ่ม', rowLink: { screen: 'record' }, empty: 'ยังไม่มีรายการ',
    },
    recordNew: {
      kind: 'form', title: 'เพิ่มลูกค้าสัมพันธ์', method: 'POST', endpoint: '/records', perm: 'crm.record.write', mobile: true,
      fields: [{ name: 'code', label: 'รหัส', type: 'text', required: true }, { name: 'name', label: 'ชื่อ', type: 'text', required: true }],
      submitLabel: 'บันทึก', after: { screen: 'record', idFrom: 'id' },
    },
    record: {
      kind: 'detail', title: 'ลูกค้าสัมพันธ์', endpoint: '/records/:id', perm: 'crm.record.read', heading: 'code', mobile: true,
      fields: [{ key: 'name', label: 'ชื่อ' }, { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' }],
    },
  },
});
