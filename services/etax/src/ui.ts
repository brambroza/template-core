import { defineUi, type Field } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const READ = 'etax.document.read';
const WRITE = 'etax.document.write';
const SETTINGS = 'etax.settings.write';

const statuses = [
  { value: 'incomplete', label: 'ข้อมูลไม่พอ' }, { value: 'draft', label: 'รอสร้าง XML' }, { value: 'generated', label: 'สร้าง XML แล้ว' },
  { value: 'signed', label: 'ลงลายมือชื่อแล้ว' }, { value: 'sent_manual', label: 'บันทึกว่าส่งแล้ว (e-Tax by Email)' }, { value: 'sent_sp', label: 'บันทึกว่าส่งผ่านผู้ให้บริการ' },
  { value: 'cancelled', label: 'ยกเลิก (ไม่ออกเป็น e-Tax)' }, { value: 'replaced', label: 'ถูกแทนที่ด้วยฉบับใหม่' },
];
/** shown at the top of every screen of this module (same text as BOUNDARY in service.ts — tests compare them) */
export const BOUNDARY_TEXT = 'ระบบนี้ไม่ได้ส่งให้กรมสรรพากร/ETDA — ส่งผ่าน e-Tax Invoice by Email หรือผู้ให้บริการ แล้วบันทึกผลที่นี่';
const kinds = [{ value: 'invoice', label: 'ใบกำกับภาษี' }, { value: 'credit', label: 'ใบลดหนี้' }, { value: 'debit', label: 'ใบเพิ่มหนี้' }];

/** ETDA purpose codes (CHECK against the current ETDA code list — see etda.ts) */
export const purposeCodes = [
  { value: 'CDNG01', label: 'ลดหนี้: ลดราคาสินค้า (ผิดข้อกำหนด)' }, { value: 'CDNG02', label: 'ลดหนี้: สินค้าชำรุดเสียหาย' },
  { value: 'CDNG03', label: 'ลดหนี้: สินค้าขาดจำนวน' }, { value: 'CDNG04', label: 'ลดหนี้: คำนวณราคาสินค้าสูงเกินจริง' },
  { value: 'CDNG05', label: 'ลดหนี้: รับคืนสินค้า' }, { value: 'CDNG99', label: 'ลดหนี้: เหตุอื่น (สินค้า)' },
  { value: 'CDNS01', label: 'ลดหนี้: ลดราคาค่าบริการ' }, { value: 'CDNS02', label: 'ลดหนี้: ค่าบริการขาดจำนวน' },
  { value: 'CDNS03', label: 'ลดหนี้: คำนวณค่าบริการสูงเกินจริง' }, { value: 'CDNS04', label: 'ลดหนี้: บอกเลิกสัญญาบริการ' },
  { value: 'CDNS99', label: 'ลดหนี้: เหตุอื่น (บริการ)' },
  { value: 'DBNG01', label: 'เพิ่มหนี้: เพิ่มราคาสินค้า' }, { value: 'DBNG02', label: 'เพิ่มหนี้: คำนวณราคาสินค้าต่ำกว่าจริง' },
  { value: 'DBNG99', label: 'เพิ่มหนี้: เหตุอื่น (สินค้า)' }, { value: 'DBNS01', label: 'เพิ่มหนี้: เพิ่มราคาค่าบริการ' },
  { value: 'DBNS02', label: 'เพิ่มหนี้: คำนวณค่าบริการต่ำกว่าจริง' }, { value: 'DBNS99', label: 'เพิ่มหนี้: เหตุอื่น (บริการ)' },
];
/** replacement tax invoice (ออกฉบับใหม่แทนฉบับเดิม) — ETDA TIVC codes, non-amount errors only */
export const replaceCodes = [
  { value: 'TIVC01', label: 'TIVC01 ชื่อผิด' }, { value: 'TIVC02', label: 'TIVC02 ที่อยู่ผิด' }, { value: 'TIVC99', label: 'TIVC99 เหตุอื่น' },
];

const HELP_SEND = 'ระบบไม่ได้ส่งเอกสารให้กรมสรรพากร/ETDA (สพธอ.) — บันทึกหลังจากคุณส่งเองแล้วเท่านั้น: e-Tax Invoice by Email = ส่งอีเมลถึงผู้ซื้อและสำเนาถึงระบบของ สพธอ.; ผู้ให้บริการ = อัปโหลด XML ในระบบของผู้ให้บริการที่กรมสรรพากรอนุมัติ';

const settingsFields: Field[] = [
  { name: 'sellerName', label: 'ชื่อผู้ขาย (ตามที่จดทะเบียน ภ.พ.20)', type: 'text', required: true, help: 'เช่น บริษัท สยามพาร์ท เมทัลเวิร์ค จำกัด — ข้อมูลชุดนี้เป็นของโมดูล e-Tax เอง (แยกจากข้อมูลบริษัทในหัวเอกสาร)' },
  { name: 'taxId', label: 'เลขประจำตัวผู้เสียภาษี', type: 'text', required: true, help: '13 หลัก (ตรวจเลขตรวจสอบให้)' },
  { name: 'branch', label: 'รหัสสาขา', type: 'text', default: '00000', required: true, help: 'สำนักงานใหญ่ = 00000' },
  { name: 'buildingNumber', label: 'เลขที่', type: 'text' },
  { name: 'addressLine1', label: 'ที่อยู่ บรรทัด 1', type: 'text', required: true, help: 'อาคาร หมู่ ซอย ถนน' },
  { name: 'addressLine2', label: 'ที่อยู่ บรรทัด 2', type: 'text' },
  { name: 'subdistrict', label: 'ตำบล/แขวง', type: 'text' },
  { name: 'subdistrictCode', label: 'รหัสตำบล/แขวง (6 หลัก)', type: 'text', help: 'รหัสตามกรมการปกครอง เช่น 100101 — มาตรฐาน ETDA ใช้รหัสสำหรับที่อยู่ในไทย' },
  { name: 'district', label: 'อำเภอ/เขต', type: 'text' },
  { name: 'districtCode', label: 'รหัสอำเภอ/เขต (4 หลัก)', type: 'text', help: 'เช่น 1001' },
  { name: 'province', label: 'จังหวัด', type: 'text' },
  { name: 'provinceCode', label: 'รหัสจังหวัด (2 หลัก)', type: 'text', help: 'เช่น 10 = กรุงเทพมหานคร' },
  { name: 'postcode', label: 'รหัสไปรษณีย์', type: 'text', required: true },
  { name: 'email', label: 'อีเมลผู้ขาย', type: 'email' },
  { name: 'phone', label: 'โทรศัพท์', type: 'text' },
  { name: 'invoiceTypeCode', label: 'ประเภทใบกำกับภาษีเริ่มต้น', type: 'select', default: 'T02', options: [{ value: 'T02', label: 'T02 ใบแจ้งหนี้/ใบกำกับภาษี' }, { value: '388', label: '388 ใบกำกับภาษี' }] },
];

export default defineUi({
  module: 'etax',
  label: 'e-Tax Invoice',
  glyph: 'อ',
  area: 'finance',
  menu: [
    { label: 'เอกสาร e-Tax', screen: 'documents' },
    { label: 'ตั้งค่า e-Tax', screen: 'settings' },
  ],
  statusLabels: Object.fromEntries(statuses.map((s) => [s.value, s.label])),
  widgets: [{
    id: 'etaxPulse', kind: 'kpi', title: 'e-Tax Invoice', endpoint: '/summary', perm: READ, href: 'documents', size: 'md',
    items: [
      { key: 'draft', label: 'รอสร้าง XML', format: 'qty', tone: 'warn' },
      { key: 'ready', label: 'พร้อมส่ง (ยังไม่บันทึกส่ง)', format: 'qty', tone: 'neutral' },
      { key: 'incomplete', label: 'ข้อมูลไม่พอ', format: 'qty', tone: 'stop' },
    ],
  }],
  search: [{ id: 'etaxDocs', title: 'เอกสาร e-Tax', endpoint: '/documents', label: ['doc_no', 'buyer_name'], screen: 'document', perm: READ }],
  screens: {
    documents: {
      kind: 'list', title: 'เอกสาร e-Tax Invoice — เตรียมไฟล์เท่านั้น ระบบไม่ได้ส่งให้กรมสรรพากร/ETDA', endpoint: '/documents', perm: READ,
      filters: [
        { name: 'status', label: 'สถานะ', type: 'select', options: [{ value: 'open', label: 'ยังไม่บันทึกส่ง' }, { value: 'sent', label: 'บันทึกส่งแล้ว' }, ...statuses] },
        { name: 'kind', label: 'ประเภท', type: 'select', options: kinds },
        { name: 'from', label: 'ตั้งแต่', type: 'date' },
        { name: 'to', label: 'ถึง', type: 'date' },
        { name: 'q', label: 'ค้นหา (เลขที่ / ผู้ซื้อ)', type: 'text' },
      ],
      columns: [
        { key: 'doc_no', label: 'เลขที่' }, { key: 'kind_label', label: 'ประเภท' }, { key: 'issue_date', label: 'วันที่', format: 'date' },
        { key: 'buyer_name', label: 'ผู้ซื้อ' }, { key: 'ref_invoice_no', label: 'อ้างอิงใบกำกับ', phone: false }, { key: 'replaces_no', label: 'ออกแทนฉบับ', phone: false },
        { key: 'gross', label: 'ยอดรวม', format: 'money' }, { key: 'status', label: 'สถานะ', format: 'status' },
      ],
      rowLink: { screen: 'document' },
      empty: 'ยังไม่มีเอกสาร — ใบกำกับภาษี ใบลดหนี้ และใบเพิ่มหนี้จากโมดูลขายจะมาที่นี่อัตโนมัติ · ' + BOUNDARY_TEXT,
    },
    document: {
      kind: 'detail', title: 'เอกสาร e-Tax', endpoint: '/documents/:id', perm: READ, heading: 'doc_no',
      flow: {
        field: 'status',
        steps: [{ value: 'draft', label: 'รอสร้าง XML' }, { value: 'generated', label: 'สร้าง XML' }, { value: 'signed', label: 'ลงลายมือชื่อ' }, { value: 'sent_manual', label: 'บันทึกการส่ง' }],
        exits: [{ value: 'incomplete', label: 'ข้อมูลไม่พอ' }, { value: 'sent_sp', label: 'ส่งผ่านผู้ให้บริการ' }, { value: 'cancelled', label: 'ยกเลิก' }, { value: 'replaced', label: 'ถูกแทนที่' }],
      },
      fields: [
        { key: 'boundary', label: 'ขอบเขตของระบบ' },
        { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'kind_label', label: 'เอกสาร' }, { key: 'type_label', label: 'ประเภทตาม ETDA' }, { key: 'issue_date', label: 'วันที่', format: 'date' },
        { key: 'ref_invoice_no', label: 'อ้างถึงใบกำกับภาษีเลขที่' }, { key: 'ref_invoice_date', label: 'ลงวันที่', format: 'date' },
        { key: 'replaces_no', label: 'ออกแทนฉบับเลขที่' }, { key: 'replaces_date', label: 'ฉบับเดิมลงวันที่', format: 'date' },
        { key: 'replaced_by_no', label: 'ถูกแทนที่ด้วยฉบับเลขที่' },
        { key: 'purpose_label', label: 'รหัสเหตุผล (ETDA)' }, { key: 'reason', label: 'เหตุผล' },
        { key: 'cancel_reason', label: 'เหตุผลที่ยกเลิก' }, { key: 'cancelled_by_name', label: 'ยกเลิกโดย' },
        { key: 'buyer_name', label: 'ผู้ซื้อ', section: 'ผู้ซื้อ' }, { key: 'buyer_tax_id', label: 'เลขผู้เสียภาษี' }, { key: 'buyer_branch', label: 'สาขา' },
        { key: 'buyer_address', label: 'ที่อยู่' }, { key: 'buyer_email', label: 'อีเมล' },
        { key: 'original_net', label: 'มูลค่าตามใบกำกับเดิม', format: 'money', section: 'ยอดเงิน', hideZero: true },
        { key: 'correct_net', label: 'มูลค่าที่ถูกต้อง', format: 'money', hideZero: true },
        { key: 'net', label: 'มูลค่าก่อนภาษี', format: 'money' }, { key: 'vat', label: 'ภาษีมูลค่าเพิ่ม', format: 'money' },
        { key: 'gross', label: 'รวมทั้งสิ้น', format: 'money', emphasis: true },
        { key: 'problems_text', label: 'ต้องแก้ก่อนสร้าง XML', section: 'การตรวจสอบ' },
        { key: 'warnings_text', label: 'ข้อสังเกต' },
        { key: 'verification', label: 'ผลตรวจไฟล์ (ตัวตรวจในระบบ)' },
        { key: 'generated_at', label: 'สร้าง XML เมื่อ', format: 'datetime' },
        { key: 'signed_at', label: 'ลงลายมือชื่อเมื่อ', format: 'datetime' }, { key: 'signing_cert_subject', label: 'ใบรับรองที่ใช้' },
        { key: 'sent_channel_label', label: 'ช่องทางที่ส่ง', section: 'การส่ง (บันทึกโดยผู้ใช้)' }, { key: 'sent_date', label: 'วันที่ส่ง', format: 'date' },
        { key: 'sent_reference', label: 'เลขอ้างอิง' }, { key: 'sent_by_name', label: 'บันทึกโดย' },
        { key: 'help', label: 'วิธีส่ง e-Tax' },
      ],
      lines: [{
        path: 'lines', label: 'รายการ',
        columns: [
          { key: 'line_no', label: '#' }, { key: 'itemCode', label: 'รหัส' }, { key: 'description', label: 'รายการ' },
          { key: 'qty', label: 'จำนวน', format: 'qty' }, { key: 'unitPrice', label: 'ราคา/หน่วย', format: 'money' },
          { key: 'amount', label: 'จำนวนเงิน', format: 'money', total: true },
        ],
      }],
      attachments: { entity: 'document', label: 'ไฟล์ XML (ดาวน์โหลด) และหลักฐานการส่ง' },
      actions: [
        {
          id: 'generateInvoice', label: 'สร้าง XML', method: 'POST', endpoint: '/documents/:id/generate', perm: WRITE, tone: 'primary',
          when: { field: 'generate_as', in: ['invoice', 'replacement'] },
          fields: [{ name: 'typeCode', label: 'ประเภทเอกสาร', type: 'select', options: [{ value: 'T02', label: 'T02 ใบแจ้งหนี้/ใบกำกับภาษี' }, { value: '388', label: '388 ใบกำกับภาษี' }], help: 'เว้นว่าง = ตามตั้งค่า · สร้างใหม่จะยกเลิกลายมือชื่อเดิม' }],
        },
        {
          id: 'generateNote', label: 'สร้าง XML', method: 'POST', endpoint: '/documents/:id/generate', perm: WRITE, tone: 'primary',
          when: { field: 'generate_as', in: ['note'] },
          fields: [{ name: 'purposeCode', label: 'รหัสเหตุผล (ETDA)', type: 'select', options: purposeCodes, help: 'เว้นว่าง = เหตุอื่น (CDNG99 / DBNG99) พร้อมข้อความเหตุผลจากเอกสาร' }],
        },
        {
          id: 'sign', label: 'ลงลายมือชื่อดิจิทัล', method: 'POST', endpoint: '/documents/:id/sign', perm: WRITE, tone: 'primary',
          when: { field: 'status', in: ['generated'] },
          fields: [{ name: 'password', label: 'รหัสผ่านใบรับรอง (.p12)', type: 'password', help: 'ใช้ครั้งนี้ครั้งเดียว ระบบไม่บันทึก · เว้นว่างได้ถ้าผู้ดูแลตั้ง ETAX_P12_PASSWORD ไว้' }],
        },
        {
          id: 'resign', label: 'ลงลายมือชื่อใหม่', method: 'POST', endpoint: '/documents/:id/sign', perm: WRITE,
          when: { field: 'status', in: ['signed'] },
          fields: [{ name: 'password', label: 'รหัสผ่านใบรับรอง (.p12)', type: 'password', help: 'ใช้ครั้งนี้ครั้งเดียว ระบบไม่บันทึก' }],
        },
        {
          id: 'markSent', label: 'บันทึกว่าส่งแล้ว', method: 'POST', endpoint: '/documents/:id/mark-sent', perm: WRITE,
          when: { field: 'status', in: ['generated', 'signed'] },
          confirm: 'ยืนยันว่าคุณส่งเอกสารนี้ด้วยตัวเองแล้ว? ระบบไม่ได้ส่งและไม่ได้ตรวจสอบการส่ง',
          fields: [
            { name: 'channel', label: 'ช่องทาง', type: 'select', required: true, options: [{ value: 'email_etda', label: 'e-Tax Invoice by Email (สพธอ.)' }, { value: 'service_provider', label: 'ผู้ให้บริการ (Service Provider)' }], help: HELP_SEND },
            { name: 'sentDate', label: 'วันที่ส่ง', type: 'date', help: 'เว้นว่าง = วันนี้' },
            { name: 'reference', label: 'เลขอ้างอิง', type: 'text', help: 'เช่น เลขอ้างอิงจากอีเมลตอบกลับของ สพธอ. หรือเลขที่รายการของผู้ให้บริการ' },
            { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
          ],
        },
        {
          id: 'unmarkSent', label: 'ยกเลิกการบันทึกส่ง', method: 'POST', endpoint: '/documents/:id/unmark-sent', perm: WRITE,
          when: { field: 'status', in: ['sent_manual', 'sent_sp'] }, confirm: 'ยกเลิกการบันทึกว่าส่งแล้ว? (ใช้เมื่อบันทึกผิด)',
        },
        {
          id: 'editBuyer', label: 'แก้ข้อมูลผู้ซื้อ', method: 'PATCH', endpoint: '/documents/:id/buyer', perm: WRITE,
          when: { field: 'status', in: ['draft', 'generated', 'signed'] },
          confirm: 'แก้ข้อมูลผู้ซื้อจะล้าง XML/ลายมือชื่อเดิม ต้องสร้างใหม่ — ข้อมูลต้องตรงกับใบกำกับภาษีที่ออกจริง (ควรแก้ข้อมูลลูกค้าในโมดูลขายด้วย)',
          fields: [
            { name: 'buyerName', label: 'ชื่อผู้ซื้อ', type: 'text' },
            { name: 'buyerTaxId', label: 'เลขผู้เสียภาษี', type: 'text' },
            { name: 'buyerBranch', label: 'รหัสสาขา', type: 'text', help: '5 หลัก, สำนักงานใหญ่ = 00000' },
            { name: 'buyerAddress', label: 'ที่อยู่ (มีรหัสไปรษณีย์)', type: 'textarea' },
            { name: 'buyerEmail', label: 'อีเมลผู้ซื้อ', type: 'email' },
          ],
        },
        {
          id: 'replace', label: 'ออกใบกำกับภาษีฉบับใหม่แทน', method: 'POST', endpoint: '/documents/:id/replace', perm: WRITE,
          when: { field: 'replace_allowed', in: [true] }, then: { screen: 'document', idFrom: 'id' },
          confirm: 'สร้างใบกำกับภาษีอิเล็กทรอนิกส์ฉบับใหม่แทนฉบับเดิม (ยอดเงินเท่าเดิม)? ฉบับเดิมจะเป็น "ถูกแทนที่" — ต้องสร้าง XML ลงลายมือชื่อ และส่งฉบับใหม่เอง',
          fields: [
            { name: 'purposeCode', label: 'เหตุที่ออกแทน (ETDA)', type: 'select', required: true, options: replaceCodes, help: 'ใช้แก้ชื่อ/ที่อยู่/ข้อมูลอื่นที่ไม่ใช่ยอดเงิน — ยอดเงินผิดให้ออกใบลดหนี้/ใบเพิ่มหนี้ในโมดูลขาย' },
            { name: 'reason', label: 'คำอธิบาย', type: 'text', help: 'จำเป็นสำหรับ TIVC99' },
            { name: 'buyerName', label: 'ชื่อผู้ซื้อที่ถูกต้อง', type: 'text', help: 'เว้นว่าง = ตามฉบับเดิม' },
            { name: 'buyerTaxId', label: 'เลขผู้เสียภาษี', type: 'text' },
            { name: 'buyerBranch', label: 'รหัสสาขา', type: 'text', help: '5 หลัก, สำนักงานใหญ่ = 00000' },
            { name: 'buyerAddress', label: 'ที่อยู่ที่ถูกต้อง (มีรหัสไปรษณีย์)', type: 'textarea' },
            { name: 'buyerEmail', label: 'อีเมลผู้ซื้อ', type: 'email' },
            { name: 'docNo', label: 'เลขที่ฉบับใหม่', type: 'text', help: 'เว้นว่าง = เลขเดิมต่อท้าย -R1, -R2 … (ตรวจรูปแบบเลขที่กับผู้ทำบัญชี/ผู้ให้บริการ)' },
            { name: 'issueDate', label: 'วันที่ฉบับใหม่', type: 'date', help: 'เว้นว่าง = วันนี้' },
          ],
        },
        {
          id: 'cancel', label: 'ยกเลิกในระบบ e-Tax', method: 'POST', endpoint: '/documents/:id/cancel', perm: WRITE, tone: 'danger',
          when: { field: 'status', in: ['incomplete', 'draft', 'generated', 'signed'] },
          confirm: 'ยกเลิกเอกสารนี้ในโมดูล e-Tax (จะไม่ออกเป็น e-Tax จากที่นี่)? ไม่ได้ยกเลิกใบกำกับภาษีในโมดูลขาย และใช้ได้เฉพาะเอกสารที่ยังไม่ได้ส่ง',
          fields: [{ name: 'reason', label: 'เหตุผล', type: 'text', required: true, help: 'เช่น ออกใบกำกับภาษีแบบกระดาษแล้ว' }],
        },
        {
          id: 'restore', label: 'นำกลับมา', method: 'POST', endpoint: '/documents/:id/restore', perm: WRITE,
          when: { field: 'status', in: ['cancelled'] }, confirm: 'นำเอกสารกลับมาเป็น "รอสร้าง XML"?',
        },
      ],
    },
    settings: {
      kind: 'detail', title: 'ตั้งค่า e-Tax Invoice', endpoint: '/settings', perm: SETTINGS, heading: 'sellerName', edit: 'settingsEdit',
      fields: [
        { key: 'boundary', label: 'ขอบเขตของระบบ' },
        { key: 'configured', label: 'ข้อมูลผู้ขายครบ', format: 'boolean' },
        { key: 'problems', label: 'ยังขาด', format: 'list' },
        { key: 'tax_id_text', label: 'เลขผู้เสียภาษี / สาขา' },
        { key: 'buildingNumber', label: 'เลขที่' }, { key: 'addressLine1', label: 'ที่อยู่' }, { key: 'addressLine2', label: 'ที่อยู่ (ต่อ)' },
        { key: 'subdistrict', label: 'ตำบล/แขวง' }, { key: 'subdistrictCode', label: 'รหัสตำบล' }, { key: 'district', label: 'อำเภอ/เขต' },
        { key: 'districtCode', label: 'รหัสอำเภอ' }, { key: 'province', label: 'จังหวัด' }, { key: 'provinceCode', label: 'รหัสจังหวัด' },
        { key: 'postcode', label: 'รหัสไปรษณีย์' }, { key: 'email', label: 'อีเมล' }, { key: 'phone', label: 'โทรศัพท์' },
        { key: 'invoice_type_label', label: 'ประเภทใบกำกับภาษีเริ่มต้น' },
        { key: 'has_certificate', label: 'มีใบรับรองดิจิทัล', format: 'boolean', section: 'ใบรับรองดิจิทัล (.p12)' },
        { key: 'cert_subject', label: 'ผู้ถือใบรับรอง' }, { key: 'certificate.issuer', label: 'ออกโดย' },
        { key: 'cert_not_after', label: 'หมดอายุ', format: 'datetime' }, { key: 'cert_expired', label: 'หมดอายุแล้ว', format: 'boolean' },
        { key: 'password_source_label', label: 'รหัสผ่านใบรับรอง' },
        { key: 'help', label: 'วิธีส่ง e-Tax', section: 'ขอบเขตของโมดูลนี้' },
      ],
      actions: [
        {
          id: 'uploadCertificate', label: 'อัปโหลดใบรับรอง (.p12)', method: 'POST', endpoint: '/settings/certificate', perm: SETTINGS, tone: 'primary',
          fields: [
            { name: 'fileName', label: 'ชื่อไฟล์', type: 'text', help: 'เช่น company-2569.p12' },
            { name: 'dataBase64', label: 'ไฟล์ .p12 แบบ base64', type: 'textarea', required: true, help: 'macOS/Linux: base64 -i company.p12 · Windows: certutil -encode company.p12 out.txt แล้ววางเนื้อหา (ไม่ต้องมีบรรทัด BEGIN/END)' },
            { name: 'password', label: 'รหัสผ่านใบรับรอง', type: 'password', help: 'ใช้ตรวจว่าเปิดไฟล์ได้เท่านั้น ระบบไม่บันทึกรหัสผ่าน' },
          ],
        },
        {
          id: 'removeCertificate', label: 'ลบใบรับรอง', method: 'DELETE', endpoint: '/settings/certificate', perm: SETTINGS, tone: 'danger',
          when: { field: 'has_certificate', in: [true] }, confirm: 'ลบใบรับรองออกจากระบบ? ลงลายมือชื่อเอกสารใหม่ไม่ได้จนกว่าจะอัปโหลดใหม่',
        },
      ],
    },
    settingsEdit: {
      kind: 'form', title: 'ข้อมูลผู้ขายสำหรับ e-Tax', method: 'PUT', endpoint: '/settings', load: '/settings', perm: SETTINGS,
      fields: settingsFields, submitLabel: 'บันทึก', after: { screen: 'settings' },
    },
  },
});
