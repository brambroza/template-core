import { defineUi, type Column, type Field } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const opt = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const statuses = opt([['open', 'รอรับเรื่อง'], ['in_progress', 'กำลังดำเนินการ'], ['waiting', 'รอข้อมูล/รออะไหล่'], ['resolved', 'แก้ไขแล้ว'], ['closed', 'ปิดเรื่อง']]);
const priorities = opt([['low', 'ต่ำ'], ['normal', 'ปกติ'], ['high', 'สูง'], ['urgent', 'ด่วนมาก (SLA ครึ่งเดียว)']]);
const channels = opt([['web', 'เว็บ'], ['phone', 'โทรศัพท์'], ['line', 'LINE'], ['email', 'อีเมล'], ['walk_in', 'มาด้วยตัวเอง']]);

const categoryField: Field = {
  name: 'categoryId', label: 'หมวดหมู่', type: 'lookup',
  lookup: { path: '/categories', label: ['code', 'name'], assign: { categoryId: 'id' } },
};
const userLookup = (id: string, name: string) => ({ module: 'identity', path: '/users', label: ['name', 'email'], assign: { [id]: 'id', [name]: 'name' } });

const ticketFields: Field[] = [
  { name: 'title', label: 'เรื่อง', type: 'text', required: true },
  { name: 'description', label: 'รายละเอียดปัญหา', type: 'textarea' },
  categoryField,
  { name: 'priority', label: 'ความเร่งด่วน', type: 'select', default: 'normal', options: priorities },
  { name: 'channel', label: 'ช่องทาง', type: 'select', default: 'web', options: channels },
  { name: 'requesterName', label: 'ผู้แจ้ง', type: 'text' },
  { name: 'requesterContact', label: 'ติดต่อกลับ (โทร/LINE/อีเมล)', type: 'text' },
];

const ticketColumns: Column[] = [
  { key: 'no', label: 'เลขที่' }, { key: 'title', label: 'เรื่อง' }, { key: 'category_name', label: 'หมวด' },
  { key: 'priority_label', label: 'ความเร่งด่วน' }, { key: 'status', label: 'สถานะ', format: 'status' },
  { key: 'assignee_name', label: 'ผู้รับผิดชอบ' }, { key: 'due_at', label: 'ต้องเสร็จภายใน', format: 'datetime' }, { key: 'overdue', label: 'เกิน SLA', format: 'boolean' },
];

const ACTIVE = ['open', 'in_progress', 'waiting'];

const replyFields: Field[] = [
  { name: 'cannedId', label: 'ข้อความสำเร็จรูป', type: 'lookup', lookup: { path: '/canned-replies', label: ['title'], assign: { cannedId: 'id', body: 'body' } }, help: 'เลือกเพื่อเติมข้อความ แล้วแก้ไขได้' },
  { name: 'body', label: 'ข้อความ', type: 'textarea', required: true },
];

const categoryFields: Field[] = [
  { name: 'code', label: 'รหัส', type: 'text', required: true },
  { name: 'name', label: 'ชื่อหมวด', type: 'text', required: true },
  { name: 'slaResponseHours', label: 'SLA ตอบรับ (ชั่วโมง)', type: 'number', default: 4, step: 0.5, required: true },
  { name: 'slaResolveHours', label: 'SLA แก้ไขเสร็จ (ชั่วโมง)', type: 'number', default: 24, step: 0.5, required: true },
  { name: 'defaultAssigneeId', label: 'ช่างประจำหมวด', type: 'lookup', lookup: userLookup('defaultAssigneeId', 'defaultAssigneeName') },
  { name: 'active', label: 'ใช้งาน', type: 'boolean', default: true },
];

const cannedFields: Field[] = [
  { name: 'title', label: 'ชื่อข้อความ', type: 'text', required: true },
  { name: 'body', label: 'ข้อความ', type: 'textarea', required: true },
  categoryField,
];

const articleFields: Field[] = [
  { name: 'title', label: 'หัวข้อ', type: 'text', required: true },
  { name: 'body', label: 'เนื้อหา / วิธีแก้', type: 'textarea', required: true },
  categoryField,
  { name: 'published', label: 'เผยแพร่ให้ทุกคนอ่าน', type: 'boolean' },
];

export default defineUi({
  module: 'helpdesk',
  label: 'แจ้งปัญหา',
  glyph: 'จ',
  icon: 'life-buoy',
  menu: [
    { label: 'แจ้งปัญหา', screen: 'ticketNew' },
    { label: 'เรื่องที่ฉันแจ้ง', screen: 'myRequests' },
    { label: 'งานของฉัน', screen: 'myTickets' },
    { label: 'เรื่องทั้งหมด', screen: 'tickets' },
    { label: 'เกิน SLA', screen: 'overdueTickets' },
    { label: 'ฐานความรู้', screen: 'articles' },
    { label: 'ข้อความสำเร็จรูป', screen: 'cannedReplies' },
    { label: 'หมวดหมู่และ SLA', screen: 'categories' },
  ],
  commands: [
    { id: 'report', label: 'แจ้งปัญหา', example: 'แจ้งปัญหา ปริ้นเตอร์ชั้น 2 กระดาษติด', keywords: ['แจ้งปัญหา', 'แจ้งเรื่อง', 'ticket'], screen: 'ticketNew', perm: 'helpdesk.ticket.create', restField: 'title' },
    { id: 'mine', label: 'งานค้างของฉัน', example: 'งานค้างของฉัน', keywords: ['งานค้างของฉัน', 'งานของฉัน', 'my tickets'], screen: 'myTickets', perm: 'helpdesk.ticket.work' },
    { id: 'kb', label: 'ค้นวิธีแก้ในฐานความรู้', example: 'วิธีแก้ VPN', keywords: ['วิธีแก้', 'ฐานความรู้', 'kb'], screen: 'articles', perm: 'helpdesk.kb.read', restField: 'q' },
    { id: 'overdue', label: 'เรื่องที่เกิน SLA', example: 'เกิน SLA', keywords: ['เกิน sla', 'เลยกำหนด'], screen: 'overdueTickets', perm: 'helpdesk.ticket.read' },
  ],
  search: [
    { id: 'tickets', title: 'เรื่องแจ้งปัญหา', endpoint: '/tickets', label: ['no', 'title', 'requester_name'], screen: 'ticket', perm: 'helpdesk.ticket.read' },
    { id: 'articles', title: 'ฐานความรู้', endpoint: '/articles', label: ['title', 'excerpt'], screen: 'article', perm: 'helpdesk.kb.read' },
  ],
  screens: {
    /* ---------- tickets ---------- */
    ticketNew: {
      kind: 'form', title: 'แจ้งปัญหา', method: 'POST', endpoint: '/tickets', perm: 'helpdesk.ticket.create', mobile: true,
      fields: ticketFields, submitLabel: 'ส่งเรื่อง', after: { screen: 'ticket', idFrom: 'id' },
    },
    myRequests: {
      kind: 'list', title: 'เรื่องที่ฉันแจ้ง', endpoint: '/tickets/requested', perm: 'helpdesk.ticket.create', mobile: true,
      columns: [{ key: 'no', label: 'เลขที่' }, { key: 'title', label: 'เรื่อง' }, { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'assignee_name', label: 'ผู้รับเรื่อง' }, { key: 'created_at', label: 'แจ้งเมื่อ', format: 'datetime' }],
      create: 'ticketNew', createLabel: 'แจ้งปัญหา', rowLink: { screen: 'ticket' }, empty: 'ยังไม่เคยแจ้งปัญหา',
    },
    myTickets: {
      kind: 'list', title: 'งานค้างของฉัน', endpoint: '/tickets/mine', perm: 'helpdesk.ticket.work', mobile: true,
      columns: ticketColumns, rowLink: { screen: 'ticket' }, empty: 'ไม่มีงานค้าง',
      rowActions: [{ id: 'start', label: 'เริ่มทำ', method: 'POST', endpoint: '/tickets/:id/start', perm: 'helpdesk.ticket.work', when: { field: 'status', in: ['open', 'waiting'] }, tone: 'primary', mobile: true }],
    },
    tickets: {
      kind: 'list', title: 'เรื่องแจ้งปัญหาทั้งหมด', endpoint: '/tickets', perm: 'helpdesk.ticket.read', mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่ เรื่อง ผู้แจ้ง', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: statuses },
        { name: 'priority', label: 'ความเร่งด่วน', type: 'select', options: priorities },
        { name: 'channel', label: 'ช่องทาง', type: 'select', options: channels },
        { ...categoryField, label: 'หมวดหมู่' },
        { name: 'unassigned', label: 'ยังไม่มีผู้รับผิดชอบ', type: 'boolean' },
        { name: 'overdue', label: 'เกิน SLA', type: 'boolean' },
      ],
      columns: [...ticketColumns.slice(0, 2), { key: 'requester_name', label: 'ผู้แจ้ง' }, { key: 'channel_label', label: 'ช่องทาง' }, ...ticketColumns.slice(2)],
      create: 'ticketNew', createLabel: 'แจ้งปัญหา', rowLink: { screen: 'ticket' }, empty: 'ยังไม่มีเรื่องแจ้งปัญหา',
      rowActions: [{ id: 'start', label: 'รับเรื่อง', method: 'POST', endpoint: '/tickets/:id/start', perm: 'helpdesk.ticket.work', when: { field: 'status', in: ['open'] } }],
    },
    overdueTickets: {
      kind: 'list', title: 'เรื่องที่เกิน SLA', endpoint: '/tickets/overdue', perm: 'helpdesk.ticket.read', mobile: true,
      columns: ticketColumns, rowLink: { screen: 'ticket' }, empty: 'ไม่มีเรื่องเกิน SLA',
    },
    ticketEdit: {
      kind: 'form', title: 'แก้ไขเรื่อง', method: 'PUT', endpoint: '/tickets/:id', load: '/tickets/:id', perm: 'helpdesk.ticket.work',
      fields: ticketFields, submitLabel: 'บันทึก (คำนวณ SLA ใหม่)', after: { screen: 'ticket', idFrom: 'id' },
    },
    ticket: {
      kind: 'detail', title: 'เรื่องแจ้งปัญหา', endpoint: '/tickets/:id', perm: 'helpdesk.ticket.create', heading: 'no', mobile: true, edit: 'ticketEdit', printable: true,
      flow: {
        field: 'status',
        steps: [{ value: 'open', label: 'รับเรื่อง' }, { value: 'in_progress', label: 'กำลังทำ' }, { value: 'waiting', label: 'รอข้อมูล' }, { value: 'resolved', label: 'แก้ไขแล้ว' }, { value: 'closed', label: 'ปิดเรื่อง' }],
      },
      fields: [
        { key: 'title', label: 'เรื่อง' }, { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'priority_label', label: 'ความเร่งด่วน' },
        { key: 'category_name', label: 'หมวดหมู่' }, { key: 'channel_label', label: 'ช่องทาง' }, { key: 'description', label: 'รายละเอียด' },
        { key: 'requester_name', label: 'ผู้แจ้ง' }, { key: 'requester_contact', label: 'ติดต่อกลับ' }, { key: 'assignee_name', label: 'ผู้รับผิดชอบ' },
        { key: 'created_at', label: 'แจ้งเมื่อ', format: 'datetime' }, { key: 'response_due_at', label: 'ต้องตอบรับภายใน', format: 'datetime' },
        { key: 'first_response_at', label: 'ตอบรับเมื่อ', format: 'datetime' }, { key: 'due_at', label: 'ต้องแก้ไขเสร็จภายใน', format: 'datetime' },
        { key: 'overdue', label: 'เกิน SLA', format: 'boolean' }, { key: 'resolution', label: 'วิธีแก้ไข' }, { key: 'resolved_at', label: 'แก้ไขเสร็จเมื่อ', format: 'datetime' },
        { key: 'reopen_count', label: 'เปิดเรื่องซ้ำ (ครั้ง)', format: 'qty' }, { key: 'satisfaction', label: 'ความพึงพอใจ (1–5)', format: 'qty' }, { key: 'feedback', label: 'ความเห็นผู้แจ้ง' },
      ],
      lines: [{ path: 'comments', label: 'การสนทนา', columns: [{ key: 'created_at', label: 'เวลา', format: 'datetime' }, { key: 'kind_label', label: 'ประเภท' }, { key: 'author_name', label: 'โดย' }, { key: 'body', label: 'ข้อความ' }] }],
      actions: [
        { id: 'start', label: 'รับเรื่อง/เริ่มทำ', method: 'POST', endpoint: '/tickets/:id/start', perm: 'helpdesk.ticket.work', when: { field: 'status', in: ['open', 'waiting'] }, tone: 'primary', mobile: true },
        { id: 'reply', label: 'ตอบกลับผู้แจ้ง', method: 'POST', endpoint: '/tickets/:id/comments', perm: 'helpdesk.ticket.work', when: { field: 'status', in: [...ACTIVE, 'resolved'] }, fields: replyFields, mobile: true },
        { id: 'note', label: 'บันทึกภายใน', method: 'POST', endpoint: '/tickets/:id/comments', perm: 'helpdesk.ticket.work', when: { field: 'status', in: [...ACTIVE, 'resolved'] }, mobile: true,
          fields: [{ name: 'body', label: 'บันทึก (ผู้แจ้งไม่เห็น)', type: 'textarea', required: true }, { name: 'internal', label: 'ภายใน', type: 'boolean', default: true }] },
        { id: 'comment', label: 'เพิ่มข้อมูล', method: 'POST', endpoint: '/tickets/:id/comments', perm: 'helpdesk.ticket.create', when: { field: 'status', in: ACTIVE }, mobile: true,
          fields: [{ name: 'body', label: 'ข้อความถึงผู้รับเรื่อง', type: 'textarea', required: true }] },
        { id: 'assign', label: 'มอบหมาย', method: 'POST', endpoint: '/tickets/:id/assign', perm: 'helpdesk.ticket.work', when: { field: 'status', in: ACTIVE },
          fields: [{ name: 'assigneeId', label: 'ผู้รับผิดชอบ', type: 'lookup', required: true, lookup: userLookup('assigneeId', 'assigneeName') }] },
        { id: 'wait', label: 'รอข้อมูล/รออะไหล่', method: 'POST', endpoint: '/tickets/:id/wait', perm: 'helpdesk.ticket.work', when: { field: 'status', in: ['in_progress'] }, mobile: true,
          fields: [{ name: 'reason', label: 'รออะไร', type: 'text' }] },
        { id: 'resolve', label: 'แก้ไขเสร็จ', method: 'POST', endpoint: '/tickets/:id/resolve', perm: 'helpdesk.ticket.work', when: { field: 'status', in: ACTIVE }, tone: 'primary', mobile: true,
          fields: [{ name: 'resolution', label: 'วิธีแก้ไข', type: 'textarea', required: true }] },
        { id: 'close', label: 'ยืนยันปิดเรื่อง', method: 'POST', endpoint: '/tickets/:id/close', perm: 'helpdesk.ticket.create', when: { field: 'status', in: ['resolved'] }, tone: 'primary', mobile: true,
          fields: [
            { name: 'satisfaction', label: 'ความพึงพอใจ', type: 'select', options: opt([['5', '5 — ดีมาก'], ['4', '4 — ดี'], ['3', '3 — พอใช้'], ['2', '2 — ควรปรับปรุง'], ['1', '1 — ไม่พอใจ']]) },
            { name: 'feedback', label: 'ความเห็นเพิ่มเติม', type: 'textarea' },
          ] },
        { id: 'reopen', label: 'ยังไม่หาย เปิดเรื่องใหม่', method: 'POST', endpoint: '/tickets/:id/reopen', perm: 'helpdesk.ticket.create', when: { field: 'status', in: ['resolved'] }, tone: 'danger', mobile: true,
          fields: [{ name: 'reason', label: 'อาการที่ยังพบ', type: 'text' }] },
      ],
    },

    /* ---------- knowledge base ---------- */
    articles: {
      kind: 'list', display: 'cards', title: 'ฐานความรู้ — วิธีแก้ปัญหาที่พบบ่อย', endpoint: '/articles', perm: 'helpdesk.kb.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาวิธีแก้', type: 'text' }, { ...categoryField, label: 'หมวดหมู่' }],
      columns: [{ key: 'title', label: 'หัวข้อ' }, { key: 'excerpt', label: 'เนื้อหา' }, { key: 'category_name', label: 'หมวด' }, { key: 'views', label: 'อ่าน', format: 'qty' }, { key: 'published', label: 'เผยแพร่', format: 'boolean' }],
      create: 'articleNew', createLabel: 'เขียนบทความ', rowLink: { screen: 'article' }, empty: 'ยังไม่มีบทความ',
    },
    articleNew: {
      kind: 'form', title: 'เขียนบทความ', method: 'POST', endpoint: '/articles', perm: 'helpdesk.kb.write',
      fields: articleFields, submitLabel: 'บันทึกบทความ', after: { screen: 'article', idFrom: 'id' },
    },
    articleEdit: {
      kind: 'form', title: 'แก้ไขบทความ', method: 'PUT', endpoint: '/articles/:id', load: '/articles/:id', perm: 'helpdesk.kb.write',
      fields: articleFields, submitLabel: 'บันทึกการแก้ไข', after: { screen: 'article', idFrom: 'id' },
    },
    article: {
      kind: 'detail', title: 'บทความ', endpoint: '/articles/:id', perm: 'helpdesk.kb.read', heading: 'title', mobile: true, edit: 'articleEdit', printable: true,
      fields: [
        { key: 'category_name', label: 'หมวดหมู่' }, { key: 'body', label: 'เนื้อหา' }, { key: 'published', label: 'เผยแพร่', format: 'boolean' },
        { key: 'views', label: 'จำนวนครั้งที่อ่าน', format: 'qty' }, { key: 'updated_at', label: 'ปรับปรุงล่าสุด', format: 'datetime' },
      ],
      actions: [
        { id: 'publish', label: 'เผยแพร่', method: 'POST', endpoint: '/articles/:id/publish', perm: 'helpdesk.kb.write', when: { field: 'published', in: [false] }, tone: 'primary' },
        { id: 'unpublish', label: 'ซ่อนบทความ', method: 'POST', endpoint: '/articles/:id/unpublish', perm: 'helpdesk.kb.write', when: { field: 'published', in: [true] } },
      ],
    },

    /* ---------- setup ---------- */
    cannedReplies: {
      kind: 'list', title: 'ข้อความตอบกลับสำเร็จรูป', endpoint: '/canned-replies', perm: 'helpdesk.ticket.work',
      filters: [{ name: 'q', label: 'ค้นหา', type: 'text' }],
      columns: [{ key: 'title', label: 'ชื่อ' }, { key: 'body', label: 'ข้อความ' }, { key: 'category_name', label: 'หมวด' }],
      create: 'cannedNew', createLabel: 'เพิ่มข้อความ', rowLink: { screen: 'cannedEdit' }, empty: 'ยังไม่มีข้อความสำเร็จรูป',
      rowActions: [{ id: 'delete', label: 'ลบ', method: 'DELETE', endpoint: '/canned-replies/:id', perm: 'helpdesk.setup.write', tone: 'danger', confirm: 'ลบข้อความนี้', toast: 'message' }],
    },
    cannedNew: {
      kind: 'form', title: 'เพิ่มข้อความสำเร็จรูป', method: 'POST', endpoint: '/canned-replies', perm: 'helpdesk.setup.write',
      fields: cannedFields, submitLabel: 'บันทึก', after: { screen: 'cannedReplies' },
    },
    cannedEdit: {
      kind: 'form', title: 'แก้ไขข้อความสำเร็จรูป', method: 'PUT', endpoint: '/canned-replies/:id', load: '/canned-replies/:id', perm: 'helpdesk.setup.write',
      fields: cannedFields, submitLabel: 'บันทึกการแก้ไข', after: { screen: 'cannedReplies' },
    },
    categories: {
      kind: 'list', title: 'หมวดหมู่และ SLA', endpoint: '/categories', perm: 'helpdesk.ticket.read',
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }, { key: 'sla_response_hours', label: 'ตอบรับ (ชม.)', format: 'qty' },
        { key: 'sla_resolve_hours', label: 'แก้เสร็จ (ชม.)', format: 'qty' }, { key: 'default_assignee_name', label: 'ช่างประจำ' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      create: 'categoryNew', createLabel: 'เพิ่มหมวดหมู่', rowLink: { screen: 'categoryEdit' }, empty: 'ยังไม่มีหมวดหมู่ (ใช้ SLA มาตรฐาน 4/24 ชม.)',
    },
    categoryNew: {
      kind: 'form', title: 'เพิ่มหมวดหมู่', method: 'POST', endpoint: '/categories', perm: 'helpdesk.setup.write',
      fields: categoryFields, submitLabel: 'บันทึก', after: { screen: 'categories' },
    },
    categoryEdit: {
      kind: 'form', title: 'แก้ไขหมวดหมู่', method: 'PUT', endpoint: '/categories/:id', load: '/categories/:id', perm: 'helpdesk.setup.write',
      fields: categoryFields, submitLabel: 'บันทึกการแก้ไข', after: { screen: 'categories' },
    },
  },
  widgets: [
    { id: 'hd-kpi', kind: 'kpi', title: 'งานบริการ', endpoint: '/summary', perm: 'helpdesk.ticket.read', size: 'md', href: 'tickets',
      items: [
        { key: 'open', label: 'เรื่องค้าง', format: 'qty' },
        { key: 'overdue', label: 'เกิน SLA', format: 'qty', tone: 'stop' },
        { key: 'unassigned', label: 'ยังไม่มีคนรับ', format: 'qty', tone: 'warn' },
        { key: 'resolvedToday', label: 'แก้เสร็จวันนี้', format: 'qty', tone: 'ok' },
        { key: 'avgResolutionHours', label: 'เวลาแก้เฉลี่ย (ชม.)', format: 'qty' },
        { key: 'satisfactionAvg', label: 'ความพึงพอใจ (เต็ม 5)', format: 'qty' },
      ] },
    { id: 'hd-pipeline', kind: 'pipeline', title: 'สถานะเรื่องแจ้งปัญหา', endpoint: '/summary', perm: 'helpdesk.ticket.read', size: 'wide', href: 'tickets',
      rows: 'rows', field: 'status', stages: statuses.slice(0, 4), title2: 'title', subtitle: 'no', link: { screen: 'ticket' } },
    { id: 'hd-trend', kind: 'trend', title: 'เรื่องแจ้งเข้า 6 เดือน', endpoint: '/summary', perm: 'helpdesk.ticket.read', size: 'sm', href: 'tickets', rows: 'months', x: 'month', y: 'opened', format: 'qty' },
  ],
});
