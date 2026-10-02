import { defineUi, type Field, type LinesSpec } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const statuses = [
  { value: 'draft', label: 'ร่าง' }, { value: 'pending', label: 'รออนุมัติ' }, { value: 'returned', label: 'ส่งกลับแก้ไข' },
  { value: 'approved', label: 'อนุมัติแล้ว' }, { value: 'rejected', label: 'ไม่อนุมัติ' }, { value: 'cancelled', label: 'ยกเลิก' },
];

const approverLines: LinesSpec = {
  name: 'approvers', label: 'ผู้อนุมัติ (เรียงตามลำดับขั้น)',
  fields: [{
    name: 'userId', label: 'ผู้อนุมัติ', type: 'lookup', required: true,
    lookup: { module: 'identity', path: '/users', label: ['name', 'email'], assign: { userId: 'id', userName: 'name' } },
  }],
};

const typeLookup: Field = {
  name: 'typeId', label: 'ประเภทคำขอ', type: 'lookup', required: true,
  lookup: { path: '/types', query: { active: 'true' }, label: ['code', 'name'], assign: { typeId: 'id' } },
};

const requestColumns = [
  { key: 'no', label: 'เลขที่' },
  { key: 'title', label: 'เรื่อง' },
  { key: 'type_name', label: 'ประเภท' },
  { key: 'requester_name', label: 'ผู้ขอ' },
  { key: 'amount', label: 'จำนวนเงิน', format: 'money' as const },
  { key: 'status', label: 'สถานะ', format: 'status' as const },
  { key: 'current_approver_name', label: 'รอใครอนุมัติ' },
  { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' as const },
];

const noteField = (required: boolean, label = 'หมายเหตุ'): Field => ({ name: 'note', label, type: 'textarea', required });

export default defineUi({
  module: 'approvals',
  label: 'อนุมัติออนไลน์',
  glyph: 'อ',
  icon: 'stamp',
  menu: [
    { label: 'รออนุมัติ (ของฉัน)', screen: 'inbox' },
    { label: 'คำขอของฉัน', screen: 'myRequests' },
    { label: 'สร้างคำขออนุมัติ', screen: 'requestNew' },
    { label: 'คำขอทั้งหมด', screen: 'requests' },
    { label: 'ประเภทคำขอและสายอนุมัติ', screen: 'types' },
  ],
  commands: [
    { id: 'ask', label: 'สร้างคำขออนุมัติ', example: 'ขออนุมัติ ซื้อเครื่องพิมพ์ใหม่', keywords: ['ขออนุมัติ', 'บันทึกข้อความ', 'memo'], screen: 'requestNew', perm: 'approvals.request.write', restField: 'title' },
    { id: 'inbox', label: 'คำขอที่รอฉันอนุมัติ', example: 'รออนุมัติ', keywords: ['รออนุมัติ', 'รอฉันอนุมัติ', 'inbox'], screen: 'inbox', perm: 'approvals.request.read' },
    { id: 'mine', label: 'คำขอของฉัน', example: 'คำขอของฉัน', keywords: ['คำขอของฉัน', 'ติดตามคำขอ'], screen: 'myRequests', perm: 'approvals.request.read' },
  ],
  search: [
    { id: 'requests', title: 'ใบขออนุมัติ', endpoint: '/requests', label: ['no', 'title'], screen: 'requestDetail', perm: 'approvals.request.read' },
  ],
  screens: {
    inbox: {
      kind: 'list', title: 'คำขอที่รอฉันอนุมัติ', endpoint: '/inbox', perm: 'approvals.request.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาเลขที่ เรื่อง หรือผู้ขอ', type: 'text' }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'title', label: 'เรื่อง' }, { key: 'requester_name', label: 'ผู้ขอ' },
        { key: 'amount', label: 'จำนวนเงิน', format: 'money' }, { key: 'needed_by', label: 'ต้องการภายใน', format: 'date' },
        { key: 'submitted_at', label: 'ส่งเมื่อ', format: 'datetime' },
      ],
      rowLink: { screen: 'requestDetail' },
      rowActions: [
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/requests/:id/approve', perm: 'approvals.request.approve', when: { field: 'can_act', in: [true] }, tone: 'primary', confirm: 'อนุมัติคำขอนี้?', mobile: true },
      ],
      empty: 'ไม่มีคำขอที่รอคุณอนุมัติ',
    },
    myRequests: {
      kind: 'list', title: 'คำขอของฉัน', endpoint: '/my-requests', perm: 'approvals.request.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาเลขที่หรือเรื่อง', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: statuses }],
      columns: requestColumns,
      create: 'requestNew', createLabel: 'สร้างคำขอ', rowLink: { screen: 'requestDetail' }, empty: 'คุณยังไม่มีคำขออนุมัติ',
    },
    requests: {
      kind: 'list', title: 'คำขออนุมัติทั้งหมด', endpoint: '/requests', perm: 'approvals.request.read',
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่ เรื่อง ผู้ขอ', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: statuses },
        { name: 'typeId', label: 'ประเภท', type: 'lookup', lookup: { path: '/types', label: ['code', 'name'], assign: { typeId: 'id' } } },
      ],
      columns: requestColumns,
      create: 'requestNew', createLabel: 'สร้างคำขอ', rowLink: { screen: 'requestDetail' }, empty: 'ยังไม่มีคำขออนุมัติ',
    },
    requestNew: {
      kind: 'form', title: 'สร้างคำขออนุมัติ', method: 'POST', endpoint: '/requests', perm: 'approvals.request.write', mobile: true,
      fields: [
        typeLookup,
        { name: 'title', label: 'เรื่อง', type: 'text', required: true },
        { name: 'detail', label: 'รายละเอียด / เหตุผล', type: 'textarea' },
        { name: 'amount', label: 'จำนวนเงิน (ถ้ามี)', type: 'number', step: 0.01 },
        { name: 'neededBy', label: 'ต้องการภายในวันที่', type: 'date' },
        { name: 'requesterName', label: 'ชื่อผู้ขอ', type: 'text' },
        { name: 'department', label: 'แผนก', type: 'text' },
        { name: 'submit', label: 'ส่งขออนุมัติทันที', type: 'boolean', default: true },
      ],
      lines: { ...approverLines, label: 'ผู้อนุมัติ (เว้นว่าง = ใช้สายอนุมัติตามประเภท)' },
      submitLabel: 'บันทึกคำขอ', after: { screen: 'requestDetail', idFrom: 'id' },
    },
    requestEdit: {
      kind: 'form', title: 'แก้ไขคำขออนุมัติ', method: 'PUT', endpoint: '/requests/:id', load: '/requests/:id', perm: 'approvals.request.write', mobile: true,
      fields: [
        { name: 'title', label: 'เรื่อง', type: 'text', required: true },
        { name: 'detail', label: 'รายละเอียด / เหตุผล', type: 'textarea' },
        { name: 'amount', label: 'จำนวนเงิน (ถ้ามี)', type: 'number', step: 0.01 },
        { name: 'neededBy', label: 'ต้องการภายในวันที่', type: 'date' },
        { name: 'requesterName', label: 'ชื่อผู้ขอ', type: 'text' },
        { name: 'department', label: 'แผนก', type: 'text' },
      ],
      submitLabel: 'บันทึกการแก้ไข', after: { screen: 'requestDetail', idFrom: 'id' },
    },
    requestDetail: {
      kind: 'detail', title: 'ใบขออนุมัติ', endpoint: '/requests/:id', perm: 'approvals.request.read', heading: 'no', mobile: true, printable: true,
      edit: 'requestEdit',
      flow: {
        field: 'status',
        steps: [{ value: 'draft', label: 'ร่าง' }, { value: 'pending', label: 'รออนุมัติ' }, { value: 'approved', label: 'อนุมัติแล้ว' }],
        exits: [{ value: 'returned', label: 'ส่งกลับแก้ไข' }, { value: 'rejected', label: 'ไม่อนุมัติ' }, { value: 'cancelled', label: 'ยกเลิก' }],
      },
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'title', label: 'เรื่อง' },
        { key: 'type_name', label: 'ประเภท' },
        { key: 'detail', label: 'รายละเอียด' },
        { key: 'amount', label: 'จำนวนเงิน', format: 'money' },
        { key: 'needed_by', label: 'ต้องการภายใน', format: 'date' },
        { key: 'requester_name', label: 'ผู้ขอ' },
        { key: 'department', label: 'แผนก' },
        { key: 'step_text', label: 'ขั้นอนุมัติ' },
        { key: 'current_approver_name', label: 'รอใครอนุมัติ' },
        { key: 'last_note', label: 'เหตุผลล่าสุด' },
        { key: 'submitted_at', label: 'ส่งเมื่อ', format: 'datetime' },
        { key: 'decided_at', label: 'ตัดสินเมื่อ', format: 'datetime' },
      ],
      lines: [
        { path: 'steps', label: 'สายอนุมัติ', columns: [
          { key: 'step_no', label: 'ขั้น' }, { key: 'approver_name', label: 'ผู้อนุมัติ' }, { key: 'status_label', label: 'ผล' },
          { key: 'acted_at', label: 'เมื่อ', format: 'datetime' }, { key: 'note', label: 'หมายเหตุ' },
        ] },
        { path: 'history', label: 'ประวัติการดำเนินการ', columns: [
          { key: 'at', label: 'เวลา', format: 'datetime' }, { key: 'actor_name', label: 'โดย' }, { key: 'action_label', label: 'การดำเนินการ' },
          { key: 'step_no', label: 'ขั้น' }, { key: 'note', label: 'หมายเหตุ' },
        ] },
      ],
      actions: [
        { id: 'submit', label: 'ส่งขออนุมัติ', method: 'POST', endpoint: '/requests/:id/submit', perm: 'approvals.request.write', when: { field: 'can_submit', in: [true] }, tone: 'primary', mobile: true },
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/requests/:id/approve', perm: 'approvals.request.approve', when: { field: 'can_act', in: [true] }, tone: 'primary', fields: [noteField(false, 'ความเห็น (ไม่บังคับ)')], mobile: true },
        { id: 'return', label: 'ส่งกลับแก้ไข', method: 'POST', endpoint: '/requests/:id/return', perm: 'approvals.request.approve', when: { field: 'can_act', in: [true] }, fields: [noteField(true, 'ต้องแก้ไขอะไร')], mobile: true },
        { id: 'reject', label: 'ไม่อนุมัติ', method: 'POST', endpoint: '/requests/:id/reject', perm: 'approvals.request.approve', when: { field: 'can_act', in: [true] }, tone: 'danger', fields: [noteField(true, 'เหตุผลที่ไม่อนุมัติ')], mobile: true },
        { id: 'approvers', label: 'เปลี่ยนผู้อนุมัติ', method: 'PUT', endpoint: '/requests/:id/approvers', perm: 'approvals.request.write', when: { field: 'can_edit', in: [true] }, lines: { ...approverLines, min: 1 } },
        { id: 'comment', label: 'แสดงความเห็น', method: 'POST', endpoint: '/requests/:id/comment', perm: 'approvals.request.read', fields: [noteField(true, 'ความเห็น')], mobile: true },
        { id: 'cancel', label: 'ยกเลิกคำขอ', method: 'POST', endpoint: '/requests/:id/cancel', perm: 'approvals.request.write', when: { field: 'can_cancel', in: [true] }, tone: 'danger', confirm: 'ยกเลิกคำขอนี้? ยกเลิกแล้วส่งต่อไม่ได้', fields: [noteField(false, 'เหตุผล (ไม่บังคับ)')] },
      ],
    },
    types: {
      kind: 'list', title: 'ประเภทคำขอและสายอนุมัติ', endpoint: '/types', perm: 'approvals.request.read',
      filters: [{ name: 'q', label: 'ค้นหารหัสหรือชื่อ', type: 'text' }, { name: 'active', label: 'สถานะ', type: 'select', options: [{ value: 'true', label: 'ใช้งาน' }, { value: 'false', label: 'ปิดใช้งาน' }] }],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }, { key: 'chain', label: 'สายอนุมัติ' },
        { key: 'step_count', label: 'จำนวนขั้น', format: 'qty' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      create: 'typeNew', createLabel: 'เพิ่มประเภท', rowLink: { screen: 'typeDetail' }, empty: 'ยังไม่มีประเภทคำขอ — เช่น ขอซื้อ, ขอเดินทาง, ขอใช้งบ, บันทึกข้อความ',
    },
    typeNew: {
      kind: 'form', title: 'เพิ่มประเภทคำขอ', method: 'POST', endpoint: '/types', perm: 'approvals.type.write',
      fields: [
        { name: 'code', label: 'รหัส', type: 'text', required: true, help: 'เช่น PR, TRAVEL, BUDGET, MEMO' },
        { name: 'name', label: 'ชื่อ', type: 'text', required: true, help: 'เช่น ขอซื้อ, ขอเดินทาง, ขอใช้งบ, บันทึกข้อความ' },
        { name: 'description', label: 'คำอธิบาย', type: 'textarea' },
        { name: 'amountNote', label: 'เงื่อนไขวงเงิน (ข้อความแนะนำ)', type: 'text', help: 'เช่น เกิน 50,000 บาท ให้ MD อนุมัติขั้นสุดท้าย' },
        { name: 'active', label: 'ใช้งาน', type: 'boolean', default: true },
      ],
      lines: approverLines,
      submitLabel: 'บันทึก', after: { screen: 'typeDetail', idFrom: 'id' },
    },
    typeEdit: {
      kind: 'form', title: 'แก้ไขประเภทคำขอ', method: 'PUT', endpoint: '/types/:id', load: '/types/:id', perm: 'approvals.type.write',
      fields: [
        { name: 'name', label: 'ชื่อ', type: 'text', required: true },
        { name: 'description', label: 'คำอธิบาย', type: 'textarea' },
        { name: 'amountNote', label: 'เงื่อนไขวงเงิน (ข้อความแนะนำ)', type: 'text' },
        { name: 'active', label: 'ใช้งาน', type: 'boolean' },
      ],
      submitLabel: 'บันทึก', after: { screen: 'typeDetail', idFrom: 'id' },
    },
    typeDetail: {
      kind: 'detail', title: 'ประเภทคำขอ', endpoint: '/types/:id', perm: 'approvals.request.read', heading: 'name', edit: 'typeEdit',
      fields: [
        { key: 'code', label: 'รหัส' }, { key: 'description', label: 'คำอธิบาย' }, { key: 'amount_note', label: 'เงื่อนไขวงเงิน' },
        { key: 'step_count', label: 'จำนวนขั้นอนุมัติ', format: 'qty' }, { key: 'request_count', label: 'จำนวนคำขอที่ใช้ประเภทนี้', format: 'qty' },
        { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      lines: [{ path: 'approvers', label: 'สายอนุมัติเริ่มต้น (ตามลำดับ)', columns: [{ key: 'userName', label: 'ผู้อนุมัติ' }] }],
      actions: [
        { id: 'approvers', label: 'ตั้งสายอนุมัติใหม่', method: 'PUT', endpoint: '/types/:id/approvers', perm: 'approvals.type.write', lines: { ...approverLines, min: 1 }, tone: 'primary' },
        { id: 'delete', label: 'ลบประเภท', method: 'DELETE', endpoint: '/types/:id', perm: 'approvals.type.write', tone: 'danger', confirm: 'ลบประเภทนี้? (ถ้ามีคำขอใช้อยู่แล้ว ให้ปิดใช้งานแทน)', then: { screen: 'types' } },
      ],
    },
  },
  widgets: [
    { id: 'approvals-kpi', kind: 'kpi', title: 'อนุมัติออนไลน์', endpoint: '/summary', perm: 'approvals.request.read', size: 'md', href: 'inbox',
      items: [
        { key: 'waitingForMe', label: 'รอฉันอนุมัติ', format: 'qty', tone: 'warn' },
        { key: 'pendingTotal', label: 'อยู่ระหว่างอนุมัติ', format: 'qty' },
        { key: 'approvedThisMonth', label: 'อนุมัติเดือนนี้', format: 'qty', tone: 'ok' },
        { key: 'avgHoursToDecide', label: 'เวลาตัดสินเฉลี่ย (ชม.)', format: 'qty' },
      ] },
    { id: 'approvals-pipeline', kind: 'pipeline', title: 'คำขออนุมัติล่าสุด', endpoint: '/summary', perm: 'approvals.request.read', size: 'wide', href: 'requests',
      rows: 'rows', field: 'status', title2: 'title', subtitle: 'requester_name', link: { screen: 'requestDetail' },
      stages: [{ value: 'pending', label: 'รออนุมัติ' }, { value: 'returned', label: 'ส่งกลับแก้ไข' }, { value: 'approved', label: 'อนุมัติแล้ว' }, { value: 'rejected', label: 'ไม่อนุมัติ' }] },
    { id: 'approvals-trend', kind: 'trend', title: 'คำขอที่ส่ง 6 เดือน', endpoint: '/summary', perm: 'approvals.request.read', size: 'md', href: 'requests', rows: 'months', x: 'month', y: 'submitted', format: 'qty' },
  ],
});
