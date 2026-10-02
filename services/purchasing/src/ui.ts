import { defineUi, STATUS_TH } from '@erp/ui-schema';

const statuses = ['draft', 'approved', 'partially_received', 'received', 'cancelled'].map((v) => ({ value: v, label: STATUS_TH[v] }));

export default defineUi({
  module: 'purchasing',
  label: 'จัดซื้อ',
  glyph: 'ซ',
  menu: [{ label: 'ใบสั่งซื้อ', screen: 'poList' }, { label: 'สร้างใบสั่งซื้อ', screen: 'poNew' }],
  screens: {
    poList: {
      kind: 'list', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders', perm: 'purchasing.po.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาเลขที่หรือผู้ขาย', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: statuses }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'supplier_name', label: 'ผู้ขาย' }, { key: 'order_date', label: 'วันที่', format: 'date' },
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'gross', label: 'ยอดรวม', format: 'money' },
      ],
      create: 'poNew', createLabel: 'สร้างใบสั่งซื้อ', rowLink: { screen: 'poDetail' }, empty: 'ยังไม่มีใบสั่งซื้อ',
    },
    poNew: {
      kind: 'form', title: 'สร้างใบสั่งซื้อ', method: 'POST', endpoint: '/purchase-orders', perm: 'purchasing.po.write',
      fields: [
        { name: 'supplierId', label: 'ผู้ขาย', type: 'lookup', required: true,
          lookup: { module: 'master-data', path: '/partners', query: { kind: 'supplier' }, label: ['code', 'name'], assign: { supplierId: 'id', supplierName: 'name' } } },
        { name: 'warehouseCode', label: 'รับเข้าคลัง', type: 'text', default: 'MAIN', required: true },
        { name: 'orderDate', label: 'วันที่สั่ง', type: 'date' },
        { name: 'expectedDate', label: 'กำหนดส่ง', type: 'date' },
        { name: 'vatMode', label: 'ราคา', type: 'select', default: 'exclusive', options: [{ value: 'exclusive', label: 'ยังไม่รวม VAT' }, { value: 'inclusive', label: 'รวม VAT แล้ว' }] },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      lines: {
        name: 'lines', label: 'รายการสั่งซื้อ', min: 1,
        fields: [
          { name: 'itemId', label: 'สินค้า', type: 'lookup', required: true, lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' } } },
          { name: 'qty', label: 'จำนวน', type: 'number', required: true },
          { name: 'unitPrice', label: 'ราคาต่อหน่วย', type: 'number', step: 0.01, required: true },
        ],
      },
      submitLabel: 'สร้างใบสั่งซื้อ', after: { screen: 'poDetail', idFrom: 'id' },
    },
    poDetail: {
      kind: 'detail', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders/:id', perm: 'purchasing.po.read', heading: 'no', mobile: true, printable: true,
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'supplier_name', label: 'ผู้ขาย' },
        { key: 'order_date', label: 'วันที่สั่ง', format: 'date' }, { key: 'expected_date', label: 'กำหนดส่ง', format: 'date' },
        { key: 'warehouse_code', label: 'รับเข้าคลัง' }, { key: 'net', label: 'ก่อน VAT', format: 'money' },
        { key: 'vat', label: 'VAT 7%', format: 'money' }, { key: 'gross', label: 'ยอดรวม', format: 'money' }, { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [{
        path: 'lines', label: 'รายการ',
        columns: [
          { key: 'line_no', label: '#' }, { key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' },
          { key: 'qty', label: 'สั่ง', format: 'qty' }, { key: 'received_qty', label: 'รับแล้ว', format: 'qty' },
          { key: 'unit_price', label: 'ราคา/หน่วย', format: 'money' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' },
        ],
      }],
      actions: [
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/purchase-orders/:id/approve', perm: 'purchasing.po.approve', when: { field: 'status', in: ['draft'] }, tone: 'primary', mobile: true },
        { id: 'receive', label: 'รับของที่ค้างทั้งหมด', method: 'POST', endpoint: '/purchase-orders/:id/receive', perm: 'purchasing.po.receive', when: { field: 'status', in: ['approved', 'partially_received'] }, confirm: 'บันทึกรับของทุกรายการที่ยังค้างรับ', tone: 'primary', mobile: true },
        { id: 'cancel', label: 'ยกเลิกใบสั่งซื้อ', method: 'POST', endpoint: '/purchase-orders/:id/cancel', perm: 'purchasing.po.write', when: { field: 'status', in: ['draft', 'approved'] }, confirm: 'ยกเลิกแล้วแก้กลับไม่ได้', tone: 'danger' },
      ],
    },
  },
});
