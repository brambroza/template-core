import { defineUi, STATUS_TH } from '@erp/ui-schema';

const statuses = ['draft', 'confirmed', 'delivered', 'invoiced', 'cancelled'].map((v) => ({ value: v, label: STATUS_TH[v] }));
const PAY_LABELS = { outstanding: 'ค้างชำระ', partially_paid: 'ชำระบางส่วน', paid: 'ชำระครบ' };
const payStatuses = [{ value: 'open', label: 'ยังไม่ครบ' }, ...Object.entries(PAY_LABELS).map(([value, label]) => ({ value, label }))];
const methods = [{ value: 'transfer', label: 'โอนเงิน' }, { value: 'cash', label: 'เงินสด' }, { value: 'cheque', label: 'เช็ค' }, { value: 'card', label: 'บัตรเครดิต' }];
const whtRates = [{ value: '0', label: 'ไม่มี' }, { value: '1', label: '1% (ค่าขนส่ง)' }, { value: '2', label: '2% (ค่าโฆษณา)' }, { value: '3', label: '3% (ค่าบริการ/จ้างทำของ)' }, { value: '5', label: '5% (ค่าเช่า)' }];
const customerLookup = {
  module: 'master-data', path: '/partners', query: { kind: 'customer' }, label: ['code', 'name'],
  assign: { customerId: 'id', customerName: 'name', customerTaxId: 'tax_id', customerBranch: 'branch', customerAddress: 'address' },
};

export default defineUi({
  module: 'sales',
  label: 'ขาย',
  glyph: 'ข',
  icon: 'receipt',
  statusLabels: PAY_LABELS,
  menu: [
    { label: 'ใบสั่งขาย', screen: 'soList' }, { label: 'สร้างใบสั่งขาย', screen: 'soNew' },
    { label: 'ใบกำกับ / ค้างชำระ', screen: 'invoices' }, { label: 'ใบเสร็จรับเงิน', screen: 'receipts' }, { label: 'รับมัดจำ', screen: 'depositNew' },
    { label: 'ลูกหนี้คงค้าง', screen: 'receivables' }, { label: 'อายุลูกหนี้', screen: 'aging' },
  ],
  commands: [
    { id: 'so', label: 'สร้างใบสั่งขาย', example: 'ขาย CUS-001', keywords: ['ขาย', 'สั่งขาย', 'เปิดบิล', 'so'], screen: 'soNew', perm: 'sales.order.write',
      arg: { lookup: { module: 'master-data', path: '/partners', query: { kind: 'customer' }, label: ['code', 'name'],
        assign: { customerId: 'id', customerName: 'name', customerTaxId: 'tax_id', customerBranch: 'branch', customerAddress: 'address' } } } },
    { id: 'receipt', label: 'รับชำระเงิน (ออกใบเสร็จ)', example: 'รับชำระ CUS-001', keywords: ['รับชำระ', 'รับเงิน', 'ใบเสร็จ', 'receipt'], screen: 'receiptNew', perm: 'sales.receipt.write',
      arg: { lookup: customerLookup } },
    { id: 'deposit', label: 'รับเงินมัดจำ', example: 'รับมัดจำ CUS-001', keywords: ['มัดจำ', 'รับมัดจำ', 'deposit'], screen: 'depositNew', perm: 'sales.receipt.write',
      arg: { lookup: customerLookup } },
    { id: 'overdue', label: 'ลูกหนี้เกินกำหนด', example: 'ลูกหนี้เกินกำหนด', keywords: ['ลูกหนี้', 'ค้างชำระ', 'เกินกำหนดชำระ', 'aging'], screen: 'aging', perm: 'sales.receivable.read' },
  ],
  search: [
    { id: 'orders', title: 'ใบสั่งขาย', endpoint: '/orders', label: ['no', 'customer_name', 'ref'], screen: 'soDetail', perm: 'sales.order.read' },
    { id: 'invoices', title: 'ใบกำกับภาษี', endpoint: '/invoices', label: ['no', 'customer_name'], screen: 'invoice', perm: 'sales.order.read' },
    { id: 'receipts', title: 'ใบเสร็จรับเงิน', endpoint: '/receipts', label: ['no', 'customer_name'], screen: 'receipt', perm: 'sales.receivable.read' },
  ],
  screens: {
    soList: {
      kind: 'list', title: 'ใบสั่งขาย', endpoint: '/orders', perm: 'sales.order.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาเลขที่ ลูกค้า หรือเลขอ้างอิง', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: statuses }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'ref', label: 'อ้างอิง' }, { key: 'order_date', label: 'วันที่', format: 'date' },
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
        { name: 'creditDays', label: 'เครดิต (วัน)', type: 'number', default: 0, help: 'วันครบกำหนดชำระ = วันที่ใบกำกับ + เครดิต' },
        { name: 'ref', label: 'เลขอ้างอิง (PO ลูกค้า / ใบเสนอราคา)', type: 'text' },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      lines: {
        name: 'lines', label: 'รายการขาย', min: 1,
        fields: [
          { name: 'itemId', label: 'สินค้า/บริการ', type: 'lookup', lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' } },
            help: 'เว้นว่างได้ถ้าเป็นค่าบริการ — พิมพ์คำอธิบายแทน (ไม่ตัดสต็อก)' },
          { name: 'description', label: 'คำอธิบาย', type: 'text' },
          { name: 'qty', label: 'จำนวน', type: 'number', required: true },
          { name: 'unitPrice', label: 'ราคาต่อหน่วย', type: 'number', step: 0.01, required: true },
          { name: 'discountPct', label: 'ส่วนลด %', type: 'number', step: 0.01 },
        ],
      },
      submitLabel: 'สร้างใบสั่งขาย', after: { screen: 'soDetail', idFrom: 'id' },
    },
    soDetail: {
      kind: 'detail', title: 'ใบสั่งขาย', endpoint: '/orders/:id', perm: 'sales.order.read', heading: 'no', mobile: true,
      flow: { field: 'status', steps: [{ value: 'draft', label: 'ร่าง' }, { value: 'confirmed', label: 'ยืนยัน' }, { value: 'delivered', label: 'ส่งของ' }, { value: 'invoiced', label: 'ออกใบกำกับ' }], exits: [{ value: 'cancelled', label: 'ยกเลิก' }] },
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'customer_tax_id', label: 'เลขผู้เสียภาษี' },
        { key: 'ref', label: 'อ้างอิง' }, { key: 'order_date', label: 'วันที่', format: 'date' }, { key: 'warehouse_code', label: 'ส่งจากคลัง' },
        { key: 'credit_days', label: 'เครดิต (วัน)', format: 'qty' },
        { key: 'subtotal', label: 'รวมก่อนส่วนลด', format: 'money' }, { key: 'discount', label: 'ส่วนลด', format: 'money' },
        { key: 'net', label: 'ก่อน VAT', format: 'money' }, { key: 'vat', label: 'VAT 7%', format: 'money' }, { key: 'gross', label: 'ยอดรวม', format: 'money' },
        { key: 'invoice_no', label: 'ใบกำกับ' }, { key: 'payment_status', label: 'การชำระ', format: 'status' }, { key: 'outstanding', label: 'ค้างชำระ', format: 'money' },
        { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [{
        path: 'lines', label: 'รายการ',
        columns: [
          { key: 'line_no', label: '#' }, { key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' }, { key: 'description', label: 'คำอธิบาย' },
          { key: 'qty', label: 'จำนวน', format: 'qty' }, { key: 'unit_price', label: 'ราคา/หน่วย', format: 'money' }, { key: 'discount_pct', label: 'ส่วนลด', format: 'percent' },
          { key: 'amount', label: 'จำนวนเงิน', format: 'money' },
        ],
      }, {
        path: 'deposits', label: 'เงินมัดจำ',
        columns: [{ key: 'no', label: 'ใบรับมัดจำ' }, { key: 'receipt_date', label: 'วันที่', format: 'date' }, { key: 'total', label: 'จำนวนเงิน', format: 'money' }, { key: 'deposit_remaining', label: 'คงเหลือ', format: 'money' }],
      }],
      actions: [
        { id: 'confirm', label: 'ยืนยันคำสั่งซื้อ', method: 'POST', endpoint: '/orders/:id/confirm', perm: 'sales.order.write', when: { field: 'status', in: ['draft'] }, tone: 'primary', mobile: true },
        { id: 'deliver', label: 'บันทึกส่งของ', method: 'POST', endpoint: '/orders/:id/deliver', perm: 'sales.order.deliver', when: { field: 'status', in: ['confirmed'] }, tone: 'primary', mobile: true },
        { id: 'invoice', label: 'ออกใบกำกับภาษี', method: 'POST', endpoint: '/orders/:id/invoice', perm: 'sales.invoice.write', when: { field: 'status', in: ['confirmed', 'delivered'] }, tone: 'primary',
          fields: [{ name: 'issueDate', label: 'วันที่ใบกำกับ', type: 'date' }, { name: 'dueDate', label: 'ครบกำหนดชำระ (ว่าง = ตามเครดิต)', type: 'date' }], then: { screen: 'invoice', idFrom: 'id' } },
        { id: 'cancel', label: 'ยกเลิกใบสั่งขาย', method: 'POST', endpoint: '/orders/:id/cancel', perm: 'sales.order.write', when: { field: 'status', in: ['draft', 'confirmed'] }, confirm: 'ยกเลิกแล้วแก้กลับไม่ได้', tone: 'danger' },
      ],
    },
    invoice: {
      kind: 'detail', title: 'ใบกำกับภาษี', endpoint: '/invoices/:id', perm: 'sales.order.read', heading: 'no',
      print: { title: 'ใบกำกับภาษี / ใบแจ้งหนี้', legal: 'tax-invoice', copyLabel: true, signatures: ['ผู้รับเงิน', 'ผู้มีอำนาจลงนาม'] },
      fields: [
        { key: 'issueDateTh', label: 'วันที่' }, { key: 'orderNo', label: 'อ้างอิงใบสั่งขาย' }, { key: 'orderRef', label: 'อ้างอิง' },
        { key: 'dueDateTh', label: 'ครบกำหนดชำระ' },
        { key: 'customer.name', label: 'ลูกค้า' }, { key: 'customer.taxId', label: 'เลขประจำตัวผู้เสียภาษี' },
        { key: 'customer.branch', label: 'สาขา' }, { key: 'customer.address', label: 'ที่อยู่' },
        { key: 'subtotal', label: 'รวมก่อนส่วนลด', format: 'money' }, { key: 'discount', label: 'ส่วนลด', format: 'money' },
        { key: 'net', label: 'มูลค่าสินค้า', format: 'money' }, { key: 'vat', label: 'ภาษีมูลค่าเพิ่ม 7%', format: 'money' },
        { key: 'gross', label: 'รวมทั้งสิ้น', format: 'money' }, { key: 'amountText', label: 'ตัวอักษร' },
        { key: 'payment_status', label: 'การชำระ', format: 'status' }, { key: 'outstanding', label: 'ค้างชำระ', format: 'money' },
        { key: 'promptPay', label: 'ชำระด้วยพร้อมเพย์', format: 'qr' },
      ],
      lines: [{
        path: 'lines', label: 'รายการ',
        columns: [
          { key: 'line_no', label: '#' }, { key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'รายการ' }, { key: 'description', label: 'คำอธิบาย' },
          { key: 'qty', label: 'จำนวน', format: 'qty' }, { key: 'unit_price', label: 'ราคา/หน่วย', format: 'money' }, { key: 'discount_pct', label: 'ส่วนลด', format: 'percent' },
          { key: 'amount', label: 'จำนวนเงิน', format: 'money' },
        ],
      }, {
        path: 'receipts', label: 'รับชำระแล้ว',
        columns: [{ key: 'no', label: 'ใบเสร็จ' }, { key: 'receipt_date', label: 'วันที่', format: 'date' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' }],
      }],
    },
    invoices: {
      kind: 'list', title: 'ใบกำกับภาษี / ค้างชำระ', endpoint: '/invoices', perm: 'sales.order.read', mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่ ลูกค้า หรืออ้างอิง', type: 'text' },
        { name: 'status', label: 'การชำระ', type: 'select', options: payStatuses },
        { name: 'overdue', label: 'เฉพาะเกินกำหนด', type: 'boolean' },
      ],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'issue_date', label: 'วันที่', format: 'date' },
        { key: 'due_date', label: 'ครบกำหนด', format: 'date' }, { key: 'days_overdue', label: 'เกินกำหนด (วัน)', format: 'qty' },
        { key: 'gross', label: 'ยอดรวม', format: 'money' }, { key: 'outstanding', label: 'ค้างชำระ', format: 'money' }, { key: 'payment_status', label: 'การชำระ', format: 'status' },
      ],
      rowLink: { screen: 'invoice' }, empty: 'ยังไม่มีใบกำกับภาษี',
    },
    receipts: {
      kind: 'list', title: 'ใบเสร็จรับเงิน / มัดจำ', endpoint: '/receipts', perm: 'sales.receivable.read', mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่ ลูกค้า หรือเลขอ้างอิงการโอน', type: 'text' },
        { name: 'kind', label: 'ประเภท', type: 'select', options: [{ value: 'payment', label: 'รับชำระ' }, { value: 'deposit', label: 'มัดจำ' }] },
        { name: 'open', label: 'มัดจำที่ยังไม่ได้ใช้', type: 'boolean' },
      ],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'kind_label', label: 'ประเภท' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'receipt_date', label: 'วันที่', format: 'date' },
        { key: 'method_label', label: 'ชำระโดย' }, { key: 'total', label: 'ยอด', format: 'money' }, { key: 'wht_amount', label: 'หัก ณ ที่จ่าย', format: 'money' },
        { key: 'received', label: 'รับจริง', format: 'money' }, { key: 'deposit_remaining', label: 'มัดจำคงเหลือ', format: 'money' },
      ],
      create: 'receiptNew', createLabel: 'รับชำระ', rowLink: { screen: 'receipt' }, empty: 'ยังไม่มีใบเสร็จ',
    },
    receiptNew: {
      kind: 'form', title: 'รับชำระเงิน (ใบเสร็จรับเงิน)', method: 'POST', endpoint: '/receipts', perm: 'sales.receipt.write',
      fields: [
        { name: 'customerId', label: 'ลูกค้า (ว่าง = ตามใบกำกับ)', type: 'lookup', lookup: customerLookup },
        { name: 'receiptDate', label: 'วันที่รับเงิน', type: 'date' },
        { name: 'method', label: 'ชำระโดย', type: 'select', default: 'transfer', required: true, options: methods },
        { name: 'reference', label: 'เลขที่เช็ค / อ้างอิงการโอน', type: 'text' },
        { name: 'whtPct', label: 'หัก ณ ที่จ่าย', type: 'select', default: '0', options: whtRates, help: 'คิดจากยอดก่อน VAT ของส่วนที่รับชำระ' },
        { name: 'applyDepositId', label: 'ใช้เงินมัดจำ', type: 'lookup',
          lookup: { path: '/receipts', query: { kind: 'deposit', open: '1' }, label: ['no', 'customer_name', 'deposit_remaining'], assign: { applyDepositId: 'id' } } },
        { name: 'applyDepositAmount', label: 'ใช้มัดจำ (บาท, ว่าง = เท่าที่ใช้ได้)', type: 'number', step: 0.01 },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      lines: {
        name: 'lines', label: 'ใบกำกับที่รับชำระ', min: 1,
        fields: [
          { name: 'invoiceId', label: 'ใบกำกับ', type: 'lookup', required: true,
            lookup: { path: '/invoices', query: { status: 'open' }, label: ['no', 'customer_name', 'outstanding'], assign: { invoiceId: 'id', amount: 'outstanding' } } },
          { name: 'amount', label: 'รับชำระ (รวม VAT)', type: 'number', step: 0.01, required: true },
        ],
      },
      submitLabel: 'ออกใบเสร็จ', after: { screen: 'receipt', idFrom: 'id' },
    },
    depositNew: {
      kind: 'form', title: 'รับเงินมัดจำ', method: 'POST', endpoint: '/receipts', perm: 'sales.receipt.write',
      fields: [
        { name: 'orderId', label: 'ใบสั่งขาย', type: 'lookup', lookup: { path: '/orders', label: ['no', 'customer_name', 'ref'], assign: { orderId: 'id' } }, help: 'ลูกค้าจะเติมจากใบสั่งขาย' },
        { name: 'customerId', label: 'ลูกค้า (ถ้าไม่มีใบสั่งขาย)', type: 'lookup', lookup: customerLookup },
        { name: 'depositAmount', label: 'จำนวนเงินมัดจำ', type: 'number', step: 0.01, required: true },
        { name: 'receiptDate', label: 'วันที่รับเงิน', type: 'date' },
        { name: 'method', label: 'ชำระโดย', type: 'select', default: 'transfer', required: true, options: methods },
        { name: 'reference', label: 'เลขที่เช็ค / อ้างอิงการโอน', type: 'text' },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      submitLabel: 'ออกใบรับมัดจำ', after: { screen: 'receipt', idFrom: 'id' },
    },
    receipt: {
      kind: 'detail', title: 'ใบเสร็จรับเงิน', endpoint: '/receipts/:id', perm: 'sales.receivable.read', heading: 'no', mobile: true,
      print: { title: 'ใบเสร็จรับเงิน', legal: 'receipt', copyLabel: true, signatures: ['ผู้รับเงิน', 'ผู้จ่ายเงิน'] },
      fields: [
        { key: 'title', label: 'เอกสาร' }, { key: 'receiptDateTh', label: 'วันที่' },
        { key: 'customer.name', label: 'ได้รับเงินจาก' }, { key: 'customer.taxId', label: 'เลขประจำตัวผู้เสียภาษี' },
        { key: 'customer.branch', label: 'สาขา' }, { key: 'customer.address', label: 'ที่อยู่' }, { key: 'orderNo', label: 'อ้างอิงใบสั่งขาย' },
        { key: 'methodLabel', label: 'ชำระโดย' }, { key: 'reference', label: 'เลขที่เช็ค / อ้างอิง' },
        { key: 'total', label: 'จำนวนเงิน', format: 'money' }, { key: 'amountText', label: 'ตัวอักษร' },
        { key: 'wht_amount', label: 'หัก ณ ที่จ่าย', format: 'money' }, { key: 'deposit_applied', label: 'หักเงินมัดจำ', format: 'money' },
        { key: 'received', label: 'รับเงินสุทธิ', format: 'money' }, { key: 'receivedText', label: 'รับสุทธิ (ตัวอักษร)' },
        { key: 'deposit_remaining', label: 'มัดจำคงเหลือ', format: 'money' }, { key: 'created_by_name', label: 'ผู้รับเงิน' }, { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [{
        path: 'lines', label: 'ใบกำกับที่ชำระ',
        columns: [
          { key: 'line_no', label: '#' }, { key: 'invoice_no', label: 'ใบกำกับ' }, { key: 'issue_date', label: 'ลงวันที่', format: 'date' },
          { key: 'invoice_gross', label: 'ยอดใบกำกับ', format: 'money' }, { key: 'wht_base', label: 'ฐานภาษีหัก ณ ที่จ่าย', format: 'money' }, { key: 'amount', label: 'รับชำระ', format: 'money' },
        ],
      }, {
        path: 'deposits', label: 'เงินมัดจำที่นำมาหัก',
        columns: [{ key: 'deposit_no', label: 'ใบรับมัดจำ' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' }],
      }],
    },
    receivables: {
      kind: 'list', title: 'ลูกหนี้คงค้างตามลูกค้า', endpoint: '/receivables', rows: 'rows', perm: 'sales.receivable.read', mobile: true,
      filters: [{ name: 'asOf', label: 'ณ วันที่', type: 'date' }],
      columns: [
        { key: 'customer_name', label: 'ลูกค้า' }, { key: 'invoices', label: 'ใบกำกับค้าง', format: 'qty' }, { key: 'outstanding', label: 'ค้างชำระ', format: 'money' },
        { key: 'overdue', label: 'เกินกำหนด', format: 'money' }, { key: 'max_days_overdue', label: 'ค้างนานสุด (วัน)', format: 'qty' },
        { key: 'deposits', label: 'มัดจำคงเหลือ', format: 'money' }, { key: 'net_outstanding', label: 'สุทธิ', format: 'money' },
      ],
      empty: 'ไม่มีลูกหนี้คงค้าง',
    },
    aging: {
      kind: 'list', title: 'อายุลูกหนี้ (ตามวันครบกำหนด)', endpoint: '/receivables/aging', rows: 'rows', perm: 'sales.receivable.read',
      filters: [{ name: 'asOf', label: 'ณ วันที่', type: 'date' }],
      columns: [
        { key: 'customer_name', label: 'ลูกค้า' }, { key: 'current', label: 'ยังไม่ครบกำหนด', format: 'money' }, { key: 'd1_30', label: '1–30 วัน', format: 'money' },
        { key: 'd31_60', label: '31–60 วัน', format: 'money' }, { key: 'd61_90', label: '61–90 วัน', format: 'money' }, { key: 'over_90', label: 'เกิน 90 วัน', format: 'money' },
        { key: 'total', label: 'รวม', format: 'money' },
      ],
      empty: 'ไม่มีลูกหนี้คงค้าง',
    },
  },
  widgets: [
    { id: 'so-kpi', kind: 'kpi', title: 'ขาย', endpoint: '/summary', perm: 'sales.order.read', size: 'sm', href: 'soList',
      items: [{ key: 'toDeliver', label: 'รอส่งของ', format: 'qty', tone: 'warn' }, { key: 'toInvoice', label: 'รอออกใบกำกับ', format: 'qty' }, { key: 'revenueMonth', label: 'ยอดขายเดือนนี้', format: 'money', tone: 'ok' }] },
    { id: 'ar-kpi', kind: 'kpi', title: 'ลูกหนี้', endpoint: '/summary', perm: 'sales.receivable.read', size: 'sm', href: 'aging',
      items: [{ key: 'outstanding', label: 'ค้างรับทั้งหมด', format: 'money' }, { key: 'overdue', label: 'เกินกำหนดชำระ', format: 'money', tone: 'stop' }, { key: 'receivedMonth', label: 'รับเงินเดือนนี้', format: 'money', tone: 'ok' }] },
    { id: 'so-trend', kind: 'trend', title: 'ยอดขาย 6 เดือน', endpoint: '/summary', perm: 'sales.order.read', size: 'md', href: 'soList', rows: 'months', x: 'month', y: 'total', format: 'money' },
  ],
});
