import { defineUi, STATUS_TH } from '@erp/ui-schema';

const statuses = ['draft', 'confirmed', 'delivered', 'invoiced', 'cancelled'].map((v) => ({ value: v, label: STATUS_TH[v] }));

export default defineUi({
  module: 'sales',
  label: 'ขาย',
  glyph: 'ข',
  menu: [{ label: 'ใบสั่งขาย', screen: 'soList' }, { label: 'สร้างใบสั่งขาย', screen: 'soNew' }],
  screens: {
    soList: {
      kind: 'list', title: 'ใบสั่งขาย', endpoint: '/orders', perm: 'sales.order.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาเลขที่หรือลูกค้า', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: statuses }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'order_date', label: 'วันที่', format: 'date' },
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'gross', label: 'ยอดรวม', format: 'money' },
      ],
      create: 'soNew', createLabel: 'สร้างใบสั่งขาย', rowLink: { screen: 'soDetail' }, empty: 'ยังไม่มีใบสั่งขาย',
    },
    soNew: {
      kind: 'form', title: 'สร้างใบสั่งขาย', method: 'POST', endpoint: '/orders', perm: 'sales.order.write',
      fields: [
        { name: 'customerId', label: 'ลูกค้า', type: 'lookup', required: true,
          lookup: { module: 'master-data', path: '/partners', query: { kind: 'customer' }, label: ['code', 'name'],
            assign: { customerId: 'id', customerName: 'name', customerTaxId: 'tax_id', customerBranch: 'branch', customerAddress: 'address' } } },
        { name: 'warehouseCode', label: 'ส่งจากคลัง', type: 'text', default: 'MAIN', required: true },
        { name: 'orderDate', label: 'วันที่', type: 'date' },
        { name: 'vatMode', label: 'ราคา', type: 'select', default: 'exclusive', options: [{ value: 'exclusive', label: 'ยังไม่รวม VAT' }, { value: 'inclusive', label: 'รวม VAT แล้ว' }] },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      lines: {
        name: 'lines', label: 'รายการขาย', min: 1,
        fields: [
          { name: 'itemId', label: 'สินค้า', type: 'lookup', required: true, lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' } } },
          { name: 'qty', label: 'จำนวน', type: 'number', required: true },
          { name: 'unitPrice', label: 'ราคาต่อหน่วย', type: 'number', step: 0.01, required: true },
        ],
      },
      submitLabel: 'สร้างใบสั่งขาย', after: { screen: 'soDetail', idFrom: 'id' },
    },
    soDetail: {
      kind: 'detail', title: 'ใบสั่งขาย', endpoint: '/orders/:id', perm: 'sales.order.read', heading: 'no', mobile: true,
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'customer_tax_id', label: 'เลขผู้เสียภาษี' },
        { key: 'order_date', label: 'วันที่', format: 'date' }, { key: 'warehouse_code', label: 'ส่งจากคลัง' },
        { key: 'net', label: 'ก่อน VAT', format: 'money' }, { key: 'vat', label: 'VAT 7%', format: 'money' }, { key: 'gross', label: 'ยอดรวม', format: 'money' },
      ],
      lines: [{
        path: 'lines', label: 'รายการ',
        columns: [
          { key: 'line_no', label: '#' }, { key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' },
          { key: 'qty', label: 'จำนวน', format: 'qty' }, { key: 'unit_price', label: 'ราคา/หน่วย', format: 'money' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' },
        ],
      }],
      actions: [
        { id: 'confirm', label: 'ยืนยันคำสั่งซื้อ', method: 'POST', endpoint: '/orders/:id/confirm', perm: 'sales.order.write', when: { field: 'status', in: ['draft'] }, tone: 'primary', mobile: true },
        { id: 'deliver', label: 'บันทึกส่งของ', method: 'POST', endpoint: '/orders/:id/deliver', perm: 'sales.order.deliver', when: { field: 'status', in: ['confirmed'] }, tone: 'primary', mobile: true },
        { id: 'invoice', label: 'ออกใบกำกับภาษี', method: 'POST', endpoint: '/orders/:id/invoice', perm: 'sales.invoice.write', when: { field: 'status', in: ['confirmed', 'delivered'] }, tone: 'primary',
          fields: [{ name: 'issueDate', label: 'วันที่ใบกำกับ', type: 'date' }], then: { screen: 'invoice', idFrom: 'id' } },
        { id: 'cancel', label: 'ยกเลิกใบสั่งขาย', method: 'POST', endpoint: '/orders/:id/cancel', perm: 'sales.order.write', when: { field: 'status', in: ['draft', 'confirmed'] }, confirm: 'ยกเลิกแล้วแก้กลับไม่ได้', tone: 'danger' },
      ],
    },
    invoice: {
      kind: 'detail', title: 'ใบกำกับภาษี', endpoint: '/invoices/:id', perm: 'sales.order.read', heading: 'no', printable: true,
      fields: [
        { key: 'issueDateTh', label: 'วันที่' }, { key: 'orderNo', label: 'อ้างอิงใบสั่งขาย' },
        { key: 'customer.name', label: 'ลูกค้า' }, { key: 'customer.taxId', label: 'เลขประจำตัวผู้เสียภาษี' },
        { key: 'customer.branch', label: 'สาขา' }, { key: 'customer.address', label: 'ที่อยู่' },
        { key: 'net', label: 'มูลค่าสินค้า', format: 'money' }, { key: 'vat', label: 'ภาษีมูลค่าเพิ่ม 7%', format: 'money' },
        { key: 'gross', label: 'รวมทั้งสิ้น', format: 'money' }, { key: 'amountText', label: 'ตัวอักษร' },
        { key: 'promptPay', label: 'ชำระด้วยพร้อมเพย์', format: 'qr' },
      ],
      lines: [{
        path: 'lines', label: 'รายการ',
        columns: [
          { key: 'line_no', label: '#' }, { key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'รายการ' },
          { key: 'qty', label: 'จำนวน', format: 'qty' }, { key: 'unit_price', label: 'ราคา/หน่วย', format: 'money' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' },
        ],
      }],
    },
  },
});
