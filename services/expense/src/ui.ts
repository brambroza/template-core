import { defineUi, type Column, type Field, type LinesSpec } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const claimStatuses = [
  { value: 'draft', label: 'ร่าง' }, { value: 'submitted', label: 'รออนุมัติ' }, { value: 'returned', label: 'ส่งกลับแก้ไข' },
  { value: 'approved', label: 'อนุมัติแล้ว รอจ่าย' }, { value: 'paid', label: 'จ่ายแล้ว' }, { value: 'rejected', label: 'ไม่อนุมัติ' }, { value: 'cancelled', label: 'ยกเลิก' },
];
const advanceStatuses = [
  { value: 'requested', label: 'ขอเบิก' }, { value: 'approved', label: 'อนุมัติแล้ว' }, { value: 'paid', label: 'จ่ายแล้ว รอเคลียร์' },
  { value: 'cleared', label: 'เคลียร์แล้ว' }, { value: 'rejected', label: 'ไม่อนุมัติ' }, { value: 'cancelled', label: 'ยกเลิก' },
];

const claimLines: LinesSpec = {
  name: 'lines', label: 'รายการค่าใช้จ่าย', min: 1,
  fields: [
    { name: 'expenseDate', label: 'วันที่จ่าย', type: 'date', required: true },
    { name: 'categoryId', label: 'หมวด', type: 'lookup', required: true,
      lookup: { path: '/categories', query: { active: 'true' }, label: ['code', 'name'], assign: { categoryId: 'id' } } },
    { name: 'description', label: 'รายละเอียด', type: 'text' },
    { name: 'amount', label: 'จำนวนเงิน (ก่อน VAT)', type: 'number', step: 0.01, required: true },
    { name: 'vat', label: 'VAT (ถ้ามี)', type: 'number', step: 0.01 },
    { name: 'receiptNo', label: 'เลขที่ใบเสร็จ', type: 'text' },
  ],
};

const payFields: Field[] = [
  { name: 'method', label: 'วิธีจ่าย', type: 'select', required: true, default: 'transfer',
    options: [{ value: 'transfer', label: 'โอนเงิน' }, { value: 'cash', label: 'เงินสด' }, { value: 'cheque', label: 'เช็ค' }] },
  { name: 'paidDate', label: 'วันที่จ่าย (เว้นว่าง = วันนี้)', type: 'date' },
  { name: 'reference', label: 'เลขที่อ้างอิง / เลขที่เช็ค', type: 'text' },
];
const note = (label: string, required = true): Field => ({ name: 'note', label, type: 'textarea', required });

const claimColumns: Column[] = [
  { key: 'no', label: 'เลขที่' },
  { key: 'claim_date', label: 'วันที่', format: 'date' },
  { key: 'claimant_name', label: 'ผู้เบิก' },
  { key: 'purpose', label: 'วัตถุประสงค์' },
  { key: 'total', label: 'ยอดเบิก', format: 'money' },
  { key: 'status_label', label: 'สถานะ' },
  { key: 'over_limit', label: 'เกินวงเงิน', format: 'boolean' },
];

/** Company-wide lists, payment queues and spend reports are for approvers / finance; staff work from "ใบเบิกของฉัน". */
const APPROVE = 'expense.claim.approve';
const PAY = 'expense.claim.pay';

export default defineUi({
  module: 'expense',
  label: 'เบิกค่าใช้จ่าย',
  glyph: 'บ',
  icon: 'wallet',
  menu: [
    { label: 'ใบเบิกของฉัน', screen: 'myClaims' },
    { label: 'เบิกค่าใช้จ่าย', screen: 'claimNew' },
    { label: 'ใบเบิกทั้งหมด', screen: 'claims' },
    { label: 'รอจ่ายเงิน', screen: 'toPay' },
    { label: 'เงินทดรองจ่าย', screen: 'advances' },
    { label: 'เงินทดรองค้างเคลียร์', screen: 'advancesOpen' },
    { label: 'สรุปตามหมวด', screen: 'byCategory' },
    { label: 'สรุปรายเดือน', screen: 'monthly' },
    { label: 'หมวดค่าใช้จ่าย', screen: 'categories' },
  ],
  commands: [
    { id: 'claim', label: 'เบิกค่าใช้จ่าย', example: 'เบิก ค่าน้ำมันไปหาลูกค้าบางนา', keywords: ['เบิก', 'เบิกเงิน', 'เบิกค่า'], screen: 'claimNew', perm: 'expense.claim.write', restField: 'purpose' },
    { id: 'advance', label: 'ขอเงินทดรองจ่าย', example: 'เบิกล่วงหน้า ไปออกบูธงานแฟร์', keywords: ['เบิกล่วงหน้า', 'ทดรอง', 'เงินทดรอง'], screen: 'advanceNew', perm: 'expense.claim.write', restField: 'purpose' },
    { id: 'toPay', label: 'ใบเบิกรอจ่ายเงิน', example: 'รอจ่าย', keywords: ['รอจ่าย', 'ค้างจ่าย'], screen: 'toPay', perm: PAY },
    { id: 'mine', label: 'ใบเบิกของฉัน', example: 'ใบเบิกของฉัน', keywords: ['ใบเบิกของฉัน', 'ใบเบิก'], screen: 'myClaims', perm: 'expense.claim.read' },
  ],
  search: [
    { id: 'claims', title: 'ใบเบิกค่าใช้จ่าย', endpoint: '/claims', label: ['no', 'purpose', 'claimant_name'], screen: 'claimDetail', perm: 'expense.claim.read' },
    { id: 'advances', title: 'เงินทดรองจ่าย', endpoint: '/advances', label: ['no', 'purpose', 'requester_name'], screen: 'advanceDetail', perm: 'expense.claim.read' },
  ],
  screens: {
    myClaims: {
      kind: 'list', title: 'ใบเบิกของฉัน', endpoint: '/my-claims', perm: 'expense.claim.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาเลขที่หรือวัตถุประสงค์', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: claimStatuses }],
      columns: claimColumns,
      create: 'claimNew', createLabel: 'เบิกค่าใช้จ่าย', rowLink: { screen: 'claimDetail' }, empty: 'คุณยังไม่มีใบเบิก',
    },
    claims: {
      kind: 'list', title: 'ใบเบิกค่าใช้จ่าย', endpoint: '/claims', perm: APPROVE, mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่ ผู้เบิก แผนก', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: claimStatuses },
        { name: 'from', label: 'ตั้งแต่วันที่', type: 'date' },
        { name: 'to', label: 'ถึงวันที่', type: 'date' },
      ],
      columns: [...claimColumns.slice(0, 3), { key: 'department', label: 'แผนก' }, ...claimColumns.slice(3)],
      create: 'claimNew', createLabel: 'เบิกค่าใช้จ่าย', rowLink: { screen: 'claimDetail' },
      rowActions: [
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/claims/:id/approve', perm: 'expense.claim.approve', when: { field: 'status', in: ['submitted'] }, tone: 'primary', confirm: 'อนุมัติใบเบิกนี้?', mobile: true },
      ],
      empty: 'ยังไม่มีใบเบิก',
    },
    claimNew: {
      kind: 'form', title: 'เบิกค่าใช้จ่าย', method: 'POST', endpoint: '/claims', perm: 'expense.claim.write', mobile: true,
      fields: [
        { name: 'purpose', label: 'วัตถุประสงค์', type: 'text', required: true, help: 'ผู้เบิกคือผู้ใช้ที่ล็อกอินอยู่' },
        { name: 'department', label: 'แผนก', type: 'text' },
        { name: 'claimDate', label: 'วันที่ขอเบิก (เว้นว่าง = วันนี้)', type: 'date' },
        { name: 'submit', label: 'ส่งขออนุมัติทันที', type: 'boolean', default: true },
      ],
      lines: claimLines,
      // optional: photo of the receipt -> lines prefilled by AI (customer's own key), attached to the claim after save
      aiFill: { kind: 'receipt', label: 'สแกนใบเสร็จ' },
      submitLabel: 'บันทึกใบเบิก', after: { screen: 'claimDetail', idFrom: 'id' },
    },
    claimEdit: {
      kind: 'form', title: 'แก้ไขใบเบิก', method: 'PUT', endpoint: '/claims/:id', load: '/claims/:id', perm: 'expense.claim.write', mobile: true,
      fields: [
        { name: 'purpose', label: 'วัตถุประสงค์', type: 'text', required: true, help: 'ผู้เบิกคือผู้ใช้ที่ล็อกอินอยู่' },
        { name: 'department', label: 'แผนก', type: 'text' },
        { name: 'claimDate', label: 'วันที่ขอเบิก', type: 'date' },
      ],
      submitLabel: 'บันทึกการแก้ไข', after: { screen: 'claimDetail', idFrom: 'id' },
    },
    claimDetail: {
      kind: 'detail', title: 'ใบเบิกค่าใช้จ่าย', endpoint: '/claims/:id', perm: 'expense.claim.read', heading: 'no', attachments: { entity: 'claim', label: 'ใบเสร็จ / หลักฐาน' }, mobile: true,
      print: { title: 'ใบเบิกค่าใช้จ่าย', signatures: ['ผู้เบิก', 'ผู้อนุมัติ', 'ผู้จ่ายเงิน'] },
      edit: 'claimEdit',
      flow: {
        field: 'status',
        steps: [{ value: 'draft', label: 'ร่าง' }, { value: 'submitted', label: 'รออนุมัติ' }, { value: 'approved', label: 'อนุมัติ' }, { value: 'paid', label: 'จ่ายแล้ว' }],
        exits: [{ value: 'returned', label: 'ส่งกลับแก้ไข' }, { value: 'rejected', label: 'ไม่อนุมัติ' }, { value: 'cancelled', label: 'ยกเลิก' }],
      },
      fields: [
        { key: 'status_label', label: 'สถานะ' },
        { key: 'claim_date', label: 'วันที่ขอเบิก', format: 'date' },
        { key: 'claimant_name', label: 'ผู้เบิก' },
        { key: 'department', label: 'แผนก' },
        { key: 'purpose', label: 'วัตถุประสงค์' },
        { key: 'net', label: 'ก่อน VAT', format: 'money' },
        { key: 'vat', label: 'VAT', format: 'money' },
        { key: 'total', label: 'ยอดเบิกรวม', format: 'money' },
        { key: 'total_text', label: 'ตัวอักษร' },
        { key: 'advance_no', label: 'หักเงินทดรอง' },
        { key: 'advance_amount', label: 'ยอดเงินทดรอง', format: 'money' },
        { key: 'net_payable', label: 'ยอดจ่ายสุทธิ', format: 'money' },
        { key: 'over_limit', label: 'เกินวงเงิน', format: 'boolean' },
        { key: 'last_note', label: 'หมายเหตุผู้อนุมัติ' },
        { key: 'approved_by_name', label: 'ผู้อนุมัติ' },
        { key: 'approved_at', label: 'อนุมัติเมื่อ', format: 'datetime' },
        { key: 'paid_date', label: 'วันที่จ่าย', format: 'date' },
        { key: 'pay_method_label', label: 'วิธีจ่าย' },
        { key: 'pay_reference', label: 'อ้างอิงการจ่าย' },
        { key: 'paid_by_name', label: 'ผู้จ่ายเงิน' },
      ],
      lines: [
        { path: 'lines', label: 'รายการ', columns: [
          { key: 'line_no', label: '#' }, { key: 'expense_date', label: 'วันที่', format: 'date' }, { key: 'category_name', label: 'หมวด' },
          { key: 'description', label: 'รายละเอียด' }, { key: 'receipt_no', label: 'ใบเสร็จ' },
          { key: 'amount', label: 'จำนวนเงิน', format: 'money' }, { key: 'vat', label: 'VAT', format: 'money' }, { key: 'total', label: 'รวม', format: 'money' },
        ] },
        { path: 'warnings', label: 'คำเตือน', columns: [{ key: 'message', label: 'รายละเอียด' }] },
      ],
      actions: [
        { id: 'submit', label: 'ส่งขออนุมัติ', method: 'POST', endpoint: '/claims/:id/submit', perm: 'expense.claim.write', when: { field: 'status', in: ['draft', 'returned'] }, tone: 'primary', mobile: true },
        { id: 'lines', label: 'แก้ไขรายการ', method: 'PUT', endpoint: '/claims/:id/lines', perm: 'expense.claim.write', when: { field: 'status', in: ['draft', 'returned'] }, lines: claimLines, mobile: true },
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/claims/:id/approve', perm: 'expense.claim.approve', when: { field: 'status', in: ['submitted'] }, tone: 'primary', fields: [note('ความเห็น (ไม่บังคับ)', false)], mobile: true },
        { id: 'return', label: 'ส่งกลับแก้ไข', method: 'POST', endpoint: '/claims/:id/return', perm: 'expense.claim.approve', when: { field: 'status', in: ['submitted'] }, fields: [note('ต้องแก้ไขอะไร')], mobile: true },
        { id: 'reject', label: 'ไม่อนุมัติ', method: 'POST', endpoint: '/claims/:id/reject', perm: 'expense.claim.approve', when: { field: 'status', in: ['submitted'] }, tone: 'danger', fields: [note('เหตุผลที่ไม่อนุมัติ')], mobile: true },
        { id: 'pay', label: 'บันทึกจ่ายเงิน', method: 'POST', endpoint: '/claims/:id/pay', perm: 'expense.claim.pay', when: { field: 'status', in: ['approved'] }, tone: 'primary', fields: payFields },
        { id: 'cancel', label: 'ยกเลิกใบเบิก', method: 'POST', endpoint: '/claims/:id/cancel', perm: 'expense.claim.write', when: { field: 'status', in: ['draft', 'returned'] }, tone: 'danger', confirm: 'ยกเลิกใบเบิกนี้?' },
      ],
    },
    toPay: {
      kind: 'list', title: 'ใบเบิกอนุมัติแล้ว รอจ่ายเงิน', endpoint: '/reports/outstanding', rows: 'items', perm: PAY,
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'claimant_name', label: 'ผู้เบิก' }, { key: 'purpose', label: 'วัตถุประสงค์' },
        { key: 'total', label: 'ยอดเบิก', format: 'money' }, { key: 'advance_amount', label: 'หักเงินทดรอง', format: 'money' },
        { key: 'net_payable', label: 'ต้องจ่าย', format: 'money' }, { key: 'days_waiting', label: 'รอมาแล้ว (วัน)', format: 'qty' },
      ],
      rowLink: { screen: 'claimDetail' },
      rowActions: [{ id: 'pay', label: 'โอนแล้ว', method: 'POST', endpoint: '/claims/:id/pay', perm: 'expense.claim.pay', fields: payFields, tone: 'primary' }],
      empty: 'ไม่มีใบเบิกค้างจ่าย',
    },
    advances: {
      kind: 'list', title: 'เงินทดรองจ่าย', endpoint: '/advances', perm: 'expense.claim.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาเลขที่ ผู้ขอ วัตถุประสงค์', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: advanceStatuses }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'requester_name', label: 'ผู้ขอ' }, { key: 'purpose', label: 'วัตถุประสงค์' },
        { key: 'amount', label: 'จำนวนเงิน', format: 'money' }, { key: 'status_label', label: 'สถานะ' }, { key: 'claim_no', label: 'เคลียร์ด้วยใบเบิก' },
        { key: 'settle_amount', label: 'ส่วนต่าง', format: 'money' },
      ],
      create: 'advanceNew', createLabel: 'ขอเงินทดรอง', rowLink: { screen: 'advanceDetail' }, empty: 'ยังไม่มีเงินทดรอง',
    },
    advancesOpen: {
      kind: 'list', title: 'เงินทดรองจ่ายแล้ว รอเคลียร์', endpoint: '/reports/outstanding', rows: 'advances', perm: PAY,
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'requester_name', label: 'ผู้ขอ' }, { key: 'purpose', label: 'วัตถุประสงค์' },
        { key: 'amount', label: 'จำนวนเงิน', format: 'money' }, { key: 'paid_date', label: 'จ่ายเมื่อ', format: 'date' }, { key: 'days_open', label: 'ค้าง (วัน)', format: 'qty' },
      ],
      rowLink: { screen: 'advanceDetail' }, empty: 'ไม่มีเงินทดรองค้างเคลียร์',
    },
    advanceNew: {
      kind: 'form', title: 'ขอเงินทดรองจ่าย', method: 'POST', endpoint: '/advances', perm: 'expense.claim.write', mobile: true,
      fields: [
        { name: 'purpose', label: 'วัตถุประสงค์', type: 'text', required: true },
        { name: 'amount', label: 'จำนวนเงิน', type: 'number', step: 0.01, required: true },
        { name: 'neededBy', label: 'ต้องการภายในวันที่', type: 'date' },
        { name: 'department', label: 'แผนก', type: 'text' },
      ],
      submitLabel: 'ส่งขอเงินทดรอง', after: { screen: 'advanceDetail', idFrom: 'id' },
    },
    advanceDetail: {
      kind: 'detail', title: 'เงินทดรองจ่าย', endpoint: '/advances/:id', perm: 'expense.claim.read', heading: 'no', attachments: { entity: 'advance' }, mobile: true, printable: true,
      flow: {
        field: 'status',
        steps: [{ value: 'requested', label: 'ขอเบิก' }, { value: 'approved', label: 'อนุมัติ' }, { value: 'paid', label: 'จ่ายแล้ว' }, { value: 'cleared', label: 'เคลียร์แล้ว' }],
        exits: [{ value: 'rejected', label: 'ไม่อนุมัติ' }, { value: 'cancelled', label: 'ยกเลิก' }],
      },
      fields: [
        { key: 'status_label', label: 'สถานะ' }, { key: 'requester_name', label: 'ผู้ขอ' }, { key: 'department', label: 'แผนก' },
        { key: 'purpose', label: 'วัตถุประสงค์' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' }, { key: 'amount_text', label: 'ตัวอักษร' },
        { key: 'needed_by', label: 'ต้องการภายใน', format: 'date' }, { key: 'last_note', label: 'หมายเหตุ' },
        { key: 'approved_by_name', label: 'ผู้อนุมัติ' }, { key: 'paid_by_name', label: 'ผู้จ่ายเงิน' },
        { key: 'paid_date', label: 'วันที่จ่าย', format: 'date' }, { key: 'pay_method_label', label: 'วิธีจ่าย' }, { key: 'pay_reference', label: 'อ้างอิง' },
        { key: 'claim_no', label: 'เคลียร์ด้วยใบเบิก' }, { key: 'claim_total', label: 'ยอดใบเบิก', format: 'money' },
        { key: 'settle_text', label: 'ผลการเคลียร์' }, { key: 'cleared_at', label: 'เคลียร์เมื่อ', format: 'datetime' },
      ],
      actions: [
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/advances/:id/approve', perm: 'expense.claim.approve', when: { field: 'status', in: ['requested'] }, tone: 'primary', mobile: true },
        { id: 'reject', label: 'ไม่อนุมัติ', method: 'POST', endpoint: '/advances/:id/reject', perm: 'expense.claim.approve', when: { field: 'status', in: ['requested'] }, tone: 'danger', fields: [note('เหตุผล')], mobile: true },
        { id: 'pay', label: 'บันทึกจ่ายเงินทดรอง', method: 'POST', endpoint: '/advances/:id/pay', perm: 'expense.claim.pay', when: { field: 'status', in: ['approved'] }, tone: 'primary', fields: payFields },
        { id: 'clear', label: 'เคลียร์กับใบเบิก', method: 'POST', endpoint: '/advances/:id/clear', perm: 'expense.claim.pay', when: { field: 'status', in: ['paid'] }, tone: 'primary',
          fields: [{ name: 'claimId', label: 'ใบเบิกที่ใช้เคลียร์ (อนุมัติแล้ว)', type: 'lookup', required: true,
            lookup: { path: '/claims', query: { status: 'approved' }, label: ['no', 'claimant_name', 'purpose'], assign: { claimId: 'id' } } }] },
        { id: 'cancel', label: 'ยกเลิก', method: 'POST', endpoint: '/advances/:id/cancel', perm: 'expense.claim.write', when: { field: 'status', in: ['requested', 'approved'] }, tone: 'danger', confirm: 'ยกเลิกคำขอเงินทดรองนี้?' },
      ],
    },
    byCategory: {
      kind: 'list', title: 'ค่าใช้จ่ายตามหมวด', endpoint: '/reports/by-category', perm: APPROVE,
      filters: [{ name: 'month', label: 'เดือน (YYYY-MM, เว้นว่าง = เดือนนี้)', type: 'text' }],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'หมวด' }, { key: 'total', label: 'ยอดรวม', format: 'money' },
        { key: 'monthly_limit', label: 'วงเงิน/คน/เดือน', format: 'money' }, { key: 'claims', label: 'ใบเบิก', format: 'qty' }, { key: 'people', label: 'จำนวนคน', format: 'qty' },
      ],
      rowLink: { screen: 'categoryDetail' }, empty: 'ยังไม่มีหมวดค่าใช้จ่าย',
    },
    monthly: {
      kind: 'list', title: 'ยอดเบิกรายเดือน (6 เดือน)', endpoint: '/summary', rows: 'months', perm: APPROVE,
      columns: [{ key: 'month', label: 'เดือน', format: 'month' }, { key: 'claims', label: 'จำนวนใบเบิก', format: 'qty' }, { key: 'total', label: 'ยอดเบิก', format: 'money' }],
      empty: 'ยังไม่มีข้อมูล',
    },
    categories: {
      kind: 'list', title: 'หมวดค่าใช้จ่าย', endpoint: '/categories', perm: 'expense.claim.read',
      filters: [{ name: 'q', label: 'ค้นหารหัสหรือชื่อ', type: 'text' }],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }, { key: 'monthly_limit', label: 'วงเงิน/คน/เดือน', format: 'money' },
        { key: 'requires_receipt', label: 'ต้องมีใบเสร็จ', format: 'boolean' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      create: 'categoryNew', createLabel: 'เพิ่มหมวด', rowLink: { screen: 'categoryDetail' },
      empty: 'ยังไม่มีหมวด — เช่น ค่าเดินทาง, ค่าน้ำมัน, ค่ารับรอง, ค่าที่พัก, เบ็ดเตล็ด',
    },
    categoryNew: {
      kind: 'form', title: 'เพิ่มหมวดค่าใช้จ่าย', method: 'POST', endpoint: '/categories', perm: 'expense.category.write',
      fields: [
        { name: 'code', label: 'รหัส', type: 'text', required: true, help: 'เช่น TRAVEL, FUEL, ENTERTAIN, HOTEL, MISC' },
        { name: 'name', label: 'ชื่อ', type: 'text', required: true },
        { name: 'monthlyLimit', label: 'วงเงินต่อคนต่อเดือน (เว้นว่าง = ไม่จำกัด)', type: 'number', step: 0.01, help: 'เกินวงเงินระบบจะเตือน แต่ไม่บล็อก' },
        { name: 'requiresReceipt', label: 'ต้องระบุเลขที่ใบเสร็จก่อนส่ง', type: 'boolean' },
        { name: 'note', label: 'หมายเหตุ / ระเบียบการเบิก', type: 'textarea' },
        { name: 'active', label: 'ใช้งาน', type: 'boolean', default: true },
      ],
      submitLabel: 'บันทึก', after: { screen: 'categoryDetail', idFrom: 'id' },
    },
    categoryEdit: {
      kind: 'form', title: 'แก้ไขหมวดค่าใช้จ่าย', method: 'PUT', endpoint: '/categories/:id', load: '/categories/:id', perm: 'expense.category.write',
      fields: [
        { name: 'name', label: 'ชื่อ', type: 'text', required: true },
        { name: 'monthlyLimit', label: 'วงเงินต่อคนต่อเดือน', type: 'number', step: 0.01 },
        { name: 'requiresReceipt', label: 'ต้องระบุเลขที่ใบเสร็จก่อนส่ง', type: 'boolean' },
        { name: 'note', label: 'หมายเหตุ / ระเบียบการเบิก', type: 'textarea' },
        { name: 'active', label: 'ใช้งาน', type: 'boolean' },
      ],
      submitLabel: 'บันทึก', after: { screen: 'categoryDetail', idFrom: 'id' },
    },
    categoryDetail: {
      kind: 'detail', title: 'หมวดค่าใช้จ่าย', endpoint: '/categories/:id', perm: 'expense.claim.read', heading: 'name', edit: 'categoryEdit',
      fields: [
        { key: 'code', label: 'รหัส' }, { key: 'monthly_limit', label: 'วงเงิน/คน/เดือน', format: 'money' },
        { key: 'requires_receipt', label: 'ต้องมีใบเสร็จ', format: 'boolean' }, { key: 'used_this_month', label: 'เบิกเดือนนี้', format: 'money' },
        { key: 'note', label: 'ระเบียบการเบิก' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
    },
  },
  widgets: [
    { id: 'expense-kpi', kind: 'kpi', title: 'เบิกค่าใช้จ่าย', endpoint: '/summary', perm: APPROVE, size: 'md', href: 'claims',
      items: [
        { key: 'toApprove', label: 'รออนุมัติ', format: 'qty', tone: 'warn' },
        { key: 'toPayAmount', label: 'ค้างจ่าย (บาท)', format: 'money' },
        { key: 'claimedThisMonth', label: 'ยอดเบิกเดือนนี้', format: 'money' },
        { key: 'advancesOutstanding', label: 'เงินทดรองค้างเคลียร์', format: 'money', tone: 'stop' },
      ] },
    { id: 'expense-category', kind: 'bars', title: 'ค่าใช้จ่ายเดือนนี้ตามหมวด', endpoint: '/summary', perm: APPROVE, size: 'md', href: 'byCategory',
      rows: 'byCategory', label: 'name', value: 'total', format: 'money' },
    { id: 'expense-trend', kind: 'trend', title: 'ยอดเบิก 6 เดือน', endpoint: '/summary', perm: APPROVE, size: 'md', href: 'monthly', rows: 'months', x: 'month', y: 'total', format: 'money' },
  ],
});
