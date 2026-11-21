import { defineUi, OPENING_PARTNER_RESOLVE, openingDocColumns, STATUS_TH, type Action, type Column, type DetailScreen, type ListScreen } from '@erp/ui-schema';
import { NOTE_SECTION, NOTE_TITLE, reasonOptions, type NoteKind } from './notes.ts';

const statuses = ['draft', 'confirmed', 'delivered', 'invoiced', 'cancelled'].map((v) => ({ value: v, label: STATUS_TH[v] }));
const PAY_LABELS = { outstanding: 'ค้างชำระ', partially_paid: 'ชำระบางส่วน', paid: 'ชำระครบ', credited: 'ลดหนี้เต็มจำนวน' };
const payStatuses = [{ value: 'open', label: 'ยังไม่ครบ' }, ...Object.entries(PAY_LABELS).map(([value, label]) => ({ value, label }))];
const methods = [{ value: 'transfer', label: 'โอนเงิน' }, { value: 'cash', label: 'เงินสด' }, { value: 'cheque', label: 'เช็ค' }, { value: 'card', label: 'บัตรเครดิต' }];
const whtRates = [{ value: '0', label: 'ไม่มี' }, { value: '1', label: '1% (ค่าขนส่ง)' }, { value: '2', label: '2% (ค่าโฆษณา)' }, { value: '3', label: '3% (ค่าบริการ/จ้างทำของ)' }, { value: '5', label: '5% (ค่าเช่า)' }];
const customerLookup = {
  module: 'master-data', path: '/partners', query: { kind: 'customer' }, label: ['code', 'name'],
  assign: { customerId: 'id', customerName: 'name', customerTaxId: 'tax_id', customerBranch: 'branch', customerAddress: 'address', customerEmail: 'email' },
};

/* ---- wave 9: credit / debit notes (ใบลดหนี้ มาตรา 86/10, ใบเพิ่มหนี้ มาตรา 86/9) ---- */
const notePath = (kind: NoteKind) => (kind === 'credit' ? '/credit-notes' : '/debit-notes');
const noteScreen = (kind: NoteKind) => (kind === 'credit' ? 'creditNote' : 'debitNote');

/** "ออกใบลดหนี้" / "ออกใบเพิ่มหนี้" on the tax invoice: the invoice is the route's :id, lines refer to its lines by # */
function noteAction(kind: NoteKind): Action {
  const credit = kind === 'credit';
  return {
    id: `${kind}Note`, label: `ออก${NOTE_TITLE[kind]}`, method: 'POST', endpoint: `/invoices/:id${notePath(kind)}`, perm: 'sales.note.write',
    when: { field: 'payment_status', in: credit ? ['outstanding', 'partially_paid', 'paid'] : ['outstanding', 'partially_paid', 'paid', 'credited'] },
    fields: [
      { name: 'reasonCode', label: `เหตุผลการออก${NOTE_TITLE[kind]} (มาตรา ${credit ? '82/10' : '82/9'})`, type: 'select', required: true, options: reasonOptions(kind) },
      { name: 'reasonText', label: 'คำอธิบายเพิ่มเติม (พิมพ์ต่อท้ายเหตุผล)', type: 'text', help: 'จำเป็นเมื่อเลือก "เหตุอื่นตามที่อธิบดีกำหนด"' },
      { name: 'issueDate', label: `วันที่${NOTE_TITLE[kind]} (ว่าง = วันนี้)`, type: 'date', help: `ลด/เพิ่มภาษีขายในเดือนที่ออก${NOTE_TITLE[kind]} — ไม่ใช่เดือนของใบกำกับเดิม` },
      { name: 'amount', label: `จำนวนเงินผลต่าง (ว่าง = คิดจากรายการด้านล่าง)`, type: 'number', step: 0.01,
        help: 'ตามราคาของใบกำกับเดิม: ใบสั่งขายแบบยังไม่รวม VAT = ก่อน VAT, แบบรวม VAT = รวม VAT แล้ว — ระบบคิด VAT ของผลต่างให้' },
      ...(credit ? [{ name: 'warehouseCode', label: 'รับคืนเข้าคลัง (ว่าง = คลังที่ส่งของ)', type: 'text' as const }] : []),
      { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
    ],
    lines: {
      name: 'lines', label: credit ? 'รายการที่ลดหนี้ / รับคืน' : 'รายการที่เพิ่มหนี้',
      fields: [
        { name: 'lineNo', label: 'ลำดับรายการในใบกำกับ (#)', type: 'number', help: 'ว่าง = รายการอื่น (พิมพ์คำอธิบายและราคา)' },
        { name: 'description', label: 'คำอธิบาย (ว่าง = ตามใบกำกับ)', type: 'text' },
        { name: 'qty', label: 'จำนวน (ว่าง = ทั้งรายการ)', type: 'number' },
        { name: 'unitPrice', label: credit ? 'ราคาต่อหน่วยที่ลด (ว่าง = ตามใบกำกับ)' : 'ราคาต่อหน่วยที่เพิ่ม (ว่าง = ตามใบกำกับ)', type: 'number', step: 0.01 },
        ...(credit ? [{ name: 'returnToStock', label: 'รับสินค้าคืนเข้าคลัง', type: 'boolean' as const }] : []),
      ],
    },
    tone: 'default', then: { screen: noteScreen(kind), idFrom: 'id' },
  };
}

function noteList(kind: NoteKind): ListScreen {
  return {
    kind: 'list', title: NOTE_TITLE[kind], endpoint: notePath(kind), perm: 'sales.note.read',
    filters: [{ name: 'q', label: 'ค้นหาเลขที่ เลขที่ใบกำกับ หรือลูกค้า', type: 'text' }],
    columns: [
      { key: 'no', label: 'เลขที่' }, { key: 'issue_date', label: 'วันที่', format: 'date' }, { key: 'invoice_no', label: 'ใบกำกับภาษีเดิม' },
      { key: 'customer_name', label: 'ลูกค้า' }, { key: 'reason', label: 'เหตุผล', phone: false },
      { key: 'net', label: 'ผลต่าง (ก่อน VAT)', format: 'money', total: true }, { key: 'vat', label: 'VAT', format: 'money', total: true },
      { key: 'gross', label: 'รวม', format: 'money', total: true },
    ],
    rowLink: { screen: noteScreen(kind) },
    empty: `ยังไม่มี${NOTE_TITLE[kind]} — ออกจากหน้าใบกำกับภาษี (ปุ่ม "ออก${NOTE_TITLE[kind]}")`,
  };
}

/** The printed ใบลดหนี้ / ใบเพิ่มหนี้: every item มาตรา 86/10 (86/9) requires, buyer block from `customer`, seller from the company profile. */
function noteDetail(kind: NoteKind): DetailScreen {
  const credit = kind === 'credit';
  const lineCols: Column[] = [
    { key: 'line_no', label: '#' }, { key: 'item_code', label: 'รหัส' }, { key: 'description', label: 'รายการ' },
    { key: 'qty', label: 'จำนวน', format: 'qty' }, { key: 'unit_price', label: credit ? 'ราคาที่ลด/หน่วย' : 'ราคาที่เพิ่ม/หน่วย', format: 'money' },
    { key: 'amount', label: 'จำนวนเงิน', format: 'money', total: true },
  ];
  if (credit) lineCols.push({ key: 'return_to_stock', label: 'รับคืนเข้าคลัง', format: 'qty' });
  return {
    kind: 'detail', title: NOTE_TITLE[kind], endpoint: `${notePath(kind)}/:id`, perm: 'sales.note.read', heading: 'no',
    print: { title: NOTE_TITLE[kind], legal: 'tax-invoice', footer: false, copyLabel: true,
      signatures: [credit ? 'ผู้รับใบลดหนี้ / ผู้คืนสินค้า' : 'ผู้รับใบเพิ่มหนี้', { label: 'ผู้มีอำนาจลงนาม' }] },
    fields: [
      { key: 'issueDateTh', label: 'วันที่' },
      { key: 'customer.name', label: 'ลูกค้า' }, { key: 'customer.taxId', label: 'เลขประจำตัวผู้เสียภาษี' },
      { key: 'customer.branch', label: 'สาขา' }, { key: 'customer.address', label: 'ที่อยู่' },
      { key: 'invoice_no', label: 'อ้างอิงใบกำกับภาษีเลขที่', section: 'ใบกำกับภาษีเดิม' }, { key: 'invoiceDateTh', label: 'ลงวันที่' },
      { key: 'original_net', label: 'มูลค่าสินค้า/บริการตามใบกำกับภาษีเดิม', format: 'money', section: 'มูลค่า (ก่อนภาษีมูลค่าเพิ่ม)' },
      { key: 'correct_net', label: 'มูลค่าที่ถูกต้อง', format: 'money' },
      { key: 'net', label: credit ? 'ผลต่าง (ลดลง)' : 'ผลต่าง (เพิ่มขึ้น)', format: 'money' },
      { key: 'vat', label: 'ภาษีมูลค่าเพิ่มของผลต่าง', format: 'money' },
      { key: 'gross', label: credit ? 'รวมเงินที่ลดหนี้' : 'รวมเงินที่เพิ่มหนี้', format: 'money', emphasis: true },
      { key: 'amountText', label: 'ตัวอักษร' },
      { key: 'reason', label: `เหตุผลการออก${NOTE_TITLE[kind]}`, section: 'เหตุผล' },
      { key: 'priceBasis', label: 'ราคาในรายการ' },
      ...(credit ? [{ key: 'returned', label: 'สินค้ารับคืน' }] : []),
      { key: 'note', label: 'หมายเหตุ' },
      { key: 'legalText', label: `ตามมาตรา ${NOTE_SECTION[kind]}` },
      { key: 'created_by_name', label: 'ผู้ออกเอกสาร' },
      { key: 'invoiceOutstanding', label: 'ยอดค้างชำระของใบกำกับ (หลังปรับ)', format: 'money', print: false },
      { key: 'invoicePaymentStatus', label: 'สถานะการชำระของใบกำกับ', format: 'status' },
    ],
    lines: [{ path: 'lines', label: credit ? 'รายการที่ลดหนี้' : 'รายการที่เพิ่มหนี้', columns: lineCols }],
  };
}

export default defineUi({
  module: 'sales',
  label: 'ขาย',
  glyph: 'ข',
  icon: 'receipt',
  statusLabels: PAY_LABELS,
  menu: [
    { label: 'ใบสั่งขาย', screen: 'soList' }, { label: 'สร้างใบสั่งขาย', screen: 'soNew' },
    { label: 'ใบกำกับ / ค้างชำระ', screen: 'invoices' }, { label: 'ใบเสร็จรับเงิน', screen: 'receipts' }, { label: 'รับมัดจำ', screen: 'depositNew' },
    { label: 'ลูกหนี้คงค้าง', screen: 'receivables' }, { label: 'อายุลูกหนี้', screen: 'aging' }, { label: 'ลูกหนี้ยกมา', screen: 'openingInvoices' },
    { label: 'ใบลดหนี้', screen: 'creditNotes' }, { label: 'ใบเพิ่มหนี้', screen: 'debitNotes' },
    { label: 'วันที่ปิดงวด', screen: 'lockSettings' },
  ],
  commands: [
    { id: 'so', label: 'สร้างใบสั่งขาย', example: 'ขาย CUS-001', keywords: ['ขาย', 'สั่งขาย', 'เปิดบิล', 'so'], screen: 'soNew', perm: 'sales.order.write',
      arg: { lookup: { module: 'master-data', path: '/partners', query: { kind: 'customer' }, label: ['code', 'name'],
        assign: { customerId: 'id', customerName: 'name', customerTaxId: 'tax_id', customerBranch: 'branch', customerAddress: 'address', customerEmail: 'email' } } } },
    { id: 'receipt', label: 'รับชำระเงิน (ออกใบเสร็จ)', example: 'รับชำระ CUS-001', keywords: ['รับชำระ', 'รับเงิน', 'ใบเสร็จ', 'receipt'], screen: 'receiptNew', perm: 'sales.receipt.write',
      arg: { lookup: customerLookup } },
    { id: 'deposit', label: 'รับเงินมัดจำ', example: 'รับมัดจำ CUS-001', keywords: ['มัดจำ', 'รับมัดจำ', 'deposit'], screen: 'depositNew', perm: 'sales.receipt.write',
      arg: { lookup: customerLookup } },
    { id: 'overdue', label: 'ลูกหนี้เกินกำหนด', example: 'ลูกหนี้เกินกำหนด', keywords: ['ลูกหนี้', 'ค้างชำระ', 'เกินกำหนดชำระ', 'aging'], screen: 'aging', perm: 'sales.receivable.read' },
  ],
  search: [
    { id: 'orders', title: 'ใบสั่งขาย', endpoint: '/orders', label: ['no', 'customer_name', 'ref'], screen: 'soDetail', perm: 'sales.order.read' },
    { id: 'invoices', title: 'ใบกำกับภาษี', endpoint: '/invoices', query: { kind: 'sale' }, label: ['no', 'customer_name'], screen: 'invoice', perm: 'sales.order.read' },
    { id: 'openingInvoices', title: 'ลูกหนี้ยกมา', endpoint: '/invoices', query: { kind: 'opening' }, label: ['no', 'customer_name'], screen: 'openingInvoice', perm: 'sales.order.read' },
    { id: 'receipts', title: 'ใบเสร็จรับเงิน', endpoint: '/receipts', label: ['no', 'customer_name'], screen: 'receipt', perm: 'sales.receivable.read' },
    { id: 'creditNotes', title: 'ใบลดหนี้', endpoint: '/credit-notes', label: ['no', 'customer_name', 'invoice_no'], screen: 'creditNote', perm: 'sales.note.read' },
    { id: 'debitNotes', title: 'ใบเพิ่มหนี้', endpoint: '/debit-notes', label: ['no', 'customer_name', 'invoice_no'], screen: 'debitNote', perm: 'sales.note.read' },
  ],
  screens: {
    creditNotes: noteList('credit'),
    debitNotes: noteList('debit'),
    creditNote: noteDetail('credit'),
    debitNote: noteDetail('debit'),
    /** wave 8 (C5): lock date — moves forward automatically when Accounting closes a period */
    lockSettings: {
      kind: 'form', title: 'วันที่ปิดงวดเอกสารขาย', method: 'POST', endpoint: '/lock', perm: 'sales.lock.write', load: '/lock',
      fields: [
        { name: 'lockDate', label: 'ปิดงวดถึงวันที่', type: 'date',
          help: 'ใบกำกับภาษี ใบเสร็จ และใบรับมัดจำ ที่ลงวันที่ถึงวันนี้จะออกไม่ได้ (ยกเว้นผู้มีสิทธิ์ข้ามการปิดงวดระบุเหตุผล) · เลื่อนอัตโนมัติเมื่อฝ่ายบัญชีปิดงวด' },
      ],
      submitLabel: 'บันทึกวันที่ปิดงวด', after: { screen: 'invoices' },
    },
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
            assign: { customerId: 'id', customerName: 'name', customerTaxId: 'tax_id', customerBranch: 'branch', customerAddress: 'address', customerEmail: 'email' } } },
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
        { id: 'deliver', label: 'บันทึกส่งของ', method: 'POST', endpoint: '/orders/:id/deliver', perm: 'sales.order.deliver', when: { field: 'status', in: ['confirmed'] }, tone: 'primary', mobile: true, impact: true },
        { id: 'invoice', label: 'ออกใบกำกับภาษี', method: 'POST', endpoint: '/orders/:id/invoice', perm: 'sales.invoice.write', when: { field: 'status', in: ['confirmed', 'delivered'] }, tone: 'primary',
          fields: [{ name: 'issueDate', label: 'วันที่ใบกำกับ', type: 'date' }, { name: 'dueDate', label: 'ครบกำหนดชำระ (ว่าง = ตามเครดิต)', type: 'date' }], then: { screen: 'invoice', idFrom: 'id' } },
        { id: 'cancel', label: 'ยกเลิกใบสั่งขาย', method: 'POST', endpoint: '/orders/:id/cancel', perm: 'sales.order.write', when: { field: 'status', in: ['draft', 'confirmed'] }, confirm: 'ยกเลิกแล้วแก้กลับไม่ได้', tone: 'danger' },
      ],
    },
    invoice: {
      kind: 'detail', title: 'ใบกำกับภาษี', endpoint: '/invoices/:id', perm: 'sales.order.read', heading: 'no',
      print: { title: 'ใบกำกับภาษี / ใบแจ้งหนี้', legal: 'tax-invoice', copyLabel: true, footer: 'payment', signatures: ['ผู้รับสินค้า / ผู้รับบริการ', 'ผู้มีอำนาจลงนาม'] },
      fields: [
        { key: 'issueDateTh', label: 'วันที่' }, { key: 'orderNo', label: 'อ้างอิงใบสั่งขาย' }, { key: 'orderRef', label: 'อ้างอิง' },
        { key: 'dueDateTh', label: 'ครบกำหนดชำระ' },
        { key: 'customer.name', label: 'ลูกค้า' }, { key: 'customer.taxId', label: 'เลขประจำตัวผู้เสียภาษี' },
        { key: 'customer.branch', label: 'สาขา' }, { key: 'customer.address', label: 'ที่อยู่' },
        { key: 'subtotal', label: 'รวมก่อนส่วนลด', format: 'money' }, { key: 'discount', label: 'ส่วนลด', format: 'money' },
        { key: 'net', label: 'มูลค่าสินค้า', format: 'money' }, { key: 'vat', label: 'ภาษีมูลค่าเพิ่ม 7%', format: 'money' },
        { key: 'gross', label: 'รวมทั้งสิ้น', format: 'money' }, { key: 'amountText', label: 'ตัวอักษร' },
        { key: 'payment_status', label: 'การชำระ', format: 'status' },
        // wave 9: notes change what is owed, never the printed invoice
        { key: 'credit_total', label: 'ใบลดหนี้ (รวม)', format: 'money', print: false, hideZero: true },
        { key: 'debit_total', label: 'ใบเพิ่มหนี้ (รวม)', format: 'money', print: false, hideZero: true },
        { key: 'outstanding', label: 'ค้างชำระ', format: 'money', print: false },
        { key: 'promptPay', label: 'ชำระด้วยพร้อมเพย์', format: 'qr' },
      ],
      actions: [noteAction('credit'), noteAction('debit')],
      lines: [{
        path: 'lines', label: 'รายการ',
        columns: [
          { key: 'line_no', label: '#' }, { key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'รายการ' }, { key: 'description', label: 'คำอธิบาย' },
          { key: 'qty', label: 'จำนวน', format: 'qty' }, { key: 'unit_price', label: 'ราคา/หน่วย', format: 'money' }, { key: 'discount_pct', label: 'ส่วนลด', format: 'percent' },
          { key: 'amount', label: 'จำนวนเงิน', format: 'money' },
        ],
      }, {
        path: 'receipts', label: 'รับชำระแล้ว', print: false,
        columns: [{ key: 'no', label: 'ใบเสร็จ' }, { key: 'receipt_date', label: 'วันที่', format: 'date' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' }],
      }, {
        path: 'notes', label: 'ใบลดหนี้ / ใบเพิ่มหนี้', print: false,
        columns: [{ key: 'no', label: 'เลขที่' }, { key: 'kind_label', label: 'ประเภท' }, { key: 'issue_date', label: 'วันที่', format: 'date' }, { key: 'reason', label: 'เหตุผล' },
          { key: 'net', label: 'ผลต่าง', format: 'money' }, { key: 'vat', label: 'VAT', format: 'money' }, { key: 'gross', label: 'รวม', format: 'money' }],
      }],
    },
    openingInvoices: {
      kind: 'list', title: 'ลูกหนี้ยกมา', endpoint: '/opening-receivables', perm: 'sales.receivable.read',
      filters: [{ name: 'q', label: 'ค้นหาเลขที่หรือลูกค้า', type: 'text' }],
      columns: [
        { key: 'no', label: 'เลขที่เดิม' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'issue_date', label: 'วันที่', format: 'date' },
        { key: 'due_date', label: 'ครบกำหนด', format: 'date' }, { key: 'days_overdue', label: 'เกินกำหนด (วัน)', format: 'qty' },
        { key: 'gross', label: 'ยอดยกมา', format: 'money' }, { key: 'outstanding', label: 'ค้างชำระ', format: 'money' }, { key: 'payment_status', label: 'การชำระ', format: 'status' },
      ],
      rowLink: { screen: 'openingInvoice' },
      empty: 'ยังไม่มีลูกหนี้ยกมา — นำเข้าใบแจ้งหนี้ที่ยังค้างจากโปรแกรมเดิมด้วยไฟล์ Excel',
      import: {
        endpoint: '/opening-receivables/import', perm: 'sales.invoice.write', template: 'แบบฟอร์มลูกหนี้ยกมา.csv',
        note: 'ใบแจ้งหนี้ที่ลูกค้ายังค้างในโปรแกรมเดิม ณ วันเริ่มใช้ — ไม่เข้ารายงานภาษีขายและไม่ลงรายได้ซ้ำ (ยอดลูกหนี้ในบัญชีใช้การยกยอดของโมดูลบัญชี) · รับชำระด้วยใบเสร็จได้ตามปกติ · เลขที่ซ้ำกับที่มีอยู่จะไม่นำเข้า',
        columns: openingDocColumns('customer'), resolve: OPENING_PARTNER_RESOLVE,
      },
    },
    openingInvoice: {
      kind: 'detail', title: 'ลูกหนี้ยกมา', endpoint: '/invoices/:id', perm: 'sales.order.read', heading: 'no',
      fields: [
        { key: 'kind_label', label: 'ประเภท' }, { key: 'customer.code', label: 'รหัสลูกค้า' }, { key: 'customer.name', label: 'ลูกค้า' },
        { key: 'issueDateTh', label: 'วันที่เอกสารเดิม' }, { key: 'dueDateTh', label: 'ครบกำหนดชำระ' },
        { key: 'gross', label: 'ยอดยกมา', format: 'money' }, { key: 'paid_amount', label: 'รับชำระแล้ว', format: 'money' },
        { key: 'outstanding', label: 'ค้างชำระ', format: 'money' }, { key: 'payment_status', label: 'การชำระ', format: 'status' },
        { key: 'opening_note', label: 'หมายเหตุ' },
      ],
      lines: [{
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
      // ลูกหนี้ยกมา is not a tax invoice of this system: it opens (and never prints) as one
      rowLink: { screen: 'invoice', byField: { field: 'kind', screens: { opening: 'openingInvoice' } } }, empty: 'ยังไม่มีใบกำกับภาษี',
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
        { name: 'whtPct', label: 'หัก ณ ที่จ่าย', type: 'select', default: '0', options: whtRates, help: 'คิดจากฐานหัก ณ ที่จ่ายของแต่ละใบกำกับ (ค่าบริการก่อน VAT) — ขายสินค้าโดยทั่วไปไม่อยู่ในบังคับหัก ณ ที่จ่าย' },
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
          { name: 'whtBase', label: 'ฐานหัก ณ ที่จ่าย (ก่อน VAT)', type: 'number', step: 0.01,
            help: 'ตามหนังสือรับรอง 50 ทวิ ของลูกค้า — ว่าง = เฉพาะค่าบริการในใบกำกับ (ถ้าไม่มีรายการบริการ = ยอดก่อน VAT ทั้งหมด)' },
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
        { key: 'deposit_remaining', label: 'มัดจำคงเหลือ', format: 'money', print: false }, { key: 'created_by_name', label: 'ผู้รับเงิน' }, { key: 'note', label: 'หมายเหตุ' },
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
        { key: 'credit_balance', label: 'เครดิตจากใบลดหนี้', format: 'money' },
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
        { key: 'total', label: 'รวม', format: 'money' }, { key: 'credit_balance', label: 'เครดิตจากใบลดหนี้ (ไม่นับอายุ)', format: 'money' },
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
