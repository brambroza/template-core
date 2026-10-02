import { defineUi, type Field, type Lookup } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const opt = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const sources = opt([['website', 'เว็บไซต์'], ['line', 'LINE'], ['phone', 'โทรเข้า'], ['expo', 'งานแสดงสินค้า'], ['referral', 'ลูกค้าแนะนำ'], ['other', 'อื่นๆ']]);
const leadStatuses = opt([['new', 'ใหม่'], ['contacted', 'ติดต่อแล้ว'], ['qualified', 'มีศักยภาพ'], ['converted', 'เปิดโอกาสขายแล้ว'], ['lost', 'ไม่สำเร็จ']]);
const stages = opt([['prospect', 'สนใจ'], ['proposal', 'เสนอราคา'], ['negotiation', 'ต่อรอง'], ['won', 'ปิดการขายได้'], ['lost', 'แพ้']]);
const quoteStatuses = opt([['draft', 'ร่าง'], ['sent', 'ส่งแล้ว'], ['accepted', 'ลูกค้าตอบรับ'], ['rejected', 'ลูกค้าปฏิเสธ'], ['expired', 'หมดอายุ']]);
const activityTypes = opt([['call', 'โทร'], ['meeting', 'ประชุม'], ['email', 'อีเมล'], ['visit', 'เยี่ยมลูกค้า'], ['task', 'งานติดตาม']]);

const customerLookup: Lookup = {
  module: 'master-data', path: '/partners', query: { kind: 'customer' }, label: ['code', 'name'],
  assign: { partnerId: 'id', customerName: 'name', customerTaxId: 'tax_id', customerBranch: 'branch', customerAddress: 'address' },
};
const ownerField: Field = {
  name: 'ownerId', label: 'ผู้รับผิดชอบ', type: 'lookup', help: 'เว้นว่าง = ตัวเอง',
  lookup: { module: 'identity', path: '/users/directory', label: ['name', 'email'], assign: { ownerId: 'id', ownerName: 'name' } },
};

const leadFields: Field[] = [
  { name: 'company', label: 'บริษัท/ร้าน', type: 'text', required: true },
  { name: 'contactName', label: 'ผู้ติดต่อ', type: 'text' },
  { name: 'phone', label: 'โทรศัพท์', type: 'text' },
  { name: 'email', label: 'อีเมล', type: 'email' },
  { name: 'lineId', label: 'LINE ID', type: 'text' },
  { name: 'source', label: 'มาจาก', type: 'select', default: 'other', options: sources },
  { name: 'interest', label: 'สนใจสินค้า/บริการ', type: 'text' },
  ownerField,
  { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
];

const opportunityFields: Field[] = [
  { name: 'name', label: 'ชื่อโอกาสขาย', type: 'text', required: true },
  { name: 'partnerId', label: 'ลูกค้าในระบบ', type: 'lookup', lookup: { ...customerLookup, assign: { partnerId: 'id', customerName: 'name' } } },
  { name: 'customerName', label: 'ชื่อลูกค้า/บริษัท', type: 'text', required: true },
  { name: 'value', label: 'มูลค่าคาดการณ์ (บาท)', type: 'number', step: 0.01 },
  { name: 'probability', label: 'โอกาสสำเร็จ (%)', type: 'number', help: 'เว้นว่าง = ตามขั้นตอน' },
  { name: 'expectedClose', label: 'คาดว่าจะปิดการขาย', type: 'date' },
  ownerField,
  { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
];

const activityFields: Field[] = [
  { name: 'type', label: 'ประเภท', type: 'select', required: true, default: 'call', options: activityTypes },
  { name: 'subject', label: 'เรื่อง', type: 'text', required: true },
  { name: 'dueAt', label: 'กำหนด', type: 'date' },
  { name: 'done', label: 'ทำเสร็จแล้ว (บันทึกย้อนหลัง)', type: 'boolean' },
  { name: 'note', label: 'บันทึก', type: 'textarea' },
];

const activityColumns = [
  { key: 'type_label', label: 'ประเภท' }, { key: 'subject', label: 'เรื่อง' }, { key: 'due_at', label: 'กำหนด', format: 'date' as const },
  { key: 'done', label: 'เสร็จ', format: 'boolean' as const }, { key: 'overdue', label: 'เลยกำหนด', format: 'boolean' as const }, { key: 'note', label: 'บันทึก' },
];

const quoteFields: Field[] = [
  { name: 'partnerId', label: 'ลูกค้า', type: 'lookup', lookup: customerLookup, help: 'เลือกจากทะเบียนลูกค้า หรือพิมพ์ชื่อด้านล่าง' },
  { name: 'customerName', label: 'ชื่อลูกค้า', type: 'text', required: true },
  { name: 'customerTaxId', label: 'เลขประจำตัวผู้เสียภาษี', type: 'text' },
  { name: 'customerBranch', label: 'สาขา', type: 'text' },
  { name: 'customerAddress', label: 'ที่อยู่', type: 'textarea' },
  { name: 'contactName', label: 'เรียน (ผู้ติดต่อ)', type: 'text' },
  { name: 'opportunityId', label: 'โอกาสขาย', type: 'lookup', lookup: { path: '/opportunities', query: { open: '1' }, label: ['no', 'name', 'customer_name'], assign: { opportunityId: 'id' } } },
  { name: 'issueDate', label: 'วันที่', type: 'date' },
  { name: 'validUntil', label: 'ยืนราคาถึง', type: 'date', help: 'เว้นว่าง = 30 วัน' },
  { name: 'vatMode', label: 'ราคา', type: 'select', default: 'exclusive', options: opt([['exclusive', 'ยังไม่รวม VAT'], ['inclusive', 'รวม VAT แล้ว']]) },
  { name: 'note', label: 'เงื่อนไข/หมายเหตุ', type: 'textarea' },
];
const quoteLines = {
  name: 'lines', label: 'รายการเสนอราคา', min: 1,
  fields: [
    { name: 'itemId', label: 'สินค้า', type: 'lookup' as const, lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' } } },
    { name: 'description', label: 'รายละเอียด', type: 'text' as const },
    { name: 'qty', label: 'จำนวน', type: 'number' as const, required: true },
    { name: 'unitPrice', label: 'ราคาต่อหน่วย', type: 'number' as const, step: 0.01, required: true },
    { name: 'discountPct', label: 'ส่วนลด %', type: 'number' as const, step: 0.01 },
  ],
};

export default defineUi({
  module: 'crm',
  label: 'ลูกค้าสัมพันธ์',
  glyph: 'ล',
  icon: 'handshake',
  menu: [
    { label: 'ลีด', screen: 'leads' },
    { label: 'โอกาสขาย', screen: 'opportunities' },
    { label: 'ใบเสนอราคา', screen: 'quotes' },
    { label: 'กิจกรรมของฉัน', screen: 'myActivities' },
    { label: 'กิจกรรมทั้งหมด', screen: 'activities' },
  ],
  commands: [
    { id: 'quote', label: 'สร้างใบเสนอราคา', example: 'เสนอราคา CUS-001 แม่พิมพ์ 2 ชุด', keywords: ['เสนอราคา', 'ใบเสนอราคา', 'quote', 'qt'], screen: 'quoteNew', perm: 'crm.quote.write',
      arg: { lookup: customerLookup }, restField: 'note' },
    { id: 'lead', label: 'เพิ่มลีดใหม่', example: 'ลีด บริษัท สยามพาร์ท จำกัด', keywords: ['ลีด', 'lead', 'ลูกค้าใหม่'], screen: 'leadNew', perm: 'crm.lead.write', restField: 'company' },
    { id: 'visit', label: 'บันทึกกิจกรรม/เยี่ยมลูกค้า', example: 'เยี่ยมลูกค้า', keywords: ['เยี่ยมลูกค้า', 'บันทึกกิจกรรม', 'นัดลูกค้า'], screen: 'activityNew', perm: 'crm.activity.write' },
    { id: 'todo', label: 'งานติดตามลูกค้าของฉัน', example: 'งานติดตาม', keywords: ['งานติดตาม', 'ติดตามลูกค้า', 'follow'], screen: 'myActivities', perm: 'crm.lead.read' },
  ],
  search: [
    { id: 'leads', title: 'ลีด', endpoint: '/leads', label: ['no', 'company', 'contact_name'], screen: 'lead', perm: 'crm.lead.read' },
    { id: 'opportunities', title: 'โอกาสขาย', endpoint: '/opportunities', label: ['no', 'name', 'customer_name'], screen: 'opportunity', perm: 'crm.lead.read' },
    { id: 'quotes', title: 'ใบเสนอราคา', endpoint: '/quotations', label: ['no', 'customer_name'], screen: 'quote', perm: 'crm.quote.read' },
  ],
  screens: {
    /* ---------- leads ---------- */
    leads: {
      kind: 'list', title: 'ลีด (ผู้สนใจ)', endpoint: '/leads', perm: 'crm.lead.read', mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหาบริษัท ผู้ติดต่อ เบอร์โทร', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: leadStatuses },
        { name: 'source', label: 'มาจาก', type: 'select', options: sources },
      ],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'company', label: 'บริษัท' }, { key: 'contact_name', label: 'ผู้ติดต่อ' }, { key: 'phone', label: 'โทร' },
        { key: 'source_label', label: 'มาจาก' }, { key: 'interest', label: 'สนใจ' }, { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'created_at', label: 'เข้ามาเมื่อ', format: 'date' },
      ],
      create: 'leadNew', createLabel: 'เพิ่มลีด', rowLink: { screen: 'lead' }, empty: 'ยังไม่มีลีด',
      rowActions: [
        { id: 'contact', label: 'ติดต่อแล้ว', method: 'POST', endpoint: '/leads/:id/contact', perm: 'crm.lead.write', when: { field: 'status', in: ['new'] }, mobile: true },
      ],
    },
    leadNew: {
      kind: 'form', title: 'เพิ่มลีด', method: 'POST', endpoint: '/leads', perm: 'crm.lead.write', mobile: true,
      fields: leadFields, submitLabel: 'บันทึกลีด', after: { screen: 'lead', idFrom: 'id' },
    },
    leadEdit: {
      kind: 'form', title: 'แก้ไขลีด', method: 'PUT', endpoint: '/leads/:id', load: '/leads/:id', perm: 'crm.lead.write',
      fields: leadFields, submitLabel: 'บันทึกการแก้ไข', after: { screen: 'lead', idFrom: 'id' },
    },
    lead: {
      kind: 'detail', title: 'ลีด', endpoint: '/leads/:id', perm: 'crm.lead.read', heading: 'no', mobile: true, edit: 'leadEdit',
      flow: {
        field: 'status',
        steps: [{ value: 'new', label: 'ใหม่' }, { value: 'contacted', label: 'ติดต่อแล้ว' }, { value: 'qualified', label: 'มีศักยภาพ' }, { value: 'converted', label: 'เปิดโอกาสขาย' }],
        exits: [{ value: 'lost', label: 'ไม่สำเร็จ' }],
      },
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'company', label: 'บริษัท' }, { key: 'contact_name', label: 'ผู้ติดต่อ' },
        { key: 'phone', label: 'โทร' }, { key: 'email', label: 'อีเมล' }, { key: 'line_id', label: 'LINE ID' }, { key: 'source_label', label: 'มาจาก' },
        { key: 'interest', label: 'สนใจ' }, { key: 'owner_name', label: 'ผู้รับผิดชอบ' }, { key: 'note', label: 'หมายเหตุ' },
        { key: 'lost_reason', label: 'เหตุผลที่ไม่สำเร็จ' }, { key: 'converted_at', label: 'เปิดโอกาสขายเมื่อ', format: 'datetime' }, { key: 'created_at', label: 'เข้ามาเมื่อ', format: 'datetime' },
      ],
      lines: [{ path: 'activities', label: 'กิจกรรม', columns: activityColumns }],
      actions: [
        { id: 'contact', label: 'ติดต่อแล้ว', method: 'POST', endpoint: '/leads/:id/contact', perm: 'crm.lead.write', when: { field: 'status', in: ['new'] }, mobile: true },
        { id: 'qualify', label: 'มีศักยภาพ', method: 'POST', endpoint: '/leads/:id/qualify', perm: 'crm.lead.write', when: { field: 'status', in: ['new', 'contacted'] }, mobile: true },
        { id: 'convert', label: 'เปิดโอกาสขาย', method: 'POST', endpoint: '/leads/:id/convert', perm: 'crm.lead.write', when: { field: 'status', in: ['new', 'contacted', 'qualified'] }, tone: 'primary',
          fields: [
            { name: 'name', label: 'ชื่อโอกาสขาย', type: 'text', help: 'เว้นว่าง = สิ่งที่สนใจ — บริษัท' },
            { name: 'partnerId', label: 'ผูกกับลูกค้าในระบบ', type: 'lookup', lookup: { ...customerLookup, assign: { partnerId: 'id', customerName: 'name' } } },
            { name: 'value', label: 'มูลค่าคาดการณ์ (บาท)', type: 'number', step: 0.01 },
            { name: 'expectedClose', label: 'คาดว่าจะปิดการขาย', type: 'date' },
          ],
          then: { screen: 'opportunity', idFrom: 'id' } },
        { id: 'activity', label: 'บันทึกกิจกรรม', method: 'POST', endpoint: '/leads/:id/activities', perm: 'crm.activity.write', fields: activityFields, mobile: true },
        { id: 'lose', label: 'ไม่สำเร็จ', method: 'POST', endpoint: '/leads/:id/lose', perm: 'crm.lead.write', when: { field: 'status', in: ['new', 'contacted', 'qualified'] }, tone: 'danger',
          fields: [{ name: 'reason', label: 'เหตุผล', type: 'text', required: true }] },
      ],
    },

    /* ---------- opportunities ---------- */
    opportunities: {
      kind: 'list', title: 'โอกาสขาย', endpoint: '/opportunities', perm: 'crm.lead.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาชื่อหรือลูกค้า', type: 'text' }, { name: 'stage', label: 'ขั้นตอน', type: 'select', options: stages }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'name', label: 'โอกาสขาย' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'stage', label: 'ขั้นตอน', format: 'status' },
        { key: 'value', label: 'มูลค่า', format: 'money' }, { key: 'probability', label: 'โอกาส', format: 'percent' }, { key: 'weighted_value', label: 'มูลค่าถ่วงน้ำหนัก', format: 'money' },
        { key: 'expected_close', label: 'คาดปิด', format: 'date' }, { key: 'owner_name', label: 'ผู้รับผิดชอบ' },
      ],
      create: 'opportunityNew', createLabel: 'เพิ่มโอกาสขาย', rowLink: { screen: 'opportunity' }, empty: 'ยังไม่มีโอกาสขาย',
    },
    opportunityNew: {
      kind: 'form', title: 'เพิ่มโอกาสขาย', method: 'POST', endpoint: '/opportunities', perm: 'crm.lead.write',
      fields: opportunityFields, submitLabel: 'บันทึกโอกาสขาย', after: { screen: 'opportunity', idFrom: 'id' },
    },
    opportunityEdit: {
      kind: 'form', title: 'แก้ไขโอกาสขาย', method: 'PUT', endpoint: '/opportunities/:id', load: '/opportunities/:id', perm: 'crm.lead.write',
      fields: opportunityFields, submitLabel: 'บันทึกการแก้ไข', after: { screen: 'opportunity', idFrom: 'id' },
    },
    opportunity: {
      kind: 'detail', title: 'โอกาสขาย', endpoint: '/opportunities/:id', perm: 'crm.lead.read', heading: 'no', mobile: true, edit: 'opportunityEdit',
      flow: {
        field: 'stage',
        steps: [{ value: 'prospect', label: 'สนใจ' }, { value: 'proposal', label: 'เสนอราคา' }, { value: 'negotiation', label: 'ต่อรอง' }, { value: 'won', label: 'ปิดการขายได้' }],
        exits: [{ value: 'lost', label: 'แพ้' }],
      },
      fields: [
        { key: 'name', label: 'โอกาสขาย' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'stage', label: 'ขั้นตอน', format: 'status' },
        { key: 'value', label: 'มูลค่า', format: 'money' }, { key: 'probability', label: 'โอกาสสำเร็จ', format: 'percent' },
        { key: 'weighted_value', label: 'มูลค่าถ่วงน้ำหนัก', format: 'money' }, { key: 'expected_close', label: 'คาดปิด', format: 'date' },
        { key: 'owner_name', label: 'ผู้รับผิดชอบ' }, { key: 'note', label: 'หมายเหตุ' }, { key: 'lost_reason', label: 'เหตุผลที่แพ้' },
        { key: 'won_at', label: 'ปิดการขายเมื่อ', format: 'datetime' },
      ],
      lines: [
        { path: 'quotations', label: 'ใบเสนอราคา', columns: [{ key: 'no', label: 'เลขที่' }, { key: 'issue_date', label: 'วันที่', format: 'date' }, { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'gross', label: 'ยอดรวม', format: 'money' }] },
        { path: 'activities', label: 'กิจกรรม', columns: activityColumns },
      ],
      actions: [
        { id: 'advance', label: 'ไปขั้นถัดไป', method: 'POST', endpoint: '/opportunities/:id/advance', perm: 'crm.lead.write', when: { field: 'stage', in: ['prospect', 'proposal'] }, mobile: true },
        { id: 'win', label: 'ปิดการขายได้', method: 'POST', endpoint: '/opportunities/:id/win', perm: 'crm.lead.write', when: { field: 'stage', in: ['prospect', 'proposal', 'negotiation'] }, tone: 'primary', confirm: 'ยืนยันว่าลูกค้าตกลงซื้อ' },
        { id: 'activity', label: 'บันทึกกิจกรรม', method: 'POST', endpoint: '/opportunities/:id/activities', perm: 'crm.activity.write', fields: activityFields, mobile: true },
        { id: 'lose', label: 'แพ้', method: 'POST', endpoint: '/opportunities/:id/lose', perm: 'crm.lead.write', when: { field: 'stage', in: ['prospect', 'proposal', 'negotiation'] }, tone: 'danger',
          fields: [{ name: 'reason', label: 'เหตุผล (ราคา, คู่แข่ง, ยกเลิกโครงการ…)', type: 'text', required: true }] },
      ],
    },

    /* ---------- activities ---------- */
    myActivities: {
      kind: 'list', title: 'กิจกรรมที่ต้องทำของฉัน', endpoint: '/activities/mine', perm: 'crm.lead.read', mobile: true,
      columns: [
        { key: 'due_at', label: 'กำหนด', format: 'date' }, { key: 'type_label', label: 'ประเภท' }, { key: 'subject', label: 'เรื่อง' },
        { key: 'related_no', label: 'อ้างอิง' }, { key: 'related_name', label: 'ลูกค้า/ดีล' }, { key: 'overdue', label: 'เลยกำหนด', format: 'boolean' },
      ],
      create: 'activityNew', createLabel: 'บันทึกกิจกรรม', empty: 'ไม่มีงานค้าง',
      rowActions: [{ id: 'done', label: 'ทำแล้ว', method: 'POST', endpoint: '/activities/:id/done', perm: 'crm.activity.write', tone: 'primary', mobile: true }],
    },
    activities: {
      kind: 'list', title: 'กิจกรรมทั้งหมด', endpoint: '/activities', perm: 'crm.lead.read',
      filters: [
        { name: 'q', label: 'ค้นหาเรื่องหรือลูกค้า', type: 'text' },
        { name: 'type', label: 'ประเภท', type: 'select', options: activityTypes },
        { name: 'overdue', label: 'เฉพาะเลยกำหนด', type: 'boolean' },
      ],
      columns: [
        { key: 'due_at', label: 'กำหนด', format: 'date' }, { key: 'type_label', label: 'ประเภท' }, { key: 'subject', label: 'เรื่อง' }, { key: 'related_no', label: 'อ้างอิง' },
        { key: 'related_name', label: 'ลูกค้า/ดีล' }, { key: 'owner_name', label: 'ผู้รับผิดชอบ' }, { key: 'done', label: 'เสร็จ', format: 'boolean' }, { key: 'overdue', label: 'เลยกำหนด', format: 'boolean' },
      ],
      create: 'activityNew', createLabel: 'บันทึกกิจกรรม', empty: 'ยังไม่มีกิจกรรม',
      rowActions: [{ id: 'done', label: 'ทำแล้ว', method: 'POST', endpoint: '/activities/:id/done', perm: 'crm.activity.write', when: { field: 'done', in: [false] } }],
    },
    activityNew: {
      kind: 'form', title: 'บันทึกกิจกรรม / เยี่ยมลูกค้า', method: 'POST', endpoint: '/activities', perm: 'crm.activity.write', mobile: true,
      fields: [
        { name: 'leadId', label: 'ลีด', type: 'lookup', lookup: { path: '/leads', query: { open: '1' }, label: ['no', 'company'], assign: { leadId: 'id' } }, help: 'เลือกลีดหรือโอกาสขายอย่างใดอย่างหนึ่ง' },
        { name: 'opportunityId', label: 'โอกาสขาย', type: 'lookup', lookup: { path: '/opportunities', query: { open: '1' }, label: ['no', 'name', 'customer_name'], assign: { opportunityId: 'id' } } },
        { ...activityFields[0], default: 'visit' }, ...activityFields.slice(1), ownerField,
      ],
      submitLabel: 'บันทึก', after: { screen: 'myActivities' },
    },

    /* ---------- quotations ---------- */
    quotes: {
      kind: 'list', title: 'ใบเสนอราคา', endpoint: '/quotations', perm: 'crm.quote.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาเลขที่หรือลูกค้า', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: quoteStatuses }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'issue_date', label: 'วันที่', format: 'date' },
        { key: 'valid_until', label: 'ยืนราคาถึง', format: 'date' }, { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'gross', label: 'ยอดรวม', format: 'money' },
      ],
      create: 'quoteNew', createLabel: 'สร้างใบเสนอราคา', rowLink: { screen: 'quote' }, empty: 'ยังไม่มีใบเสนอราคา',
      actions: [{ id: 'expireDue', label: 'ปิดใบที่หมดอายุยืนราคา', method: 'POST', endpoint: '/quotations/expire-due', perm: 'crm.quote.write', toast: 'message', confirm: 'เปลี่ยนใบที่ส่งแล้วและเลยวันยืนราคาเป็น "หมดอายุ"' }],
    },
    quoteNew: {
      kind: 'form', title: 'สร้างใบเสนอราคา', method: 'POST', endpoint: '/quotations', perm: 'crm.quote.write',
      fields: quoteFields, lines: quoteLines, submitLabel: 'บันทึกร่าง', after: { screen: 'quote', idFrom: 'id' },
    },
    quote: {
      kind: 'detail', title: 'ใบเสนอราคา', endpoint: '/quotations/:id', perm: 'crm.quote.read', heading: 'no', attachments: { entity: 'quotation', label: 'ไฟล์ลูกค้า / ใบเสนอราคาที่เซ็นแล้ว' }, mobile: true,
      print: { title: 'ใบเสนอราคา', footer: 'payment', signatures: ['ผู้เสนอราคา', 'ผู้อนุมัติ', 'ลูกค้ายืนยันการสั่งซื้อ'] },
      flow: {
        field: 'status',
        steps: [{ value: 'draft', label: 'ร่าง' }, { value: 'sent', label: 'ส่งลูกค้า' }, { value: 'accepted', label: 'ลูกค้าตอบรับ' }],
        exits: [{ value: 'rejected', label: 'ลูกค้าปฏิเสธ' }, { value: 'expired', label: 'หมดอายุ' }],
      },
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'customer_tax_id', label: 'เลขผู้เสียภาษี' },
        { key: 'customer_branch', label: 'สาขา' }, { key: 'customer_address', label: 'ที่อยู่' }, { key: 'contact_name', label: 'เรียน' },
        { key: 'issue_date', label: 'วันที่', format: 'date' }, { key: 'valid_until', label: 'ยืนราคาถึง', format: 'date' },
        { key: 'opportunity_no', label: 'โอกาสขาย', print: false }, { key: 'revision_of_no', label: 'แก้ไขจากใบ' },
        { key: 'subtotal', label: 'รวมก่อนส่วนลด', format: 'money' }, { key: 'discount', label: 'ส่วนลด', format: 'money' },
        { key: 'net', label: 'ก่อน VAT', format: 'money' }, { key: 'vat', label: 'VAT 7%', format: 'money' }, { key: 'gross', label: 'ยอดรวมทั้งสิ้น', format: 'money' },
        { key: 'gross_text', label: 'ตัวอักษร' }, { key: 'note', label: 'เงื่อนไข/หมายเหตุ' }, { key: 'reject_reason', label: 'เหตุผลที่ปฏิเสธ', print: false },
      ],
      lines: [{
        path: 'lines', label: 'รายการ',
        columns: [
          { key: 'line_no', label: '#' }, { key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'สินค้า' }, { key: 'description', label: 'รายละเอียด' },
          { key: 'qty', label: 'จำนวน', format: 'qty' }, { key: 'unit_price', label: 'ราคา/หน่วย', format: 'money' },
          { key: 'discount_pct', label: 'ส่วนลด', format: 'percent' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' },
        ],
      }],
      actions: [
        { id: 'send', label: 'ส่งให้ลูกค้าแล้ว', method: 'POST', endpoint: '/quotations/:id/send', perm: 'crm.quote.write', when: { field: 'status', in: ['draft'] }, tone: 'primary', mobile: true },
        { id: 'accept', label: 'ลูกค้าตอบรับ', method: 'POST', endpoint: '/quotations/:id/accept', perm: 'crm.quote.decide', when: { field: 'status', in: ['sent'] }, tone: 'primary', confirm: 'โอกาสขายที่ผูกไว้จะถูกปิดเป็น "ปิดการขายได้"', mobile: true },
        { id: 'reject', label: 'ลูกค้าปฏิเสธ', method: 'POST', endpoint: '/quotations/:id/reject', perm: 'crm.quote.decide', when: { field: 'status', in: ['sent'] }, tone: 'danger',
          fields: [{ name: 'reason', label: 'เหตุผล', type: 'text', required: true }] },
        { id: 'revise', label: 'แก้ไขเป็นฉบับใหม่', method: 'POST', endpoint: '/quotations/:id/revise', perm: 'crm.quote.write', when: { field: 'status', in: ['sent', 'rejected', 'expired'] }, then: { screen: 'quote', idFrom: 'id' } },
        { id: 'expire', label: 'หมดอายุ', method: 'POST', endpoint: '/quotations/:id/expire', perm: 'crm.quote.write', when: { field: 'status', in: ['draft', 'sent'] }, confirm: 'ปิดใบเสนอราคานี้เป็นหมดอายุ' },
      ],
    },
  },
  widgets: [
    { id: 'crm-kpi', kind: 'kpi', title: 'การขาย', endpoint: '/summary', perm: 'crm.lead.read', size: 'md', href: 'opportunities',
      items: [
        { key: 'pipelineValue', label: 'มูลค่าในท่อ', format: 'money' },
        { key: 'weightedForecast', label: 'คาดการณ์ถ่วงน้ำหนัก', format: 'money' },
        { key: 'wonThisMonth', label: 'ปิดได้เดือนนี้', format: 'money', tone: 'ok' },
        { key: 'openLeads', label: 'ลีดที่ยังเปิด', format: 'qty' },
        { key: 'quotesSent', label: 'ใบเสนอราคารอตอบ', format: 'qty', tone: 'warn' },
        { key: 'winRate', label: 'อัตราปิดการขาย', format: 'percent' },
      ] },
    { id: 'crm-pipeline', kind: 'pipeline', title: 'ท่อการขาย', endpoint: '/summary', perm: 'crm.lead.read', size: 'lg', href: 'opportunities',
      rows: 'rows', field: 'stage', stages: stages.slice(0, 3), title2: 'name', subtitle: 'customer_name', link: { screen: 'opportunity' } },
    { id: 'crm-won', kind: 'trend', title: 'ยอดปิดการขาย 6 เดือน', endpoint: '/summary', perm: 'crm.lead.read', size: 'md', href: 'opportunities', rows: 'months', x: 'month', y: 'total', format: 'money' },
  ],
});
