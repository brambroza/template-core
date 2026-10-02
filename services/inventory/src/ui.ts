import { defineUi, type Field, type LinesSpec } from '@erp/ui-schema';

const wh = (name: string, label: string): Field => ({
  name, label, type: 'lookup', required: true, lookup: { path: '/warehouses', label: ['code', 'name'], assign: { [name]: 'code' } },
});
const item: Field = {
  name: 'itemId', label: 'สินค้า', type: 'lookup', required: true,
  lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' }, scanField: 'code' },
};
const qty: Field = { name: 'qty', label: 'จำนวน', type: 'number', required: true, step: 0.0001 };
const lines = (extra: Field[] = []): LinesSpec => ({ name: 'lines', label: 'รายการ', fields: [item, qty, ...extra], min: 1 });
const ref: Field[] = [{ name: 'refId', label: 'เลขที่เอกสารอ้างอิง', type: 'text' }, { name: 'note', label: 'หมายเหตุ', type: 'textarea' }];

export default defineUi({
  module: 'inventory',
  label: 'คลังสินค้า',
  glyph: 'ค',
  menu: [
    { label: 'ยอดคงเหลือ', screen: 'balances' },
    { label: 'รับเข้า', screen: 'receipt' },
    { label: 'จ่ายออก', screen: 'issue' },
    { label: 'โอนย้าย', screen: 'transfer' },
    { label: 'ปรับปรุงยอด', screen: 'adjust' },
    { label: 'คลัง', screen: 'warehouses' },
    { label: 'ตั้งค่า', screen: 'settings' },
  ],
  screens: {
    balances: {
      kind: 'list', title: 'ยอดคงเหลือ', endpoint: '/balances', perm: 'inventory.stock.read', mobile: true,
      filters: [{ ...wh('warehouseCode', 'คลัง'), required: false }],
      columns: [
        { key: 'itemCode', label: 'รหัส' }, { key: 'itemName', label: 'ชื่อ' },
        { key: 'warehouseCode', label: 'คลัง' }, { key: 'onHand', label: 'คงเหลือ', format: 'qty' },
      ],
      rowLink: { screen: 'stockCard', idFrom: 'itemId' },
      empty: 'ยังไม่มีสต็อก บันทึกรับเข้าครั้งแรกเพื่อเริ่มต้น',
    },
    stockCard: {
      kind: 'list', title: 'สต็อกการ์ด', endpoint: '/items/:itemId/stock-card', perm: 'inventory.stock.read', mobile: true,
      columns: [
        { key: 'at', label: 'เวลา', format: 'datetime' }, { key: 'warehouseCode', label: 'คลัง' }, { key: 'kind', label: 'รายการ', format: 'label' },
        { key: 'qty', label: 'จำนวน', format: 'qty' }, { key: 'balance', label: 'คงเหลือ', format: 'qty' },
        { key: 'refType', label: 'จาก' }, { key: 'refId', label: 'เลขที่อ้างอิง' },
      ],
    },
    receipt: {
      kind: 'form', title: 'รับสินค้าเข้าคลัง', method: 'POST', endpoint: '/receipts', perm: 'inventory.move.write', mobile: true,
      fields: [wh('warehouseCode', 'เข้าคลัง'), ...ref], lines: lines([{ name: 'unitCost', label: 'ต้นทุนต่อหน่วย', type: 'number', step: 0.01 }]),
      submitLabel: 'บันทึกรับเข้า', after: { screen: 'balances' },
    },
    issue: {
      kind: 'form', title: 'จ่ายสินค้าออกจากคลัง', method: 'POST', endpoint: '/issues', perm: 'inventory.move.write', mobile: true,
      fields: [wh('warehouseCode', 'จากคลัง'), ...ref], lines: lines(), submitLabel: 'บันทึกจ่ายออก', after: { screen: 'balances' },
    },
    transfer: {
      kind: 'form', title: 'โอนย้ายระหว่างคลัง', method: 'POST', endpoint: '/transfers', perm: 'inventory.move.write',
      fields: [wh('fromWarehouseCode', 'จากคลัง'), wh('toWarehouseCode', 'ไปคลัง'), { name: 'note', label: 'หมายเหตุ', type: 'textarea' }],
      lines: lines(), submitLabel: 'บันทึกการโอน', after: { screen: 'balances' },
    },
    adjust: {
      kind: 'form', title: 'ปรับปรุงยอดสต็อก', method: 'POST', endpoint: '/adjustments', perm: 'inventory.move.write',
      fields: [wh('warehouseCode', 'คลัง'), { name: 'note', label: 'เหตุผล', type: 'textarea', required: true }],
      lines: { name: 'lines', label: 'รายการ', min: 1, fields: [item, { ...qty, label: 'ปรับ (+ เพิ่ม / − ลด)' }] },
      submitLabel: 'บันทึกการปรับปรุง', after: { screen: 'balances' },
    },
    warehouses: {
      kind: 'list', title: 'คลัง', endpoint: '/warehouses', perm: 'inventory.stock.read',
      columns: [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }],
      create: 'warehouseNew', createLabel: 'เพิ่มคลัง', empty: 'ยังไม่มีคลัง เพิ่มคลังแรก เช่น MAIN',
    },
    warehouseNew: {
      kind: 'form', title: 'เพิ่มคลัง', method: 'POST', endpoint: '/warehouses', perm: 'inventory.settings.write',
      fields: [{ name: 'code', label: 'รหัส', type: 'text', required: true }, { name: 'name', label: 'ชื่อ', type: 'text', required: true }],
      submitLabel: 'บันทึกคลัง', after: { screen: 'warehouses' },
    },
    settings: {
      kind: 'form', title: 'ตั้งค่าคลัง', method: 'PUT', endpoint: '/settings', perm: 'inventory.settings.write',
      fields: [{ name: 'allowNegative', label: 'อนุญาตให้สต็อกติดลบเมื่อจ่ายออก', type: 'boolean' }],
      submitLabel: 'บันทึกการตั้งค่า', after: { screen: 'balances' },
    },
  },
});
