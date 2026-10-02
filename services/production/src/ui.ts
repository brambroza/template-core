import { defineUi, type Field } from '@erp/ui-schema';

const item = (label: string): Field => ({
  name: 'itemId', label, type: 'lookup', required: true,
  lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' } },
});

export default defineUi({
  module: 'production',
  label: 'วางแผนการผลิต',
  glyph: 'ผ',
  menu: [{ label: 'ใบสั่งผลิต', screen: 'moList' }, { label: 'สูตรการผลิต (BOM)', screen: 'bomList' }],
  screens: {
    moList: {
      kind: 'list', title: 'ใบสั่งผลิต', endpoint: '/orders', perm: 'production.order.read', mobile: true,
      filters: [{ name: 'status', label: 'สถานะ', type: 'select', options: [{ value: 'planned', label: 'วางแผน' }, { value: 'released', label: 'ปล่อยงาน' }, { value: 'completed', label: 'ผลิตเสร็จ' }, { value: 'cancelled', label: 'ยกเลิก' }] }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'item_code', label: 'สินค้า' }, { key: 'qty', label: 'สั่งผลิต', format: 'qty' },
        { key: 'completed_qty', label: 'ผลิตแล้ว', format: 'qty' }, { key: 'due_date', label: 'กำหนดเสร็จ', format: 'date' }, { key: 'status', label: 'สถานะ', format: 'status' },
      ],
      create: 'moNew', createLabel: 'สร้างใบสั่งผลิต', rowLink: { screen: 'moDetail' }, empty: 'ยังไม่มีใบสั่งผลิต ต้องมีสูตรการผลิตของสินค้าก่อน',
    },
    moNew: {
      kind: 'form', title: 'สร้างใบสั่งผลิต', method: 'POST', endpoint: '/orders', perm: 'production.order.write',
      fields: [
        item('สินค้าที่จะผลิต'),
        { name: 'qty', label: 'จำนวน', type: 'number', required: true },
        { name: 'warehouseCode', label: 'คลังวัตถุดิบและสินค้า', type: 'text', default: 'MAIN', required: true },
        { name: 'dueDate', label: 'กำหนดเสร็จ', type: 'date' },
      ],
      submitLabel: 'สร้างใบสั่งผลิต', after: { screen: 'moDetail', idFrom: 'id' },
    },
    moDetail: {
      kind: 'detail', title: 'ใบสั่งผลิต', endpoint: '/orders/:id', perm: 'production.order.read', heading: 'no', mobile: true,
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'item_code', label: 'สินค้า' }, { key: 'item_name', label: 'ชื่อ' },
        { key: 'qty', label: 'สั่งผลิต', format: 'qty' }, { key: 'completed_qty', label: 'ผลิตแล้ว', format: 'qty' },
        { key: 'warehouse_code', label: 'คลัง' }, { key: 'due_date', label: 'กำหนดเสร็จ', format: 'date' },
      ],
      lines: [{ path: 'requirements', label: 'วัตถุดิบที่ต้องใช้ (ส่วนที่ยังไม่ผลิต)', columns: [{ key: 'itemCode', label: 'รหัส' }, { key: 'itemName', label: 'ชื่อ' }, { key: 'qty', label: 'จำนวน', format: 'qty' }] }],
      actions: [
        { id: 'release', label: 'ปล่อยงานเข้าไลน์', method: 'POST', endpoint: '/orders/:id/release', perm: 'production.order.write', when: { field: 'status', in: ['planned'] }, tone: 'primary', mobile: true },
        { id: 'complete', label: 'รายงานผลผลิต', method: 'POST', endpoint: '/orders/:id/complete', perm: 'production.order.write', when: { field: 'status', in: ['released'] }, tone: 'primary', mobile: true,
          fields: [{ name: 'qty', label: 'จำนวนที่ผลิตได้', type: 'number', help: 'เว้นว่าง = ผลิตครบส่วนที่เหลือ' }] },
        { id: 'cancel', label: 'ยกเลิกใบสั่งผลิต', method: 'POST', endpoint: '/orders/:id/cancel', perm: 'production.order.write', when: { field: 'status', in: ['planned', 'released'] }, confirm: 'ยกเลิกแล้วแก้กลับไม่ได้', tone: 'danger' },
      ],
    },
    bomList: {
      kind: 'list', title: 'สูตรการผลิต (BOM)', endpoint: '/boms', perm: 'production.bom.read',
      columns: [{ key: 'item_code', label: 'สินค้า' }, { key: 'item_name', label: 'ชื่อ' }, { key: 'output_qty', label: 'ผลิตได้ต่อสูตร', format: 'qty' }, { key: 'updated_at', label: 'แก้ไขล่าสุด', format: 'datetime' }],
      create: 'bomEdit', createLabel: 'สร้าง/แก้ไขสูตร', rowLink: { screen: 'bomDetail', idFrom: 'item_id' }, empty: 'ยังไม่มีสูตรการผลิต',
    },
    bomDetail: {
      kind: 'detail', title: 'สูตรการผลิต', endpoint: '/boms/:itemId', perm: 'production.bom.read', heading: 'item_code',
      fields: [{ key: 'item_name', label: 'สินค้า' }, { key: 'output_qty', label: 'ผลิตได้ต่อสูตร', format: 'qty' }],
      lines: [{ path: 'lines', label: 'ส่วนประกอบ', columns: [{ key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' }, { key: 'qty', label: 'ใช้', format: 'qty' }, { key: 'scrap_pct', label: 'เผื่อเสีย', format: 'percent' }] }],
    },
    bomEdit: {
      kind: 'form', title: 'สร้างหรือแก้ไขสูตรการผลิต', method: 'PUT', endpoint: '/boms', perm: 'production.bom.write',
      fields: [item('สินค้าที่ผลิต'), { name: 'outputQty', label: 'ผลิตได้ต่อสูตร', type: 'number', default: 1 }],
      lines: {
        name: 'lines', label: 'ส่วนประกอบ', min: 1,
        fields: [item('ส่วนประกอบ'), { name: 'qty', label: 'ใช้ต่อสูตร', type: 'number', required: true, step: 0.000001 }, { name: 'scrapPct', label: 'เผื่อเสีย %', type: 'number', default: 0 }],
      },
      submitLabel: 'บันทึกสูตร', after: { screen: 'bomDetail', idFrom: 'item_id' },
    },
  },
});
