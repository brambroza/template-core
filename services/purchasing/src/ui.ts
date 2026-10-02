import { defineUi, STATUS_TH } from '@erp/ui-schema';

const statuses = ['draft', 'approved', 'partially_received', 'received', 'cancelled'].map((v) => ({ value: v, label: STATUS_TH[v] }));

export default defineUi({
  module: 'purchasing',
  label: 'จัดซื้อ',
  glyph: 'ซ',
  icon: 'shopping-cart',
  menu: [{ label: 'ใบสั่งซื้อ', screen: 'poList' }, { label: 'สร้างใบสั่งซื้อ', screen: 'poNew' }, { label: 'ใบส่งคืนสินค้า', screen: 'rtList' }],
  commands: [
    { id: 'po', label: 'สร้างใบสั่งซื้อ', example: 'สั่งซื้อ SUP-001', keywords: ['สั่งซื้อ', 'ซื้อ', 'po'], screen: 'poNew', perm: 'purchasing.po.write',
      arg: { lookup: { module: 'master-data', path: '/partners', query: { kind: 'supplier' }, label: ['code', 'name'], assign: { supplierId: 'id', supplierName: 'name' } } } },
    { id: 'approve', label: 'ใบสั่งซื้อรออนุมัติ', example: 'ใบสั่งซื้อรออนุมัติ', keywords: ['ใบสั่งซื้อรออนุมัติ', 'po รออนุมัติ', 'อนุมัติใบสั่งซื้อ', 'อนุมัติ po'], screen: 'poList', perm: 'purchasing.po.read' },
  ],
  search: [
    { id: 'pos', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders', label: ['no', 'supplier_name'], screen: 'poDetail', perm: 'purchasing.po.read' },
    { id: 'returns', title: 'ใบส่งคืนสินค้า', endpoint: '/purchase-returns', label: ['no', 'po_no', 'supplier_name'], screen: 'rtDetail', perm: 'purchasing.po.read' },
  ],
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
      kind: 'detail', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders/:id', perm: 'purchasing.po.read', heading: 'no', mobile: true,
      print: { title: 'ใบสั่งซื้อ', signatures: ['ผู้จัดทำ', 'ผู้อนุมัติ', 'ผู้ขาย (ยืนยันรับคำสั่งซื้อ)'] },
      flow: { field: 'status', steps: [{ value: 'draft', label: 'ร่าง' }, { value: 'approved', label: 'อนุมัติ' }, { value: 'partially_received', label: 'รับบางส่วน' }, { value: 'received', label: 'รับครบ' }], exits: [{ value: 'cancelled', label: 'ยกเลิก' }] },
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
          { key: 'qty', label: 'สั่ง', format: 'qty' }, { key: 'received_qty', label: 'รับแล้ว', format: 'qty' }, { key: 'returned_qty', label: 'ส่งคืน', format: 'qty' },
          { key: 'unit_price', label: 'ราคา/หน่วย', format: 'money' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' },
        ],
      }, {
        path: 'returns', label: 'ใบส่งคืนสินค้า',
        columns: [
          { key: 'no', label: 'เลขที่' }, { key: 'return_date', label: 'วันที่', format: 'date' }, { key: 'warehouse_code', label: 'จากคลัง' },
          { key: 'ref_no', label: 'อ้างอิง NCR' }, { key: 'gross', label: 'มูลค่ารวม VAT', format: 'money' },
        ],
      }],
      actions: [
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/purchase-orders/:id/approve', perm: 'purchasing.po.approve', when: { field: 'status', in: ['draft'] }, tone: 'primary', mobile: true },
        { id: 'receive', label: 'รับของที่ค้างทั้งหมด', method: 'POST', endpoint: '/purchase-orders/:id/receive', perm: 'purchasing.po.receive', when: { field: 'status', in: ['approved', 'partially_received'] }, confirm: 'บันทึกรับของทุกรายการที่ยังค้างรับ', tone: 'primary', mobile: true },
        { id: 'return', label: 'ส่งคืนผู้ขาย', method: 'POST', endpoint: '/purchase-orders/:id/returns', perm: 'purchasing.po.return', when: { field: 'status', in: ['partially_received', 'received'] },
          then: { screen: 'rtDetail', idFrom: 'id' },
          fields: [
            { name: 'warehouseCode', label: 'ส่งออกจากคลัง', type: 'text', default: 'QC-HOLD', required: true,
              help: 'ของที่ QC ไม่ผ่านอยู่ในคลังกักกัน QC-HOLD · ถ้าคืนของดีจากคลังปกติ ให้ใส่รหัสคลังนั้น (เช่น MAIN)' },
            { name: 'refNo', label: 'อ้างอิง NCR / เอกสาร', type: 'text' },
            { name: 'returnDate', label: 'วันที่ส่งคืน', type: 'date' },
            { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
          ],
          lines: {
            name: 'lines', label: 'รายการที่ส่งคืน', min: 1,
            fields: [
              { name: 'itemId', label: 'สินค้า', type: 'lookup', required: true, lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' } } },
              { name: 'qty', label: 'จำนวน', type: 'number', required: true },
              { name: 'reason', label: 'เหตุผล', type: 'text' },
            ],
          } },
        { id: 'cancel', label: 'ยกเลิกใบสั่งซื้อ', method: 'POST', endpoint: '/purchase-orders/:id/cancel', perm: 'purchasing.po.write', when: { field: 'status', in: ['draft', 'approved'] }, confirm: 'ยกเลิกแล้วแก้กลับไม่ได้', tone: 'danger' },
      ],
    },
    rtList: {
      kind: 'list', title: 'ใบส่งคืนสินค้า', endpoint: '/purchase-returns', perm: 'purchasing.po.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาเลขที่ PO ผู้ขาย หรือ NCR', type: 'text' }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'return_date', label: 'วันที่', format: 'date' }, { key: 'po_no', label: 'ใบสั่งซื้อ' },
        { key: 'supplier_name', label: 'ผู้ขาย' }, { key: 'items', label: 'รายการ' }, { key: 'warehouse_code', label: 'จากคลัง' },
        { key: 'ref_no', label: 'อ้างอิง NCR' }, { key: 'gross', label: 'มูลค่ารวม VAT', format: 'money' },
      ],
      rowLink: { screen: 'rtDetail' },
      empty: 'ยังไม่มีการส่งคืนสินค้า — เปิดใบสั่งซื้อที่รับของแล้ว แล้วกด "ส่งคืนผู้ขาย"',
    },
    rtDetail: {
      kind: 'detail', title: 'ใบส่งคืนสินค้า', endpoint: '/purchase-returns/:id', perm: 'purchasing.po.read', heading: 'no', mobile: true, printable: true,
      fields: [
        { key: 'return_date', label: 'วันที่ส่งคืน', format: 'date' }, { key: 'supplier_name', label: 'ผู้ขาย' }, { key: 'po_no', label: 'ตามใบสั่งซื้อ' },
        { key: 'warehouse_code', label: 'ส่งออกจากคลัง' }, { key: 'ref_no', label: 'อ้างอิง NCR / เอกสาร' }, { key: 'created_by_name', label: 'ผู้บันทึก' },
        { key: 'net', label: 'มูลค่าก่อน VAT', format: 'money' }, { key: 'vat', label: 'VAT 7%', format: 'money' }, { key: 'gross', label: 'มูลค่ารวม (ขอลดหนี้)', format: 'money' },
        { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [{
        path: 'lines', label: 'รายการ',
        columns: [
          { key: 'line_no', label: '#' }, { key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' }, { key: 'qty', label: 'จำนวน', format: 'qty' },
          { key: 'unit_price', label: 'ราคา/หน่วย', format: 'money' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' }, { key: 'reason', label: 'เหตุผล' },
        ],
      }],
    },
  },
  widgets: [
    { id: 'po-kpi', kind: 'kpi', title: 'จัดซื้อ', endpoint: '/summary', perm: 'purchasing.po.read', size: 'sm', href: 'poList',
      items: [{ key: 'toApprove', label: 'รออนุมัติ', format: 'qty', tone: 'warn' }, { key: 'toReceive', label: 'รอรับของ', format: 'qty' }, { key: 'spendMonth', label: 'ยอดซื้อเดือนนี้', format: 'money' }] },
    { id: 'po-trend', kind: 'trend', title: 'ยอดซื้อ 6 เดือน', endpoint: '/summary', perm: 'purchasing.po.read', size: 'md', href: 'poList', rows: 'months', x: 'month', y: 'total', format: 'money' },
  ],
});
