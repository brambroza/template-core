import { defineUi, type Field, type ImportColumn } from '@erp/ui-schema';

const itemTypes = [
  { value: 'raw', label: 'วัตถุดิบ' }, { value: 'semi', label: 'กึ่งสำเร็จรูป' }, { value: 'finished', label: 'สินค้าสำเร็จรูป' },
  { value: 'spare', label: 'อะไหล่' }, { value: 'service', label: 'บริการ' },
];
const kinds = [{ value: 'customer', label: 'ลูกค้า' }, { value: 'supplier', label: 'ผู้ขาย' }, { value: 'both', label: 'ลูกค้าและผู้ขาย' }];

const itemFields: Field[] = [
  { name: 'code', label: 'รหัส', type: 'text', required: true },
  { name: 'name', label: 'ชื่อ', type: 'text', required: true },
  { name: 'type', label: 'ประเภท', type: 'select', options: itemTypes, required: true },
  { name: 'uom', label: 'หน่วยนับ', type: 'text', default: 'pcs' },
  { name: 'stdPrice', label: 'ราคามาตรฐาน', type: 'number', format: 'money' },
];
const partnerFields: Field[] = [
  { name: 'code', label: 'รหัส', type: 'text', required: true },
  { name: 'name', label: 'ชื่อ', type: 'text', required: true },
  { name: 'kind', label: 'เป็น', type: 'select', options: kinds, required: true },
  { name: 'taxId', label: 'เลขประจำตัวผู้เสียภาษี', type: 'text', help: '13 หลัก' },
  { name: 'branch', label: 'สาขา', type: 'text', default: '00000', help: '00000 = สำนักงานใหญ่' },
  { name: 'address', label: 'ที่อยู่', type: 'textarea' },
  { name: 'phone', label: 'โทรศัพท์', type: 'text' },
  { name: 'email', label: 'อีเมล', type: 'email' },
];

/** Import columns: same keys as the create body; headers in the file may be these Thai labels or the keys. */
const itemImport: ImportColumn[] = [
  { key: 'code', label: 'รหัส', required: true }, { key: 'name', label: 'ชื่อ', required: true },
  { key: 'type', label: 'ประเภท', required: true }, { key: 'uom', label: 'หน่วยนับ' }, { key: 'stdPrice', label: 'ราคามาตรฐาน' },
  { key: 'active', label: 'ใช้งาน' },
];
const partnerImport: ImportColumn[] = [
  { key: 'code', label: 'รหัส', required: true }, { key: 'name', label: 'ชื่อ', required: true }, { key: 'kind', label: 'เป็น', required: true },
  { key: 'taxId', label: 'เลขประจำตัวผู้เสียภาษี' }, { key: 'branch', label: 'สาขา' }, { key: 'address', label: 'ที่อยู่' },
  { key: 'phone', label: 'โทรศัพท์' }, { key: 'email', label: 'อีเมล' }, { key: 'active', label: 'ใช้งาน' },
];

export default defineUi({
  module: 'master-data',
  label: 'ข้อมูลหลัก',
  glyph: 'ห',
  icon: 'database',
  menu: [
    { label: 'สินค้าและวัตถุดิบ', screen: 'items' },
    { label: 'ลูกค้าและผู้ขาย', screen: 'partners' },
  ],
  search: [
    { id: 'items', title: 'สินค้า', endpoint: '/items', label: ['code', 'name'], screen: 'itemEdit', perm: 'master.item.read' },
    { id: 'partners', title: 'ลูกค้า/ผู้ขาย', endpoint: '/partners', label: ['code', 'name'], screen: 'partnerEdit', perm: 'master.partner.read' },
  ],
  screens: {
    items: {
      kind: 'list', title: 'สินค้าและวัตถุดิบ', endpoint: '/items', perm: 'master.item.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหารหัสหรือชื่อ', type: 'text' }, { name: 'type', label: 'ประเภท', type: 'select', options: itemTypes }],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }, { key: 'type', label: 'ประเภท', format: 'label' },
        { key: 'uom', label: 'หน่วยนับ' }, { key: 'std_price', label: 'ราคามาตรฐาน', format: 'money' },
      ],
      create: 'itemNew', createLabel: 'เพิ่มสินค้า', rowLink: { screen: 'itemEdit' },
      import: { endpoint: '/items/import', perm: 'master.item.write', columns: itemImport, template: 'แบบฟอร์มนำเข้าสินค้า.csv' },
      empty: 'ยังไม่มีสินค้า เพิ่มวัตถุดิบหรือสินค้าตัวแรกเพื่อเริ่มใช้งานโมดูลอื่น',
    },
    itemNew: { kind: 'form', title: 'เพิ่มสินค้า', method: 'POST', endpoint: '/items', perm: 'master.item.write', fields: itemFields, submitLabel: 'บันทึกสินค้า', after: { screen: 'items' } },
    itemEdit: { kind: 'form', title: 'แก้ไขสินค้า', method: 'PATCH', endpoint: '/items/:id', load: '/items/:id', perm: 'master.item.write', fields: itemFields, submitLabel: 'บันทึกการแก้ไข', after: { screen: 'items' } },
    partners: {
      kind: 'list', title: 'ลูกค้าและผู้ขาย', endpoint: '/partners', perm: 'master.partner.read',
      filters: [{ name: 'q', label: 'ค้นหารหัสหรือชื่อ', type: 'text' }, { name: 'kind', label: 'เป็น', type: 'select', options: kinds }],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }, { key: 'kind', label: 'เป็น', format: 'label' },
        { key: 'tax_id', label: 'เลขประจำตัวผู้เสียภาษี' }, { key: 'phone', label: 'โทรศัพท์' },
      ],
      create: 'partnerNew', createLabel: 'เพิ่มคู่ค้า', rowLink: { screen: 'partnerEdit' },
      import: { endpoint: '/partners/import', perm: 'master.partner.write', columns: partnerImport, template: 'แบบฟอร์มนำเข้าคู่ค้า.csv' },
      empty: 'ยังไม่มีลูกค้าหรือผู้ขาย',
    },
    partnerNew: { kind: 'form', title: 'เพิ่มคู่ค้า', method: 'POST', endpoint: '/partners', perm: 'master.partner.write', fields: partnerFields, submitLabel: 'บันทึกคู่ค้า', after: { screen: 'partners' } },
    partnerEdit: { kind: 'form', title: 'แก้ไขคู่ค้า', method: 'PATCH', endpoint: '/partners/:id', load: '/partners/:id', perm: 'master.partner.write', fields: partnerFields, submitLabel: 'บันทึกการแก้ไข', after: { screen: 'partners' } },
  },
});
