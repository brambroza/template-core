import { defineUi, OPENING_PARTNER_RESOLVE, openingDocColumns, STATUS_TH } from '@erp/ui-schema';

/* wave 9: supplier bills, payments with WHT, 50 ทวิ, ภ.ง.ด.3/53 */
/** WHT income types — must match @erp/thai WHT_INCOME_TYPES (test/wht-ui.test.ts checks); kept literal so the apps need no @erp/thai */
export const whtTypeOptions = [
  { value: 'service', label: 'ค่าบริการ 3%' }, { value: 'hire_of_work', label: 'ค่าจ้างทำของ 3%' }, { value: 'rent', label: 'ค่าเช่า 5%' },
  { value: 'transport', label: 'ค่าขนส่ง 1%' }, { value: 'advertising', label: 'ค่าโฆษณา 2%' },
  { value: 'promotion', label: 'รางวัล ส่วนลดหรือประโยชน์ใด ๆ เนื่องจากการส่งเสริมการขาย 3%' }, { value: 'professional', label: 'ค่าวิชาชีพอิสระ 3%' },
  { value: 'other', label: 'อื่น ๆ (ระบุอัตรา)' },
];
const formOptions = [{ value: 'auto', label: 'ตามเลขผู้เสียภาษี (0… = ภ.ง.ด.53 / อื่น = ภ.ง.ด.3)' }, { value: 'PND53', label: 'ภ.ง.ด.53 (นิติบุคคล)' }, { value: 'PND3', label: 'ภ.ง.ด.3 (บุคคลธรรมดา)' }];
const methodOptions = [{ value: 'transfer', label: 'โอนเงิน' }, { value: 'cheque', label: 'เช็ค' }, { value: 'cash', label: 'เงินสด' }];
const vatClaimOptions = [{ value: 'auto', label: 'อัตโนมัติ (มีเลขผู้เสียภาษีผู้ขาย = ขอคืนได้)' }, { value: 'true', label: 'ใบกำกับภาษีเต็มรูป — ขอคืน VAT ได้' }, { value: 'false', label: 'ไม่มีใบกำกับภาษีเต็มรูป — ขอคืนไม่ได้' }];
const supplierLookup = {
  module: 'master-data', path: '/partners', query: { kind: 'supplier' }, label: ['code', 'name'],
  assign: { supplierId: 'id', supplierCode: 'code', supplierName: 'name', supplierTaxId: 'tax_id', supplierBranch: 'branch', supplierAddress: 'address' },
};
/** the one-WHT-line fields shared by "pay this bill" and the payment form */
const whtFields = [
  { name: 'whtIncomeType', label: 'หักภาษี ณ ที่จ่าย', type: 'select' as const, default: 'none', options: [{ value: 'none', label: 'ไม่หัก' }, ...whtTypeOptions],
    help: 'คิดจากยอดก่อน VAT (ท.ป.4/2528) · จ่ายครั้งละไม่ถึง 1,000 บาท ระบบเตือนแต่ไม่บล็อก' },
  { name: 'whtRatePercent', label: 'อัตราภาษี % (เว้นว่าง = อัตราปกติ)', type: 'number' as const, step: 0.01 },
  { name: 'whtBase', label: 'ฐานเงินได้ก่อน VAT (เว้นว่าง = ยอดก่อน VAT ที่จ่ายครั้งนี้)', type: 'number' as const, format: 'money' as const },
  { name: 'whtDescription', label: 'คำอธิบายเงินได้ (จำเป็นเมื่อเลือก "อื่น ๆ")', type: 'text' as const },
  { name: 'form', label: 'ยื่นในแบบ', type: 'select' as const, default: 'auto', options: formOptions },
];
const payFields = [
  { name: 'paymentDate', label: 'วันที่จ่าย (เว้นว่าง = วันนี้)', type: 'date' as const },
  { name: 'method', label: 'จ่ายโดย', type: 'select' as const, default: 'transfer', options: methodOptions },
  { name: 'bankRef', label: 'อ้างอิงการโอน / เลขที่เช็ค', type: 'text' as const },
];
const RETURN_COLUMNS = [
  { key: 'seq', label: 'ลำดับที่', format: 'number' as const }, { key: 'tax_id', label: 'เลขประจำตัวผู้เสียภาษี' }, { key: 'branch', label: 'สาขา' },
  { key: 'name', label: 'ชื่อผู้มีเงินได้' }, { key: 'address', label: 'ที่อยู่', phone: false }, { key: 'paid_date', label: 'วันที่จ่าย', format: 'date' as const },
  { key: 'income_type', label: 'ประเภทเงินได้' }, { key: 'rate_percent', label: 'อัตรา', format: 'percent' as const },
  { key: 'amount', label: 'จำนวนเงินที่จ่าย', format: 'accounting' as const, total: true }, { key: 'tax', label: 'ภาษีที่หักนำส่ง', format: 'accounting' as const, total: true },
  { key: 'condition', label: 'เงื่อนไข' },
];
const CERT_FIELDS = (copy: 'copy_1' | 'copy_2') => [
  { key: copy, label: 'ฉบับ' }, { key: 'book_no', label: 'เล่มที่' }, { key: 'number', label: 'เลขที่' },
  { key: 'payer_text', label: 'ผู้มีหน้าที่หักภาษี ณ ที่จ่าย', section: 'ผู้มีหน้าที่หักภาษี ณ ที่จ่าย' },
  { key: 'payee_name', label: 'ชื่อผู้ถูกหักภาษี ณ ที่จ่าย', section: 'ผู้ถูกหักภาษี ณ ที่จ่าย' }, { key: 'payee_tax_id', label: 'เลขประจำตัวผู้เสียภาษีอากร' },
  { key: 'payee_branch', label: 'สาขา' }, { key: 'payee_address', label: 'ที่อยู่' },
  { key: 'seq_text', label: 'ลำดับในแบบ', section: 'แบบที่ยื่น' }, { key: 'form_boxes', label: 'ยื่นรวมในแบบ' },
  { key: 'total_paid', label: 'รวมเงินที่จ่าย', format: 'money' as const, section: 'รวม' }, { key: 'total_tax', label: 'รวมภาษีที่หักนำส่ง', format: 'money' as const, emphasis: true },
  { key: 'total_tax_text', label: 'รวมเงินภาษีที่หักนำส่ง (ตัวอักษร)' },
  { key: 'condition_boxes', label: 'ผู้จ่ายเงิน', section: 'เงื่อนไข' }, { key: 'paid_date_text', label: 'วันเดือนปีที่ออกหนังสือรับรอง' },
  { key: 'certify_text', label: 'คำรับรอง' }, { key: 'warning_text', label: 'คำเตือน' },
  { key: 'payment_no', label: 'ใบสำคัญจ่าย', print: false }, { key: 'print_count', label: 'จำนวนครั้งที่เปิดพิมพ์', format: 'number' as const, print: false },
];
const CERT_LINES = [{
  path: 'lines', label: 'ประเภทเงินได้พึงประเมินที่จ่าย',
  columns: [
    { key: 'income_type', label: 'ประเภทเงินได้พึงประเมินที่จ่าย' }, { key: 'paid_date', label: 'วัน เดือน หรือปีภาษี ที่จ่าย', format: 'date' as const },
    { key: 'rate_percent', label: 'อัตรา', format: 'percent' as const }, { key: 'amount', label: 'จำนวนเงินที่จ่าย', format: 'money' as const, total: true },
    { key: 'tax', label: 'ภาษีที่หักและนำส่งไว้', format: 'money' as const, total: true },
  ],
}];
const CERT_SIGN = [{ label: 'ผู้จ่ายเงิน (ผู้มีหน้าที่หักภาษี ณ ที่จ่าย) · ประทับตรานิติบุคคล (ถ้ามี)', name: 'signer_name' }];

const statuses = ['draft', 'approved', 'partially_received', 'received', 'cancelled'].map((v) => ({ value: v, label: STATUS_TH[v] }));

export default defineUi({
  module: 'purchasing',
  label: 'จัดซื้อ',
  glyph: 'ซ',
  icon: 'shopping-cart',
  todo: [
    { id: 'po-approve', label: 'ใบสั่งซื้อรออนุมัติ', screen: 'poList', query: { status: 'draft' }, perm: 'purchasing.po.approve', title: 'no', subtitle: ['supplier_name', 'created_by_name'],
      amount: 'gross', since: 'created_at', due: 'expected_date',
      actions: [{ id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/purchase-orders/:id/approve', perm: 'purchasing.po.approve', when: { field: 'status', in: ['draft'] }, tone: 'primary', confirm: 'อนุมัติใบสั่งซื้อนี้?', mobile: true }] },
  ],
  menu: [{ label: 'ใบสั่งซื้อ', screen: 'poList' }, { label: 'สร้างใบสั่งซื้อ', screen: 'poNew' }, { label: 'ใบส่งคืนสินค้า', screen: 'rtList' },
    { label: 'บันทึกการรับของ', screen: 'receipts' }, { label: 'ตั้งค่าการอนุมัติ', screen: 'settings' },
    { label: 'บิลผู้ขาย (ตั้งหนี้)', screen: 'billList' }, { label: 'เจ้าหนี้ค้างจ่าย', screen: 'payables' }, { label: 'อายุเจ้าหนี้', screen: 'aging' }, { label: 'เจ้าหนี้ยกมา', screen: 'openingBills' },
    { label: 'จ่ายชำระหนี้ผู้ขาย', screen: 'payNew' }, { label: 'ใบสำคัญจ่าย', screen: 'paymentList' }, { label: 'หนังสือรับรอง 50 ทวิ', screen: 'whtCerts' },
    { label: 'ภ.ง.ด.3 / ภ.ง.ด.53 รายเดือน', screen: 'whtReturns' }, { label: 'ใบแนบ ภ.ง.ด. (ส่งออก CSV)', screen: 'whtRows' }],
  commands: [
    { id: 'po', label: 'สร้างใบสั่งซื้อ', example: 'สั่งซื้อ SUP-001', keywords: ['สั่งซื้อ', 'ซื้อ', 'po'], screen: 'poNew', perm: 'purchasing.po.write',
      arg: { lookup: { module: 'master-data', path: '/partners', query: { kind: 'supplier' }, label: ['code', 'name'], assign: { supplierId: 'id', supplierName: 'name' } } } },
    { id: 'approve', label: 'ใบสั่งซื้อรออนุมัติ', example: 'ใบสั่งซื้อรออนุมัติ', keywords: ['ใบสั่งซื้อรออนุมัติ', 'po รออนุมัติ', 'อนุมัติใบสั่งซื้อ', 'อนุมัติ po'], screen: 'poList', perm: 'purchasing.po.read' },
  ],
  search: [
    { id: 'pos', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders', label: ['no', 'supplier_name'], screen: 'poDetail', perm: 'purchasing.po.read' },
    { id: 'returns', title: 'ใบส่งคืนสินค้า', endpoint: '/purchase-returns', label: ['no', 'po_no', 'supplier_name'], screen: 'rtDetail', perm: 'purchasing.po.read' },
    { id: 'bills', title: 'บิลผู้ขาย', endpoint: '/bills', label: ['no', 'supplier_invoice_no', 'supplier_name'], screen: 'billDetail', perm: 'purchasing.bill.read' },
    { id: 'payments', title: 'ใบสำคัญจ่าย', endpoint: '/supplier-payments', label: ['no', 'supplier_name', 'certificate_no'], screen: 'paymentDetail', perm: 'purchasing.payment.read' },
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
          { name: 'qty', label: 'จำนวน', type: 'number', format: 'qty', required: true },
          { name: 'unitPrice', label: 'ราคาต่อหน่วย', type: 'number', format: 'money', required: true },
        ],
      },
      submitLabel: 'สร้างใบสั่งซื้อ', after: { screen: 'poDetail', idFrom: 'id' },
    },
    poDetail: {
      kind: 'detail', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders/:id', perm: 'purchasing.po.read', heading: 'no', attachments: { entity: 'po', label: 'ใบเสนอราคา / ใบส่งของ' }, mobile: true,
      print: { title: 'ใบสั่งซื้อ', signatures: ['ผู้จัดทำ', 'ผู้อนุมัติ', 'ผู้ขาย (ยืนยันรับคำสั่งซื้อ)'] },
      flow: { field: 'status', steps: [{ value: 'draft', label: 'ร่าง' }, { value: 'approved', label: 'อนุมัติ' }, { value: 'partially_received', label: 'รับบางส่วน' }, { value: 'received', label: 'รับครบ' }], exits: [{ value: 'cancelled', label: 'ยกเลิก' }] },
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'supplier_name', label: 'ผู้ขาย' },
        { key: 'order_date', label: 'วันที่สั่ง', format: 'date' }, { key: 'expected_date', label: 'กำหนดส่ง', format: 'date' },
        { key: 'warehouse_code', label: 'รับเข้าคลัง', print: false }, { key: 'net', label: 'ก่อน VAT', format: 'money' },
        { key: 'vat', label: 'VAT 7%', format: 'money' }, { key: 'gross', label: 'ยอดรวม', format: 'money' }, { key: 'note', label: 'หมายเหตุ' },
        { key: 'created_by_name', label: 'ผู้จัดทำ' }, { key: 'approved_by_name', label: 'ผู้อนุมัติ' }, { key: 'approved_at', label: 'อนุมัติเมื่อ', format: 'datetime' },
        { key: 'received_by_approver', label: 'ผู้อนุมัติรับของเอง', format: 'boolean' },
      ],
      lines: [{
        path: 'lines', label: 'รายการ',
        columns: [
          { key: 'line_no', label: '#' }, { key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' },
          { key: 'qty', label: 'สั่ง', format: 'qty' }, { key: 'received_qty', label: 'รับแล้ว', format: 'qty', print: false }, { key: 'returned_qty', label: 'ส่งคืน', format: 'qty', print: false },
          { key: 'unit_price', label: 'ราคา/หน่วย', format: 'money' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' },
        ],
      }, {
        path: 'returns', label: 'ใบส่งคืนสินค้า', print: false,
        columns: [
          { key: 'no', label: 'เลขที่' }, { key: 'return_date', label: 'วันที่', format: 'date' }, { key: 'warehouse_code', label: 'จากคลัง' },
          { key: 'ref_no', label: 'อ้างอิง NCR' }, { key: 'gross', label: 'มูลค่ารวม VAT', format: 'money' },
        ],
      }, {
        path: 'receipts', label: 'การรับของ',
        columns: [
          { key: 'created_at', label: 'เมื่อ', format: 'datetime' }, { key: 'received_by_name', label: 'ผู้รับของ' },
          { key: 'gross', label: 'มูลค่ารวม VAT', format: 'money' }, { key: 'supplier_invoice_no', label: 'ใบกำกับผู้ขาย' }, { key: 'supplier_invoice_date', label: 'ลงวันที่', format: 'date' },
          { key: 'sod_note', label: 'ข้อสังเกต' },
        ],
      }],
      actions: [
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/purchase-orders/:id/approve', perm: 'purchasing.po.approve', when: { field: 'status', in: ['draft'] }, tone: 'primary', mobile: true },
        { id: 'receive', label: 'รับของที่ค้างทั้งหมด', method: 'POST', endpoint: '/purchase-orders/:id/receive', perm: 'purchasing.po.receive', when: { field: 'status', in: ['approved', 'partially_received'] }, confirm: 'บันทึกรับของทุกรายการที่ยังค้างรับ', tone: 'primary', mobile: true, impact: true,
          // C8: the supplier's tax invoice that came with the goods (optional — for the purchase VAT register)
          fields: [
            { name: 'receivedDate', label: 'วันที่รับของ (เว้นว่าง = วันนี้)', type: 'date' },
            { name: 'supplierInvoiceNo', label: 'เลขที่ใบกำกับภาษีผู้ขาย', type: 'text' },
            { name: 'supplierInvoiceDate', label: 'วันที่ใบกำกับภาษี', type: 'date' },
            { name: 'supplierTaxId', label: 'เลขประจำตัวผู้เสียภาษีผู้ขาย (13 หลัก)', type: 'text' },
            { name: 'supplierBranch', label: 'สาขาผู้ขาย (00000 = สำนักงานใหญ่)', type: 'text' },
          ] },
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
              { name: 'qty', label: 'จำนวน', type: 'number', format: 'qty', required: true },
              { name: 'reason', label: 'เหตุผล', type: 'text' },
            ],
          } },
        { id: 'bill', label: 'ตั้งหนี้ (ใบกำกับภาษีผู้ขาย)', method: 'POST', endpoint: '/purchase-orders/:id/bills', perm: 'purchasing.bill.write', when: { field: 'status', in: ['partially_received', 'received'] },
          then: { screen: 'billDetail', idFrom: 'id' },
          fields: [
            { name: 'supplierInvoiceNo', label: 'เลขที่ใบกำกับภาษี/ใบแจ้งหนี้ของผู้ขาย', type: 'text', required: true },
            { name: 'supplierInvoiceDate', label: 'วันที่ใบกำกับภาษี', type: 'date', required: true },
            { name: 'supplierId', label: 'ผู้ขาย (ดึงเลขผู้เสียภาษี/สาขา/ที่อยู่)', type: 'lookup', lookup: supplierLookup,
              help: 'ตั้งหนี้ได้เฉพาะของที่รับแล้วและยังไม่ได้ตั้งหนี้ (หักที่ส่งคืนแล้ว) ทุกรายการ' },
            { name: 'billDate', label: 'วันที่ตั้งหนี้ (เว้นว่าง = วันนี้)', type: 'date' },
            { name: 'creditDays', label: 'เครดิต (วัน)', type: 'number' },
            { name: 'dueDate', label: 'ครบกำหนดชำระ (เว้นว่าง = ตามเครดิต)', type: 'date' },
            { name: 'vatClaimable', label: 'ภาษีซื้อ', type: 'select', default: 'auto', options: vatClaimOptions },
            { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
          ] },
        { id: 'cancel', label: 'ยกเลิกใบสั่งซื้อ', method: 'POST', endpoint: '/purchase-orders/:id/cancel', perm: 'purchasing.po.write', when: { field: 'status', in: ['draft', 'approved'] }, confirm: 'ยกเลิกแล้วแก้กลับไม่ได้', tone: 'danger' },
      ],
    },
    receipts: {
      kind: 'list', title: 'บันทึกการรับของตามใบสั่งซื้อ', endpoint: '/receipts', perm: 'purchasing.po.read',
      filters: [{ name: 'q', label: 'ค้นหาเลขที่ PO หรือผู้ขาย', type: 'text' },
        { name: 'byApprover', label: 'แสดง', type: 'select', options: [{ value: 'true', label: 'เฉพาะผู้อนุมัติรับของเอง (ข้อยกเว้นการแยกหน้าที่)' }, { value: 'false', label: 'รับโดยคนอื่น' }] }],
      columns: [
        { key: 'created_at', label: 'เมื่อ', format: 'datetime' }, { key: 'po_no', label: 'ใบสั่งซื้อ' }, { key: 'supplier_name', label: 'ผู้ขาย' },
        { key: 'items', label: 'รายการ' }, { key: 'gross', label: 'มูลค่ารวม VAT', format: 'money' }, { key: 'approved_by_name', label: 'ผู้อนุมัติ PO' },
        { key: 'received_by_name', label: 'ผู้รับของ' }, { key: 'by_approver', label: 'ผู้อนุมัติรับเอง', format: 'boolean' },
      ],
      rowLink: { screen: 'poDetail', idFrom: 'po_id' },
      empty: 'ยังไม่มีการรับของ',
    },
    settings: {
      kind: 'form', title: 'ตั้งค่าการอนุมัติใบสั่งซื้อ', method: 'PUT', endpoint: '/settings', perm: 'purchasing.settings.write', load: '/settings',
      fields: [
        { name: 'creatorCannotApprove', label: 'ผู้สร้างใบสั่งซื้ออนุมัติใบของตัวเองไม่ได้ (แยกหน้าที่)', type: 'boolean',
          help: 'เปิดไว้ (แนะนำ ผู้สอบบัญชีตรวจข้อนี้) · ปิดได้เฉพาะบริษัทที่มีคนทำงานจัดซื้อคนเดียว — การรับของโดยผู้อนุมัติยังทำได้และถูกบันทึกในหน้า "บันทึกการรับของ"' },
        { name: 'standardApprovalLimit', label: 'วงเงินอนุมัติปกติ (บาท รวม VAT)', type: 'number', format: 'money',
          help: 'ใบสั่งซื้อที่ยอดเกินวงเงินนี้ ต้องให้ผู้มีสิทธิ์ "อนุมัติใบสั่งซื้อวงเงินสูง" อนุมัติ · ใส่ 0 = ไม่แบ่งวงเงิน' },
      ],
      submitLabel: 'บันทึกการตั้งค่า', after: { screen: 'poList' },
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
      kind: 'detail', title: 'ใบส่งคืนสินค้า', endpoint: '/purchase-returns/:id', perm: 'purchasing.po.read', heading: 'no', attachments: { entity: 'return', label: 'รูปถ่าย / เอกสาร' }, mobile: true, printable: true,
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
    /* ---------------- wave 9: supplier bills (ตั้งหนี้) & payables ---------------- */
    billList: {
      kind: 'list', title: 'บิลผู้ขาย (ตั้งหนี้)', endpoint: '/bills', perm: 'purchasing.bill.read',
      filters: [{ name: 'q', label: 'ค้นหาเลขที่ ผู้ขาย เลขใบกำกับ หรือ PO', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: [{ value: 'unpaid', label: 'ยังไม่จ่ายครบ' }, { value: 'open', label: 'ค้างจ่าย' }, { value: 'partially_paid', label: 'จ่ายบางส่วน' }, { value: 'paid', label: 'จ่ายครบ' }] },
        { name: 'kind', label: 'ประเภท', type: 'select', options: [{ value: 'goods', label: 'ค่าสินค้า' }, { value: 'service', label: 'ค่าบริการ' }, { value: 'expense', label: 'ค่าใช้จ่ายอื่น' }, { value: 'opening', label: 'เจ้าหนี้ยกมา' }] }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'bill_date', label: 'วันที่', format: 'date' }, { key: 'supplier_name', label: 'ผู้ขาย' },
        { key: 'supplier_invoice_no', label: 'ใบกำกับผู้ขาย' }, { key: 'kind_label', label: 'ประเภท' }, { key: 'due_date', label: 'ครบกำหนด', format: 'date' },
        { key: 'gross', label: 'ยอดรวม', format: 'money' }, { key: 'outstanding', label: 'ค้างจ่าย', format: 'money' }, { key: 'status_label', label: 'สถานะ' },
      ],
      create: 'billNew', createLabel: 'ตั้งหนี้ค่าบริการ/ค่าใช้จ่าย', rowLink: { screen: 'billDetail' },
      empty: 'ยังไม่มีบิลผู้ขาย — ค่าสินค้า: เปิดใบสั่งซื้อที่รับของแล้วกด "ตั้งหนี้" · ค่าบริการ: กด "ตั้งหนี้ค่าบริการ/ค่าใช้จ่าย"',
    },
    openingBills: {
      kind: 'list', title: 'เจ้าหนี้ยกมา', endpoint: '/opening-payables', perm: 'purchasing.bill.read',
      filters: [{ name: 'q', label: 'ค้นหาเลขที่ ผู้ขาย หรือเลขใบแจ้งหนี้', type: 'text' }],
      columns: [
        { key: 'no', label: 'เลขที่ตั้งหนี้' }, { key: 'supplier_invoice_no', label: 'ใบแจ้งหนี้ผู้ขาย' }, { key: 'supplier_name', label: 'ผู้ขาย' },
        { key: 'bill_date', label: 'วันที่', format: 'date' }, { key: 'due_date', label: 'ครบกำหนด', format: 'date' },
        { key: 'gross', label: 'ยอดยกมา', format: 'money' }, { key: 'outstanding', label: 'ค้างจ่าย', format: 'money' }, { key: 'status_label', label: 'สถานะ' },
      ],
      rowLink: { screen: 'billDetail' },
      empty: 'ยังไม่มีเจ้าหนี้ยกมา — นำเข้าใบแจ้งหนี้ผู้ขายที่ยังค้างจ่ายจากโปรแกรมเดิมด้วยไฟล์ Excel',
      import: {
        endpoint: '/opening-payables/import', perm: 'purchasing.bill.write', template: 'แบบฟอร์มเจ้าหนี้ยกมา.csv',
        note: 'ใบแจ้งหนี้ผู้ขายที่ยังค้างจ่ายในโปรแกรมเดิม ณ วันเริ่มใช้ — ไม่เข้ารายงานภาษีซื้อและไม่ลงค่าใช้จ่ายซ้ำ (ยอดเจ้าหนี้ในบัญชีใช้การยกยอดของโมดูลบัญชี) · จ่ายด้วยใบสำคัญจ่ายได้ตามปกติ · ใบที่ตั้งหนี้แล้วจะไม่นำเข้าซ้ำ',
        columns: openingDocColumns('supplier'), resolve: OPENING_PARTNER_RESOLVE,
      },
    },
    billNew: {
      kind: 'form', title: 'ตั้งหนี้ค่าบริการ / ค่าใช้จ่าย', method: 'POST', endpoint: '/bills', perm: 'purchasing.bill.write',
      fields: [
        { name: 'kind', label: 'ประเภท', type: 'select', default: 'service', required: true, options: [{ value: 'service', label: 'ค่าบริการ / ค่าจ้าง' }, { value: 'expense', label: 'ค่าใช้จ่ายอื่น (ค่าเช่า ค่าโฆษณา ค่าขนส่ง ฯลฯ)' }],
          help: 'ค่าสินค้าตามใบสั่งซื้อ ให้ตั้งหนี้จากหน้าใบสั่งซื้อ (ปุ่ม "ตั้งหนี้")' },
        { name: 'supplierId', label: 'ผู้ขาย / ผู้ให้บริการ', type: 'lookup', required: true, lookup: supplierLookup },
        { name: 'supplierInvoiceNo', label: 'เลขที่ใบกำกับภาษี/ใบแจ้งหนี้', type: 'text', required: true },
        { name: 'supplierInvoiceDate', label: 'วันที่ใบกำกับภาษี', type: 'date', required: true },
        { name: 'billDate', label: 'วันที่ตั้งหนี้ (เว้นว่าง = วันนี้)', type: 'date' },
        { name: 'creditDays', label: 'เครดิต (วัน)', type: 'number' },
        { name: 'dueDate', label: 'ครบกำหนดชำระ (เว้นว่าง = ตามเครดิต)', type: 'date' },
        { name: 'vatMode', label: 'ราคา', type: 'select', default: 'exclusive', options: [{ value: 'exclusive', label: 'ยังไม่รวม VAT' }, { value: 'inclusive', label: 'รวม VAT แล้ว' }, { value: 'none', label: 'ไม่มี VAT (ผู้ขายไม่จด VAT)' }] },
        { name: 'vatClaimable', label: 'ภาษีซื้อ', type: 'select', default: 'auto', options: vatClaimOptions },
        { name: 'whtIncomeType', label: 'ตอนจ่าย ต้องหักภาษี ณ ที่จ่ายประเภท', type: 'select', options: whtTypeOptions, help: 'ช่วยเตือนตอนจ่ายถ้าลืมหัก' },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      lines: {
        name: 'lines', label: 'รายการ', min: 1,
        fields: [
          { name: 'description', label: 'รายการ', type: 'text', required: true },
          { name: 'qty', label: 'จำนวน', type: 'number', format: 'qty', default: 1, required: true },
          { name: 'unitPrice', label: 'ราคาต่อหน่วย', type: 'number', format: 'money', required: true },
        ],
      },
      submitLabel: 'ตั้งหนี้', after: { screen: 'billDetail', idFrom: 'id' },
    },
    billDetail: {
      kind: 'detail', title: 'บิลผู้ขาย (ใบตั้งหนี้)', endpoint: '/bills/:id', perm: 'purchasing.bill.read', heading: 'no', attachments: { entity: 'bill', label: 'ใบกำกับภาษี / ใบแจ้งหนี้ผู้ขาย' },
      print: { title: 'ใบตั้งหนี้', signatures: ['ผู้บันทึก', 'ผู้ตรวจ'] },
      fields: [
        { key: 'status_label', label: 'สถานะ', print: false }, { key: 'kind_label', label: 'ประเภท' }, { key: 'bill_date', label: 'วันที่ตั้งหนี้', format: 'date' },
        { key: 'due_date', label: 'ครบกำหนดชำระ', format: 'date' }, { key: 'supplier_name', label: 'ผู้ขาย', section: 'ผู้ขาย' }, { key: 'supplier_tax_id', label: 'เลขประจำตัวผู้เสียภาษี' },
        { key: 'supplier_branch', label: 'สาขา' }, { key: 'supplier_address', label: 'ที่อยู่' },
        { key: 'supplier_invoice_no', label: 'เลขที่ใบกำกับภาษี/ใบแจ้งหนี้', section: 'เอกสารผู้ขาย' }, { key: 'supplier_invoice_date', label: 'ลงวันที่', format: 'date' },
        { key: 'po_no', label: 'ตามใบสั่งซื้อ' }, { key: 'net', label: 'ก่อน VAT', format: 'money', section: 'ยอดเงิน' }, { key: 'vat', label: 'VAT', format: 'money' },
        { key: 'gross', label: 'ยอดรวม', format: 'money', emphasis: true }, { key: 'vat_claimable_label', label: 'ภาษีซื้อ' }, { key: 'wht_income_type_label', label: 'หัก ณ ที่จ่ายตอนจ่าย' },
        { key: 'paid', label: 'จ่ายแล้ว', format: 'money', print: false }, { key: 'outstanding', label: 'ค้างจ่าย', format: 'money', print: false },
        { key: 'note', label: 'หมายเหตุ' }, { key: 'created_by_name', label: 'ผู้บันทึก' },
      ],
      lines: [{
        path: 'lines', label: 'รายการ',
        columns: [{ key: 'line_no', label: '#' }, { key: 'item_code', label: 'รหัส' }, { key: 'description', label: 'รายการ' }, { key: 'qty', label: 'จำนวน', format: 'qty' },
          { key: 'unit_price', label: 'ราคา/หน่วย', format: 'money' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' }],
      }, {
        path: 'payments', label: 'การจ่ายชำระ', print: false,
        columns: [{ key: 'no', label: 'ใบสำคัญจ่าย' }, { key: 'payment_date', label: 'วันที่', format: 'date' }, { key: 'amount', label: 'ตัดหนี้', format: 'money' }, { key: 'wht_total', label: 'หัก ณ ที่จ่าย (ทั้งใบ)', format: 'money' }],
      }],
      actions: [
        { id: 'pay', label: 'จ่ายชำระ', method: 'POST', endpoint: '/bills/:id/payments', perm: 'purchasing.payment.write', when: { field: 'status', in: ['open', 'partially_paid'] }, tone: 'primary',
          then: { screen: 'paymentDetail', idFrom: 'id' },
          fields: [{ name: 'amount', label: 'ตัดหนี้ (บาท รวม VAT · เว้นว่าง = ค้างทั้งหมด)', type: 'number', format: 'money' }, ...payFields, ...whtFields,
            { name: 'note', label: 'หมายเหตุ', type: 'textarea' }] },
      ],
    },
    payables: {
      kind: 'list', title: 'เจ้าหนี้ค้างจ่าย', endpoint: '/payables', perm: 'purchasing.bill.read',
      filters: [{ name: 'q', label: 'ค้นหาผู้ขาย / เลขที่', type: 'text' }, { name: 'asOf', label: 'ณ วันที่', type: 'date' },
        { name: 'overdue', label: 'แสดง', type: 'select', options: [{ value: 'true', label: 'เฉพาะเกินกำหนด' }, { value: 'false', label: 'ยังไม่ครบกำหนด' }] }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'supplier_name', label: 'ผู้ขาย' }, { key: 'supplier_invoice_no', label: 'ใบกำกับผู้ขาย' },
        { key: 'bill_date', label: 'วันที่', format: 'date' }, { key: 'due_on', label: 'ครบกำหนด', format: 'date' }, { key: 'days_overdue', label: 'เกินกำหนด (วัน)', format: 'number' },
        { key: 'bucket', label: 'อายุหนี้' }, { key: 'outstanding', label: 'ค้างจ่าย', format: 'accounting', total: true },
      ],
      rowLink: { screen: 'billDetail' }, empty: 'ไม่มีหนี้ค้างจ่าย',
    },
    aging: {
      kind: 'list', title: 'รายงานอายุเจ้าหนี้', endpoint: '/payables/aging', perm: 'purchasing.bill.read', rows: 'rows',
      filters: [{ name: 'asOf', label: 'ณ วันที่ (เว้นว่าง = วันนี้)', type: 'date' }],
      columns: [
        { key: 'supplier_name', label: 'ผู้ขาย' }, { key: 'bills', label: 'บิล', format: 'number' },
        { key: 'not_due', label: 'ยังไม่ครบกำหนด', format: 'accounting', total: true }, { key: 'd1_30', label: '1–30 วัน', format: 'accounting', total: true },
        { key: 'd31_60', label: '31–60 วัน', format: 'accounting', total: true }, { key: 'd61_90', label: '61–90 วัน', format: 'accounting', total: true },
        { key: 'over_90', label: 'เกิน 90 วัน', format: 'accounting', total: true }, { key: 'total', label: 'รวม', format: 'accounting', total: true },
      ],
      report: { subtitle: 'ณ วันที่ {asOf|date}' },
      empty: 'ไม่มีหนี้ค้างจ่าย',
    },

    /* ---------------- wave 9: supplier payments (PV) with withholding tax ---------------- */
    payNew: {
      kind: 'form', title: 'จ่ายชำระหนี้ผู้ขาย', method: 'POST', endpoint: '/supplier-payments', perm: 'purchasing.payment.write',
      fields: [...payFields, ...whtFields, { name: 'note', label: 'หมายเหตุ', type: 'textarea' }],
      lines: {
        name: 'bills', label: 'บิลที่จ่าย (ผู้ขายรายเดียวกัน)', min: 1,
        fields: [
          { name: 'billId', label: 'บิล', type: 'lookup', required: true,
            lookup: { path: '/bills', query: { status: 'unpaid' }, label: ['no', 'supplier_name', 'supplier_invoice_no', 'outstanding'], assign: { billId: 'id' } } },
          { name: 'amount', label: 'ตัดหนี้ (เว้นว่าง = ค้างทั้งหมด)', type: 'number', format: 'money' },
        ],
      },
      submitLabel: 'บันทึกการจ่าย', after: { screen: 'paymentDetail', idFrom: 'id' },
    },
    paymentList: {
      kind: 'list', title: 'ใบสำคัญจ่าย', endpoint: '/supplier-payments', perm: 'purchasing.payment.read',
      filters: [{ name: 'q', label: 'ค้นหาเลขที่ ผู้ขาย หรือเลข 50 ทวิ', type: 'text' }, { name: 'period', label: 'เดือนที่จ่าย', type: 'month' },
        { name: 'form', label: 'แบบ', type: 'select', options: [{ value: 'PND53', label: 'ภ.ง.ด.53' }, { value: 'PND3', label: 'ภ.ง.ด.3' }] }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'payment_date', label: 'วันที่จ่าย', format: 'date' }, { key: 'supplier_name', label: 'ผู้ขาย' }, { key: 'bill_nos', label: 'บิล' },
        { key: 'gross', label: 'ตัดหนี้', format: 'money', total: true }, { key: 'wht_total', label: 'หัก ณ ที่จ่าย', format: 'money', total: true },
        { key: 'net_paid', label: 'จ่ายจริง', format: 'money', total: true }, { key: 'form_label', label: 'แบบ' }, { key: 'certificate_no', label: '50 ทวิ' },
      ],
      create: 'payNew', createLabel: 'จ่ายชำระหนี้', rowLink: { screen: 'paymentDetail' }, empty: 'ยังไม่มีการจ่ายชำระ',
    },
    paymentDetail: {
      kind: 'detail', title: 'ใบสำคัญจ่าย', endpoint: '/supplier-payments/:id', perm: 'purchasing.payment.read', heading: 'no', attachments: { entity: 'payment', label: 'สลิปโอน / สำเนาเช็ค' },
      print: { title: 'ใบสำคัญจ่าย', signatures: [{ label: 'ผู้จัดทำ', name: 'created_by_name' }, 'ผู้อนุมัติจ่าย', 'ผู้รับเงิน'] },
      fields: [
        { key: 'payment_date', label: 'วันที่จ่าย', format: 'date' }, { key: 'method_label', label: 'จ่ายโดย' }, { key: 'bank_ref', label: 'อ้างอิงการโอน / เช็ค' },
        { key: 'supplier_name', label: 'จ่ายให้', section: 'ผู้รับเงิน' }, { key: 'supplier_tax_id', label: 'เลขประจำตัวผู้เสียภาษี' }, { key: 'supplier_branch', label: 'สาขา' },
        { key: 'gross', label: 'ตัดหนี้', format: 'money', section: 'ยอดเงิน' }, { key: 'wht_total', label: 'หักภาษี ณ ที่จ่าย', format: 'money' },
        { key: 'net_paid', label: 'จ่ายสุทธิ', format: 'money', emphasis: true }, { key: 'net_paid_text', label: 'ตัวอักษร' },
        { key: 'form_label', label: 'ยื่นในแบบ' }, { key: 'certificate_no', label: 'หนังสือรับรอง 50 ทวิ' },
        { key: 'warnings_text', label: 'ข้อควรตรวจ', print: false }, { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [{
        path: 'bills', label: 'บิลที่จ่าย',
        columns: [{ key: 'bill_no', label: 'บิล' }, { key: 'supplier_invoice_no', label: 'ใบกำกับผู้ขาย' }, { key: 'bill_date', label: 'วันที่', format: 'date' },
          { key: 'bill_gross', label: 'ยอดบิล', format: 'money' }, { key: 'amount', label: 'ตัดหนี้ครั้งนี้', format: 'money', total: true }],
      }, {
        path: 'wht', label: 'ภาษีหัก ณ ที่จ่าย',
        columns: [{ key: 'description', label: 'ประเภทเงินได้' }, { key: 'base', label: 'ฐานก่อน VAT', format: 'money', total: true },
          { key: 'rate_percent', label: 'อัตรา', format: 'percent' }, { key: 'amount', label: 'ภาษีที่หัก', format: 'money', total: true }],
      }],
      actions: [
        { id: 'cert1', label: '50 ทวิ ฉบับที่ 1', method: 'POST', endpoint: '/wht-certificates/:id/print', perm: 'purchasing.payment.read', when: { field: 'has_wht', in: [true] }, tone: 'primary',
          then: { screen: 'whtCert1', idFrom: 'id' } },
        { id: 'cert2', label: '50 ทวิ ฉบับที่ 2', method: 'POST', endpoint: '/wht-certificates/:id/print', perm: 'purchasing.payment.read', when: { field: 'has_wht', in: [true] },
          then: { screen: 'whtCert2', idFrom: 'id' } },
      ],
    },

    /* ---------------- wave 9: 50 ทวิ certificates (มาตรา 50 ทวิ) ---------------- */
    whtCerts: {
      kind: 'list', title: 'หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)', endpoint: '/wht-certificates', perm: 'purchasing.wht.read',
      filters: [{ name: 'q', label: 'ค้นหาเลขที่ ผู้ถูกหัก หรือเลขผู้เสียภาษี', type: 'text' }, { name: 'period', label: 'เดือนที่จ่าย', type: 'month' },
        { name: 'form', label: 'แบบ', type: 'select', options: [{ value: 'PND53', label: 'ภ.ง.ด.53' }, { value: 'PND3', label: 'ภ.ง.ด.3' }] }],
      columns: [
        { key: 'certificate_no', label: 'เลขที่' }, { key: 'payment_date', label: 'วันที่จ่าย', format: 'date' }, { key: 'supplier_name', label: 'ผู้ถูกหักภาษี' },
        { key: 'supplier_tax_id', label: 'เลขผู้เสียภาษี' }, { key: 'form_label', label: 'แบบ' }, { key: 'wht_base', label: 'เงินที่จ่าย', format: 'money', total: true },
        { key: 'wht_total', label: 'ภาษีที่หัก', format: 'money', total: true }, { key: 'payment_no', label: 'ใบสำคัญจ่าย' }, { key: 'print_count', label: 'พิมพ์แล้ว (ครั้ง)', format: 'number' },
      ],
      rowLink: { screen: 'whtCert1' },
      rowActions: [{ id: 'copy2', label: 'ฉบับที่ 2', method: 'POST', endpoint: '/wht-certificates/:id/print', perm: 'purchasing.wht.read', then: { screen: 'whtCert2', idFrom: 'id' } }],
      empty: 'ยังไม่มีการหักภาษี ณ ที่จ่าย — หนังสือรับรองออกให้อัตโนมัติเมื่อจ่ายชำระและหักภาษี',
    },
    whtCert1: {
      kind: 'detail', title: 'หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร — ฉบับที่ 1', endpoint: '/wht-certificates/:id', perm: 'purchasing.wht.read', heading: 'heading',
      print: { title: 'หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร', signatures: CERT_SIGN },
      fields: CERT_FIELDS('copy_1'), lines: CERT_LINES,
      actions: [{ id: 'copy2', label: 'เปิดฉบับที่ 2', method: 'POST', endpoint: '/wht-certificates/:id/print', perm: 'purchasing.wht.read', then: { screen: 'whtCert2', idFrom: 'id' } }],
    },
    whtCert2: {
      kind: 'detail', title: 'หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร — ฉบับที่ 2', endpoint: '/wht-certificates/:id', perm: 'purchasing.wht.read', heading: 'heading',
      print: { title: 'หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร', signatures: CERT_SIGN },
      fields: CERT_FIELDS('copy_2'), lines: CERT_LINES,
      actions: [{ id: 'copy1', label: 'เปิดฉบับที่ 1', method: 'POST', endpoint: '/wht-certificates/:id/print', perm: 'purchasing.wht.read', then: { screen: 'whtCert1', idFrom: 'id' } }],
    },

    /* ---------------- wave 9: monthly ภ.ง.ด.3 / ภ.ง.ด.53 ---------------- */
    whtReturns: {
      kind: 'list', title: 'ภ.ง.ด.3 / ภ.ง.ด.53 รายเดือน', endpoint: '/wht/returns', perm: 'purchasing.wht.read',
      filters: [{ name: 'year', label: 'ปี (ค.ศ. หรือ พ.ศ., เว้นว่าง = ทุกปี)', type: 'number', comma: false }],
      columns: [
        { key: 'period_label', label: 'เดือนภาษี' }, { key: 'form_label', label: 'แบบ' }, { key: 'payees', label: 'จำนวนราย', format: 'number' },
        { key: 'total_amount', label: 'เงินได้ที่จ่าย', format: 'money' }, { key: 'total_tax', label: 'ภาษีที่หักนำส่ง', format: 'money' },
        { key: 'due_paper', label: 'ยื่นกระดาษภายใน', format: 'date' }, { key: 'due_efiling', label: 'ยื่น e-Filing ภายใน', format: 'date' },
      ],
      rowLink: { screen: 'whtReturn' }, empty: 'ยังไม่มีการหักภาษี ณ ที่จ่าย',
    },
    whtReturn: {
      kind: 'detail', title: 'แบบ ภ.ง.ด.3 / ภ.ง.ด.53 — ใบแนบ', endpoint: '/wht/returns/:id', perm: 'purchasing.wht.read', heading: 'title',
      print: { title: 'ใบแนบ ภ.ง.ด.3 / ภ.ง.ด.53 (สำหรับตรวจทานก่อนยื่น)', signatures: ['ผู้จัดทำ', 'ผู้ตรวจ'] },
      fields: [
        { key: 'form_label', label: 'แบบ' }, { key: 'period_label', label: 'เดือนภาษี' }, { key: 'payees', label: 'จำนวนราย', format: 'number' },
        { key: 'total_amount', label: 'รวมเงินได้ที่จ่าย', format: 'money' }, { key: 'total_tax', label: 'รวมภาษีที่นำส่ง', format: 'money', emphasis: true },
        { key: 'total_tax_text', label: 'ตัวอักษร' }, { key: 'due_text', label: 'กำหนดยื่น' },
        { key: 'filing_note', label: 'การยื่นแบบ', print: false, section: 'ส่งออกไฟล์' }, { key: 'rd_note', label: 'ไฟล์ RD Prep', print: false },
        { key: 'rd_columns', label: 'คอลัมน์ไฟล์ RD Prep (คั่นด้วย |)', print: false },
        { key: 'rd_text', label: 'ข้อความไฟล์ RD Prep (คัดลอกทั้งหมดไปบันทึกเป็นไฟล์ .txt — ถ้า RD Prep แสดงภาษาไทยเพี้ยน ให้บันทึกแบบ ANSI / TIS-620)', print: false },
      ],
      lines: [{ path: 'rows', label: 'ใบแนบ', columns: RETURN_COLUMNS }],
    },
    whtRows: {
      kind: 'list', title: 'ใบแนบ ภ.ง.ด.3 / ภ.ง.ด.53 (ส่งออก CSV)', endpoint: '/wht/attachment-rows', perm: 'purchasing.wht.read',
      filters: [{ name: 'period', label: 'เดือนภาษี (เว้นว่าง = เดือนนี้)', type: 'month' },
        { name: 'form', label: 'แบบ', type: 'select', default: 'PND53', options: [{ value: 'PND53', label: 'ภ.ง.ด.53 (นิติบุคคล)' }, { value: 'PND3', label: 'ภ.ง.ด.3 (บุคคลธรรมดา)' }] }],
      columns: RETURN_COLUMNS,
      rowLink: { screen: 'paymentDetail', idFrom: 'payment_id' }, empty: 'ไม่มีการหักภาษี ณ ที่จ่ายในเดือน/แบบนี้',
    },
  },
  widgets: [
    { id: 'po-kpi', kind: 'kpi', title: 'จัดซื้อ', endpoint: '/summary', perm: 'purchasing.po.read', size: 'sm', href: 'poList',
      items: [{ key: 'toApprove', label: 'รออนุมัติ', format: 'number', tone: 'warn' }, { key: 'toReceive', label: 'รอรับของ', format: 'number' }, { key: 'spendMonth', label: 'ยอดซื้อเดือนนี้', format: 'money' }] },
    { id: 'po-trend', kind: 'trend', title: 'ยอดซื้อ 6 เดือน', endpoint: '/summary', perm: 'purchasing.po.read', size: 'md', href: 'poList', rows: 'months', x: 'month', y: 'total', format: 'money' },
  ],
});
