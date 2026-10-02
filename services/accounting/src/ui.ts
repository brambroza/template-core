import { defineUi, type Field, type LinesSpec } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const READ = 'accounting.journal.read';
const WRITE = 'accounting.journal.write';
const POST = 'accounting.journal.post';
const ACCOUNT = 'accounting.account.write';
const REPORT = 'accounting.report.read';

const jvStatuses = [
  { value: 'draft', label: 'ร่าง' }, { value: 'posted', label: 'ผ่านรายการแล้ว' },
  { value: 'reversed', label: 'กลับรายการแล้ว' }, { value: 'cancelled', label: 'ยกเลิก' },
];
const sources = [
  { value: 'manual', label: 'บันทึกเอง' }, { value: 'reversal', label: 'กลับรายการ' },
  { value: 'sales.invoiced', label: 'ขาย — ใบกำกับภาษี' }, { value: 'sales.payment_received', label: 'ขาย — รับชำระ/มัดจำ' },
  { value: 'purchasing.goods_received', label: 'จัดซื้อ — รับสินค้า' }, { value: 'purchasing.goods_returned', label: 'จัดซื้อ — ส่งคืน' },
  { value: 'expense.claim_paid', label: 'เบิกค่าใช้จ่าย — จ่ายเงิน' },
];
const types = [
  { value: 'asset', label: 'สินทรัพย์' }, { value: 'liability', label: 'หนี้สิน' }, { value: 'equity', label: 'ส่วนของผู้ถือหุ้น' },
  { value: 'revenue', label: 'รายได้' }, { value: 'expense', label: 'ค่าใช้จ่าย' },
];
const categories = [
  { value: 'current_asset', label: 'สินทรัพย์หมุนเวียน' }, { value: 'non_current_asset', label: 'สินทรัพย์ไม่หมุนเวียน' },
  { value: 'current_liability', label: 'หนี้สินหมุนเวียน' }, { value: 'non_current_liability', label: 'หนี้สินไม่หมุนเวียน' },
  { value: 'equity', label: 'ส่วนของผู้ถือหุ้น' }, { value: 'revenue', label: 'รายได้จากการขาย/บริการ' }, { value: 'other_income', label: 'รายได้อื่น' },
  { value: 'cost_of_sales', label: 'ต้นทุนขาย' }, { value: 'expense', label: 'ค่าใช้จ่ายในการขายและบริหาร' }, { value: 'income_tax', label: 'ภาษีเงินได้นิติบุคคล' },
];
const roles = [
  { value: 'cash', label: 'เงินสด' }, { value: 'bank', label: 'เงินฝากธนาคาร' }, { value: 'ar', label: 'ลูกหนี้การค้า' }, { value: 'inventory', label: 'สินค้าคงเหลือ' },
  { value: 'vat_input', label: 'ภาษีซื้อ' }, { value: 'vat_input_pending', label: 'ภาษีซื้อยังไม่ถึงกำหนด' }, { value: 'wht_receivable', label: 'ภาษีถูกหัก ณ ที่จ่าย' },
  { value: 'advance', label: 'เงินทดรองจ่าย' }, { value: 'ap', label: 'เจ้าหนี้การค้า' }, { value: 'vat_output', label: 'ภาษีขาย' },
  { value: 'vat_output_pending', label: 'ภาษีขายยังไม่ถึงกำหนด' }, { value: 'vat_payable', label: 'ภาษีมูลค่าเพิ่มค้างจ่าย' },
  { value: 'wht_payable', label: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย' }, { value: 'sso_payable', label: 'ประกันสังคมค้างจ่าย' }, { value: 'salary_payable', label: 'เงินเดือนค้างจ่าย' },
  { value: 'deposit_received', label: 'เงินมัดจำรับ' }, { value: 'retained_earnings', label: 'กำไรสะสม' }, { value: 'sales_revenue', label: 'รายได้จากการขาย' },
  { value: 'cogs', label: 'ต้นทุนขาย' }, { value: 'expense_default', label: 'ค่าใช้จ่ายทั่วไป' },
];
const yesNo = [{ value: 'true', label: 'ใช้งาน' }, { value: 'false', label: 'ปิดใช้งาน' }];

const accountLookup = (name: string, label = 'บัญชี', required = true): Field => ({
  name, label, type: 'lookup', required,
  lookup: { path: '/accounts', query: { postable: 'true', active: 'true' }, label: ['code', 'name'], assign: { [name]: 'id' } },
});

const jvLines: LinesSpec = {
  name: 'lines', label: 'รายการบัญชี', min: 2,
  fields: [
    accountLookup('accountId', 'รหัสบัญชี'),
    { name: 'description', label: 'คำอธิบาย', type: 'text' },
    { name: 'debit', label: 'เดบิต', type: 'number', step: 0.01 },
    { name: 'credit', label: 'เครดิต', type: 'number', step: 0.01 },
    { name: 'partnerName', label: 'คู่ค้า/ผู้เกี่ยวข้อง', type: 'text' },
    { name: 'taxBase', label: 'ฐานภาษี (บรรทัดภาษี)', type: 'number', step: 0.01, help: 'ใส่เมื่อเป็นบรรทัดภาษีซื้อ/ภาษีขาย/ภาษีหัก ณ ที่จ่าย — ใช้ในรายงานภาษี' },
  ],
};

const jvHeader: Field[] = [
  { name: 'entryDate', label: 'วันที่ (เว้นว่าง = วันนี้)', type: 'date' },
  { name: 'description', label: 'คำอธิบายรายการ', type: 'text', required: true },
  { name: 'ref', label: 'เลขที่เอกสารอ้างอิง', type: 'text' },
  { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
];

const money = (key: string, label: string) => ({ key, label, format: 'money' as const });
/** amounts on statements: (1,250.00) for negatives, – for zero; `total` adds the column to the footer row */
const acc = (key: string, label: string, total = false) => ({ key, label, format: 'accounting' as const, ...(total ? { total } : {}) });
/** P&L / balance sheet rows: kind section | account | total | result | heading (reports.ts) */
const statement = { heading: ['heading', 'section'], subtotal: ['total'], total: ['result'], levels: { account: 1 } };

export default defineUi({
  module: 'accounting',
  label: 'บัญชี',
  glyph: 'บช',
  icon: 'book',
  area: 'finance',
  menu: [
    { label: 'สมุดรายวัน', screen: 'jvList' },
    { label: 'บันทึกบัญชี', screen: 'jvNew' },
    { label: 'ผังบัญชี', screen: 'accounts' },
    { label: 'งบทดลอง', screen: 'trialBalance' },
    { label: 'บัญชีแยกประเภท', screen: 'ledger' },
    { label: 'งบกำไรขาดทุน', screen: 'profitLoss' },
    { label: 'งบแสดงฐานะการเงิน', screen: 'balanceSheet' },
    { label: 'ภาษีมูลค่าเพิ่ม (ภ.พ.30)', screen: 'vatReport' },
    { label: 'รายงานภาษีขาย/ภาษีซื้อ', screen: 'vatLines' },
    { label: 'ภาษีถูกหัก ณ ที่จ่าย', screen: 'whtReceived' },
    { label: 'ลงบัญชีอัตโนมัติไม่สำเร็จ', screen: 'postingErrors' },
    { label: 'กฎการลงบัญชีอัตโนมัติ', screen: 'postingRules' },
    { label: 'จับคู่หมวดค่าใช้จ่าย', screen: 'categoryMappings' },
    { label: 'ปิดงวดบัญชี', screen: 'periods' },
  ],
  commands: [
    { id: 'jv', label: 'บันทึกบัญชี (สมุดรายวันทั่วไป)', example: 'บันทึกบัญชี ค่าเช่าโรงงานเดือนตุลาคม', keywords: ['บันทึกบัญชี', 'ลงบัญชี', 'สมุดรายวัน', 'jv'], screen: 'jvNew', perm: WRITE, restField: 'description' },
    { id: 'pl', label: 'งบกำไรขาดทุน', example: 'งบกำไรขาดทุน', keywords: ['งบกำไรขาดทุน', 'กำไรขาดทุน', 'p&l'], screen: 'profitLoss', perm: REPORT },
    { id: 'tb', label: 'งบทดลอง', example: 'งบทดลอง', keywords: ['งบทดลอง', 'trial balance'], screen: 'trialBalance', perm: REPORT },
    { id: 'ledger', label: 'บัญชีแยกประเภทของบัญชี', example: 'แยกประเภท 11200', keywords: ['บัญชีแยกประเภท', 'แยกประเภท', 'ledger'], screen: 'ledger', perm: REPORT,
      arg: { lookup: { path: '/accounts', query: { postable: 'true' }, label: ['code', 'name'], assign: { accountId: 'id' } } } },
    { id: 'vat', label: 'สรุปภาษีมูลค่าเพิ่ม ภ.พ.30', example: 'ภพ30', keywords: ['ภพ30', 'ภ.พ.30', 'ภาษีซื้อขาย', 'vat'], screen: 'vatReport', perm: REPORT },
  ],
  search: [
    { id: 'journals', title: 'สมุดรายวัน', endpoint: '/journals', label: ['no', 'description', 'ref'], screen: 'jvDetail', perm: READ },
    { id: 'accounts', title: 'ผังบัญชี', endpoint: '/accounts', label: ['code', 'name'], screen: 'accountDetail', perm: READ },
  ],
  screens: {
    /* ---------- journals ---------- */
    jvList: {
      kind: 'list', title: 'สมุดรายวัน', endpoint: '/journals', perm: READ,
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่ คำอธิบาย เอกสารอ้างอิง', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: jvStatuses },
        { name: 'source', label: 'ที่มา', type: 'select', options: sources },
        { name: 'from', label: 'ตั้งแต่วันที่', type: 'date' },
        { name: 'to', label: 'ถึงวันที่', type: 'date' },
        { ...accountLookup('accountId', 'มีบัญชี', false) },
      ],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'entry_date', label: 'วันที่', format: 'date' }, { key: 'description', label: 'คำอธิบาย' },
        { key: 'ref', label: 'อ้างอิง' }, { key: 'source_label', label: 'ที่มา' }, money('total_debit', 'จำนวนเงิน'), { key: 'status_label', label: 'สถานะ' },
      ],
      create: 'jvNew', createLabel: 'บันทึกบัญชี', rowLink: { screen: 'jvDetail' },
      rowActions: [{ id: 'post', label: 'ผ่านรายการ', method: 'POST', endpoint: '/journals/:id/post', perm: POST, when: { field: 'status', in: ['draft'] }, tone: 'primary', confirm: 'ผ่านรายการสมุดรายวันนี้?' }],
      empty: 'ยังไม่มีสมุดรายวัน — บันทึกเอง หรือรอรายการอัตโนมัติจากขาย/จัดซื้อ/เบิกค่าใช้จ่าย',
    },
    jvNew: {
      kind: 'form', title: 'บันทึกบัญชี (สมุดรายวันทั่วไป)', method: 'POST', endpoint: '/journals', perm: WRITE,
      fields: [...jvHeader, { name: 'post', label: 'ผ่านรายการทันที (ต้องมีสิทธิ์ผ่านรายการ)', type: 'boolean', default: false }],
      lines: jvLines,
      submitLabel: 'บันทึก', after: { screen: 'jvDetail', idFrom: 'id' },
    },
    jvEdit: {
      kind: 'form', title: 'แก้ไขสมุดรายวัน (ร่าง)', method: 'PUT', endpoint: '/journals/:id', load: '/journals/:id', perm: WRITE,
      fields: jvHeader,
      submitLabel: 'บันทึกการแก้ไข', after: { screen: 'jvDetail', idFrom: 'id' },
    },
    jvDetail: {
      kind: 'detail', title: 'สมุดรายวัน', endpoint: '/journals/:id', perm: READ, heading: 'no', edit: 'jvEdit',
      print: { title: 'ใบสำคัญทั่วไป (Journal Voucher)', signatures: [{ label: 'ผู้จัดทำ', name: 'created_by_name' }, 'ผู้ตรวจสอบ', { label: 'ผู้อนุมัติ/ผ่านรายการ', name: 'posted_by_name' }] },
      flow: {
        field: 'status',
        steps: [{ value: 'draft', label: 'ร่าง' }, { value: 'posted', label: 'ผ่านรายการ' }],
        exits: [{ value: 'reversed', label: 'กลับรายการแล้ว' }, { value: 'cancelled', label: 'ยกเลิก' }],
      },
      fields: [
        { key: 'status_label', label: 'สถานะ' }, { key: 'entry_date', label: 'วันที่', format: 'date' }, { key: 'description', label: 'คำอธิบาย' },
        { key: 'ref', label: 'เอกสารอ้างอิง' }, { key: 'source_label', label: 'ที่มา' },
        money('total_debit', 'เดบิตรวม'), money('total_credit', 'เครดิตรวม'), { key: 'note', label: 'หมายเหตุ' },
        { key: 'created_by_name', label: 'ผู้จัดทำ' }, { key: 'posted_by_name', label: 'ผู้ผ่านรายการ' }, { key: 'posted_at', label: 'ผ่านรายการเมื่อ', format: 'datetime' },
        { key: 'reversal_of_no', label: 'กลับรายการของ' }, { key: 'reversed_by_no', label: 'กลับรายการโดย' },
      ],
      lines: [{ path: 'lines', label: 'รายการบัญชี', columns: [
        { key: 'line_no', label: '#' }, { key: 'account_code', label: 'รหัสบัญชี' }, { key: 'account_name', label: 'ชื่อบัญชี' },
        { key: 'description', label: 'คำอธิบาย' }, { key: 'partner_name', label: 'คู่ค้า' },
        acc('debit', 'เดบิต', true), acc('credit', 'เครดิต', true), acc('tax_base', 'ฐานภาษี'),
      ] }],
      actions: [
        { id: 'post', label: 'ผ่านรายการ', method: 'POST', endpoint: '/journals/:id/post', perm: POST, when: { field: 'status', in: ['draft'] }, tone: 'primary', confirm: 'ผ่านรายการแล้วจะแก้ไขไม่ได้ (ต้องกลับรายการ) ยืนยัน?' },
        { id: 'lines', label: 'แก้ไขรายการบัญชี', method: 'PUT', endpoint: '/journals/:id/lines', perm: WRITE, when: { field: 'status', in: ['draft'] }, lines: jvLines },
        { id: 'cancel', label: 'ยกเลิก', method: 'POST', endpoint: '/journals/:id/cancel', perm: WRITE, when: { field: 'status', in: ['draft'] }, tone: 'danger', confirm: 'ยกเลิกสมุดรายวันร่างนี้?' },
        { id: 'reverse', label: 'กลับรายการ', method: 'POST', endpoint: '/journals/:id/reverse', perm: POST, when: { field: 'status', in: ['posted'] }, tone: 'danger',
          fields: [{ name: 'entryDate', label: 'วันที่กลับรายการ (เว้นว่าง = วันนี้)', type: 'date' }, { name: 'reason', label: 'เหตุผล', type: 'text' }],
          then: { screen: 'jvDetail', idFrom: 'id' } },
      ],
    },

    /* ---------- chart of accounts ---------- */
    accounts: {
      kind: 'list', title: 'ผังบัญชี', endpoint: '/accounts', perm: READ,
      filters: [
        { name: 'q', label: 'ค้นหารหัสหรือชื่อบัญชี', type: 'text' },
        { name: 'type', label: 'หมวด', type: 'select', options: types },
        { name: 'active', label: 'สถานะ', type: 'select', options: yesNo },
      ],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อบัญชี', indent: true }, { key: 'type_label', label: 'หมวด', phone: false },
        { key: 'category_label', label: 'กลุ่มในงบ', phone: false }, { key: 'is_group', label: 'บัญชีคุม', format: 'boolean', phone: false },
        { key: 'role_label', label: 'ใช้เป็น', phone: false }, money('balance', 'ยอดคงเหลือ'), { key: 'active', label: 'ใช้งาน', format: 'boolean', phone: false },
      ],
      // the hierarchy: names indented by `level` (depth under the top group), group accounts as bold headings
      report: { indentFrom: 'level', rowKind: 'row_kind', heading: ['group'] },
      create: 'accountNew', createLabel: 'เพิ่มบัญชี', rowLink: { screen: 'accountDetail' },
      actions: [{ id: 'setup', label: 'เติมผังบัญชีมาตรฐาน', method: 'POST', endpoint: '/accounts/setup', perm: ACCOUNT, confirm: 'เพิ่มบัญชีมาตรฐานและกฎลงบัญชีที่ยังไม่มี (ไม่แก้ของเดิม)?', toast: 'message' }],
      empty: 'ยังไม่มีผังบัญชี',
    },
    accountNew: {
      kind: 'form', title: 'เพิ่มบัญชี', method: 'POST', endpoint: '/accounts', perm: ACCOUNT,
      fields: [
        { name: 'code', label: 'รหัสบัญชี', type: 'text', required: true, help: 'เช่น 11210 เงินฝากธนาคารกสิกรไทย, 52450 ค่าบริการ cloud' },
        { name: 'name', label: 'ชื่อบัญชี', type: 'text', required: true },
        { name: 'nameEn', label: 'ชื่อภาษาอังกฤษ', type: 'text' },
        { name: 'type', label: 'หมวด', type: 'select', options: types, required: true },
        { name: 'category', label: 'กลุ่มในงบการเงิน (เว้นว่าง = ตามบัญชีคุม)', type: 'select', options: categories },
        { name: 'parentId', label: 'บัญชีคุม', type: 'lookup', lookup: { path: '/accounts', query: { groups: 'true' }, label: ['code', 'name'], assign: { parentId: 'id' } } },
        { name: 'isGroup', label: 'เป็นบัญชีคุม (หัวข้อ ไม่รับรายการ)', type: 'boolean', default: false },
        { name: 'role', label: 'ใช้เป็น (สำหรับรายงาน/สรุป)', type: 'select', options: roles },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      submitLabel: 'บันทึก', after: { screen: 'accountDetail', idFrom: 'id' },
    },
    accountEdit: {
      kind: 'form', title: 'แก้ไขบัญชี', method: 'PUT', endpoint: '/accounts/:id', load: '/accounts/:id', perm: ACCOUNT,
      fields: [
        { name: 'code', label: 'รหัสบัญชี (เปลี่ยนได้เมื่อยังไม่มีรายการ)', type: 'text', required: true },
        { name: 'name', label: 'ชื่อบัญชี', type: 'text', required: true },
        { name: 'nameEn', label: 'ชื่อภาษาอังกฤษ', type: 'text' },
        { name: 'category', label: 'กลุ่มในงบการเงิน', type: 'select', options: categories },
        { name: 'role', label: 'ใช้เป็น', type: 'select', options: roles },
        { name: 'active', label: 'ใช้งาน', type: 'boolean' },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      submitLabel: 'บันทึกการแก้ไข', after: { screen: 'accountDetail', idFrom: 'id' },
    },
    accountDetail: {
      kind: 'detail', title: 'บัญชี', endpoint: '/accounts/:id', perm: READ, heading: 'label', edit: 'accountEdit',
      fields: [
        { key: 'code', label: 'รหัส' }, { key: 'name_en', label: 'ชื่อภาษาอังกฤษ' }, { key: 'type_label', label: 'หมวด' }, { key: 'category_label', label: 'กลุ่มในงบ' },
        { key: 'parent_name', label: 'บัญชีคุม' }, { key: 'is_group', label: 'บัญชีคุม (หัวข้อ)', format: 'boolean' }, { key: 'role_label', label: 'ใช้เป็น' },
        { key: 'normal_side', label: 'ยอดปกติด้าน' }, money('debit_total', 'เดบิตสะสม'), money('credit_total', 'เครดิตสะสม'), money('balance', 'ยอดคงเหลือ'),
        { key: 'lines', label: 'จำนวนบรรทัดที่บันทึก', format: 'qty' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' }, { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [
        { path: 'movements', label: 'รายการล่าสุด (50)', columns: [
          { key: 'entry_date', label: 'วันที่', format: 'date' }, { key: 'no', label: 'เลขที่' }, { key: 'description', label: 'คำอธิบาย' },
          { key: 'partner_name', label: 'คู่ค้า' }, money('debit', 'เดบิต'), money('credit', 'เครดิต'), { key: 'status', label: 'สถานะ', format: 'status' },
        ] },
        { path: 'children_list', label: 'บัญชีย่อย', columns: [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' }] },
      ],
      actions: [
        { id: 'delete', label: 'ลบบัญชี', method: 'DELETE', endpoint: '/accounts/:id', perm: ACCOUNT, when: { field: 'used', in: [false] }, tone: 'danger',
          confirm: 'ลบบัญชีนี้? (ลบได้เฉพาะบัญชีที่ยังไม่มีรายการ)', then: { screen: 'accounts' } },
      ],
    },

    /* ---------- auto-posting ---------- */
    postingRules: {
      kind: 'list', title: 'กฎการลงบัญชีอัตโนมัติ', endpoint: '/posting-rules', perm: READ,
      columns: [
        { key: 'event_label', label: 'เมื่อเกิด' }, { key: 'label', label: 'รายการ' }, { key: 'side_label', label: 'ด้าน' },
        { key: 'account_label', label: 'บัญชีที่ใช้' }, { key: 'ok', label: 'พร้อมใช้', format: 'boolean' },
      ],
      rowActions: [{ id: 'account', label: 'เปลี่ยนบัญชี', method: 'PUT', endpoint: '/posting-rules/:id', perm: ACCOUNT, fields: [accountLookup('accountId', 'บัญชีที่ใช้')] }],
      empty: 'ยังไม่มีกฎ — เปิดหน้าผังบัญชีเพื่อสร้างผังบัญชีและกฎมาตรฐาน',
    },
    categoryMappings: {
      kind: 'list', title: 'จับคู่หมวดค่าใช้จ่าย (ใบเบิก) กับบัญชี', endpoint: '/category-mappings', perm: READ,
      filters: [{ name: 'q', label: 'ค้นหาหมวดหรือบัญชี', type: 'text' }],
      columns: [
        { key: 'category_code', label: 'รหัสหมวด' }, { key: 'category_name', label: 'ชื่อหมวด' }, { key: 'account_label', label: 'ลงบัญชี' }, { key: 'note', label: 'หมายเหตุ' },
      ],
      create: 'categoryMappingNew', createLabel: 'เพิ่มการจับคู่',
      rowActions: [
        { id: 'edit', label: 'แก้ไข', method: 'PUT', endpoint: '/category-mappings/:id', perm: ACCOUNT,
          fields: [{ name: 'categoryName', label: 'ชื่อหมวด (ใช้จับคู่เมื่อรหัสไม่ตรง)', type: 'text' }, accountLookup('accountId', 'ลงบัญชี')] },
        { id: 'delete', label: 'ลบ', method: 'DELETE', endpoint: '/category-mappings/:id', perm: ACCOUNT, tone: 'danger', confirm: 'ลบการจับคู่นี้? ใบเบิกหมวดนี้จะลงบัญชีค่าใช้จ่ายตามกฎ', toast: 'message' },
      ],
      empty: 'ยังไม่มีการจับคู่ — หมวดที่ไม่จับคู่จะลงบัญชี "ค่าใช้จ่าย" ตามกฎการลงบัญชีอัตโนมัติ',
    },
    categoryMappingNew: {
      kind: 'form', title: 'จับคู่หมวดค่าใช้จ่ายกับบัญชี', method: 'POST', endpoint: '/category-mappings', perm: ACCOUNT,
      fields: [
        { name: 'categoryCode', label: 'รหัสหมวดค่าใช้จ่าย (ตามระบบเบิกค่าใช้จ่าย)', type: 'text', required: true, help: 'เช่น FUEL, TRAVEL, ENTERTAIN' },
        { name: 'categoryName', label: 'ชื่อหมวด', type: 'text', help: 'ใช้จับคู่เมื่อรหัสไม่ตรง เช่น ค่าน้ำมัน' },
        accountLookup('accountId', 'ลงบัญชี'),
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      submitLabel: 'บันทึก', after: { screen: 'categoryMappings' },
    },
    postingErrors: {
      kind: 'list', title: 'ลงบัญชีอัตโนมัติไม่สำเร็จ', endpoint: '/posting-errors', perm: READ,
      filters: [
        { name: 'status', label: 'สถานะ', type: 'select', options: [{ value: 'open', label: 'รอแก้ไข' }, { value: 'resolved', label: 'ลงบัญชีแล้ว' }, { value: 'dismissed', label: 'ไม่ลงบัญชี' }, { value: 'all', label: 'ทั้งหมด' }] },
        { name: 'q', label: 'ค้นหาเลขที่เอกสารหรือสาเหตุ', type: 'text' },
      ],
      columns: [
        { key: 'created_at', label: 'เมื่อ', format: 'datetime' }, { key: 'event_label', label: 'จาก' }, { key: 'source_no', label: 'เอกสาร' },
        { key: 'reason', label: 'สาเหตุ' }, { key: 'attempts', label: 'ครั้ง', format: 'qty' }, { key: 'status_label', label: 'สถานะ' }, { key: 'journal_no', label: 'สมุดรายวัน' },
      ],
      rowActions: [
        { id: 'retry', label: 'ลงบัญชีอีกครั้ง', method: 'POST', endpoint: '/posting-errors/:id/retry', perm: POST, when: { field: 'status', in: ['open'] }, tone: 'primary', toast: 'message' },
        { id: 'dismiss', label: 'ไม่ลงบัญชี', method: 'POST', endpoint: '/posting-errors/:id/dismiss', perm: POST, when: { field: 'status', in: ['open'] }, confirm: 'ไม่ลงบัญชีรายการนี้อัตโนมัติ (จะบันทึกเองด้วยสมุดรายวัน)?', toast: 'message' },
      ],
      empty: 'ไม่มีรายการค้าง — ทุกเอกสารลงบัญชีอัตโนมัติเรียบร้อย',
    },
    periods: {
      kind: 'list', title: 'งวดบัญชี', endpoint: '/periods', perm: READ,
      filters: [{ name: 'year', label: 'ปี ค.ศ. (เว้นว่าง = ปีนี้)', type: 'text' }],
      columns: [
        { key: 'period_th', label: 'งวด' }, { key: 'status_label', label: 'สถานะ' }, { key: 'entries', label: 'รายการที่ผ่านแล้ว', format: 'qty' },
        { key: 'drafts', label: 'ร่างค้าง', format: 'qty' }, money('total_debit', 'ยอดเดบิตรวม'), { key: 'closed_by_name', label: 'ปิดโดย' }, { key: 'closed_at', label: 'ปิดเมื่อ', format: 'datetime' },
      ],
      rowActions: [
        { id: 'close', label: 'ปิดงวด', method: 'POST', endpoint: '/periods/:period/close', perm: 'accounting.period.close', when: { field: 'status', in: ['open'] }, tone: 'primary',
          confirm: 'ปิดงวดนี้? หลังปิดจะผ่านรายการ/กลับรายการ/ลงบัญชีอัตโนมัติในงวดนี้ไม่ได้จนกว่าจะเปิดงวด', toast: 'message' },
        { id: 'reopen', label: 'เปิดงวดอีกครั้ง', method: 'POST', endpoint: '/periods/:period/reopen', perm: 'accounting.period.close', when: { field: 'status', in: ['closed'] },
          fields: [{ name: 'note', label: 'เหตุผลที่เปิดงวด', type: 'text' }], toast: 'message' },
      ],
    },

    /* ---------- reports ---------- */
    trialBalance: {
      kind: 'list', title: 'งบทดลอง', endpoint: '/reports/trial-balance', rows: 'rows', perm: REPORT,
      filters: [{ name: 'asOf', label: 'ณ วันที่ (เว้นว่าง = วันนี้)', type: 'date' }, { name: 'all', label: 'แสดงบัญชีที่ยอดเป็นศูนย์', type: 'boolean' }],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อบัญชี' }, { key: 'type_label', label: 'หมวด', phone: false },
        { ...acc('debit_total', 'เดบิตสะสม', true), phone: false }, { ...acc('credit_total', 'เครดิตสะสม', true), phone: false }, acc('debit', 'คงเหลือเดบิต', true), acc('credit', 'คงเหลือเครดิต', true),
      ],
      report: { subtitle: 'ณ วันที่ {asOf|date}', totalLabel: 'รวม', check: { path: 'totals.balanced', ok: 'งบทดลองสมดุล — เดบิตเท่ากับเครดิต', fail: 'งบทดลองไม่สมดุล ต่างกัน {totals.difference|money} บาท' } },
      empty: 'ยังไม่มีรายการที่ผ่านแล้ว',
    },
    ledger: {
      kind: 'list', title: 'บัญชีแยกประเภททั่วไป', endpoint: '/reports/ledger', rows: 'rows', perm: REPORT,
      filters: [
        { ...accountLookup('accountId', 'บัญชี (เว้นว่าง = ทุกบัญชี)', false), lookup: { path: '/accounts', query: { postable: 'true' }, label: ['code', 'name'], assign: { accountId: 'id' } } },
        { name: 'from', label: 'ตั้งแต่วันที่ (เว้นว่าง = ต้นเดือน)', type: 'date' },
        { name: 'to', label: 'ถึงวันที่ (เว้นว่าง = วันนี้)', type: 'date' },
      ],
      columns: [
        { key: 'account_code', label: 'บัญชี', hideRepeats: true }, { key: 'entry_date', label: 'วันที่', format: 'date' }, { key: 'no', label: 'เลขที่' },
        { key: 'description', label: 'คำอธิบาย' }, { key: 'partner_name', label: 'คู่ค้า', phone: false },
        acc('debit', 'เดบิต'), acc('credit', 'เครดิต'), acc('balance', 'คงเหลือ'),
      ],
      // ledger rows: kind opening (ยอดยกมา) | line | closing (ยอดยกไป, with the period's debit/credit)
      report: { subtitle: '{from|date} – {to|date}', muted: ['opening'], subtotal: ['closing'] },
      rowLink: { screen: 'jvDetail', idFrom: 'journal_id' },
      empty: 'ไม่มีรายการในช่วงวันที่นี้',
    },
    profitLoss: {
      kind: 'list', title: 'งบกำไรขาดทุน', endpoint: '/reports/profit-loss', rows: 'rows', perm: REPORT, mobile: true,
      filters: [{ name: 'month', label: 'เดือน (เว้นว่าง = เดือนนี้)', type: 'month' }],
      columns: [{ key: 'code', label: 'รหัส', phone: false }, { key: 'name', label: 'รายการ', indent: true }, acc('month', 'เดือนนี้'), acc('ytd', 'สะสมตั้งแต่ต้นปี')],
      report: { ...statement, subtitle: 'สำหรับเดือน {month|month} และสะสมตั้งแต่ {ytdFrom|date}' },
      empty: 'ยังไม่มีรายการ',
    },
    balanceSheet: {
      kind: 'list', title: 'งบแสดงฐานะการเงิน', endpoint: '/reports/balance-sheet', rows: 'rows', perm: REPORT, mobile: true,
      filters: [{ name: 'asOf', label: 'ณ วันที่ (เว้นว่าง = วันนี้)', type: 'date' }],
      columns: [{ key: 'code', label: 'รหัส', phone: false }, { key: 'name', label: 'รายการ', indent: true }, acc('amount', 'จำนวนเงิน')],
      report: { ...statement, subtitle: 'ณ วันที่ {asOf|date}', check: { path: 'totals.balanced', ok: 'สินทรัพย์ = หนี้สิน + ส่วนของผู้ถือหุ้น', fail: 'งบไม่สมดุล ต่างกัน {totals.difference|money} บาท' } },
      empty: 'ยังไม่มีรายการ',
    },
    vatReport: {
      kind: 'list', title: 'สรุปภาษีมูลค่าเพิ่มรายเดือน (ภ.พ.30)', endpoint: '/reports/vat', rows: 'rows', perm: REPORT,
      filters: [{ name: 'year', label: 'ปี ค.ศ. (เว้นว่าง = ปีนี้)', type: 'number' }],
      columns: [
        { key: 'month_th', label: 'เดือนภาษี' }, acc('output_base', 'ยอดขาย (ฐานภาษี)', true), acc('output_vat', 'ภาษีขาย', true),
        acc('input_base', 'ยอดซื้อ (ฐานภาษี)', true), acc('input_vat', 'ภาษีซื้อ', true), acc('net', 'ชำระเพิ่ม (ขอคืน)', true), { key: 'result', label: 'ผล' },
      ],
      report: { subtitle: 'ปีภาษี {year|year}', totalLabel: 'รวมทั้งปี' },
    },
    vatLines: {
      kind: 'list', title: 'รายงานภาษีขาย / ภาษีซื้อ', endpoint: '/reports/vat/lines', rows: 'rows', perm: REPORT,
      filters: [
        { name: 'kind', label: 'รายงาน', type: 'select', options: [{ value: 'output', label: 'ภาษีขาย' }, { value: 'input', label: 'ภาษีซื้อ' }], default: 'output' },
        { name: 'month', label: 'เดือนภาษี (เว้นว่าง = เดือนนี้)', type: 'month' },
      ],
      columns: [
        { key: 'seq', label: 'ลำดับ' }, { key: 'entry_date', label: 'วันที่', format: 'date' }, { key: 'ref', label: 'เลขที่ใบกำกับ/เอกสาร' },
        { key: 'partner_name', label: 'ชื่อผู้ซื้อ/ผู้ขาย' }, { key: 'no', label: 'สมุดรายวัน' }, acc('tax_base', 'มูลค่าสินค้า/บริการ', true), acc('vat', 'ภาษีมูลค่าเพิ่ม', true),
      ],
      report: { subtitle: '{title} เดือนภาษี {monthTh}' },
      rowLink: { screen: 'jvDetail', idFrom: 'journal_id' },
      empty: 'ไม่มีรายการภาษีในเดือนนี้',
    },
    whtReceived: {
      kind: 'list', title: 'ภาษีเงินได้ถูกหัก ณ ที่จ่าย (ติดตามหนังสือรับรอง 50 ทวิ)', endpoint: '/reports/wht-received', rows: 'lines', perm: REPORT,
      filters: [{ name: 'year', label: 'ปี ค.ศ. (เว้นว่าง = ปีนี้)', type: 'number' }],
      columns: [
        { key: 'entry_date', label: 'วันที่', format: 'date' }, { key: 'ref', label: 'ใบเสร็จ' }, { key: 'partner_name', label: 'ลูกค้า (ผู้หักภาษี)' },
        { key: 'no', label: 'สมุดรายวัน' }, acc('amount', 'ภาษีถูกหัก', true),
      ],
      report: { subtitle: 'ปี {year|year}' },
      rowLink: { screen: 'jvDetail', idFrom: 'journal_id' },
      empty: 'ไม่มีภาษีถูกหัก ณ ที่จ่ายในปีนี้',
    },
    revenueTrend: {
      kind: 'list', title: 'รายได้ ค่าใช้จ่าย กำไร 6 เดือน', endpoint: '/summary', rows: 'months', perm: REPORT, mobile: true,
      columns: [{ key: 'month', label: 'เดือน', format: 'month' }, acc('revenue', 'รายได้', true), acc('expense', 'ค่าใช้จ่าย', true), acc('net', 'กำไร (ขาดทุน)', true)],
      report: {},
    },
  },
  widgets: [
    { id: 'accounting-kpi', kind: 'kpi', title: 'บัญชีเดือนนี้', endpoint: '/summary', perm: REPORT, size: 'wide', href: 'profitLoss',
      items: [
        { key: 'revenueMonth', label: 'รายได้', format: 'money', tone: 'ok' },
        { key: 'expenseMonth', label: 'ค่าใช้จ่าย', format: 'money' },
        { key: 'netMonth', label: 'กำไร (ขาดทุน)', format: 'money' },
        { key: 'arBalance', label: 'ลูกหนี้คงค้าง', format: 'money', tone: 'warn' },
        { key: 'apBalance', label: 'เจ้าหนี้คงค้าง', format: 'money' },
        { key: 'postingErrors', label: 'ลงบัญชีไม่สำเร็จ', format: 'qty', tone: 'stop' },
      ] },
    { id: 'accounting-revenue', kind: 'trend', title: 'รายได้ 6 เดือน', endpoint: '/summary', perm: REPORT, size: 'md', href: 'revenueTrend', rows: 'months', x: 'month', y: 'revenue', format: 'money' },
    { id: 'accounting-net', kind: 'trend', title: 'กำไร (ขาดทุน) 6 เดือน', endpoint: '/summary', perm: REPORT, size: 'md', href: 'revenueTrend', rows: 'months', x: 'month', y: 'net', format: 'money' },
  ],
});
