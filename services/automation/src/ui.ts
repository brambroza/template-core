import { defineUi, type Field } from '@erp/ui-schema';
import { EVENTS } from './catalog.ts';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */
const eventSelect: Field = {
  name: 'eventType', label: 'เมื่อ…', type: 'select', required: true,
  options: EVENTS.map((e) => ({ value: e.type, label: e.label })),
};

/** Who an in-app alert goes to: everyone, or a person named in the event (only fields the chosen event carries are accepted). */
const RECIPIENTS = [
  { value: 'all', label: 'ทุกคนที่รับการแจ้งเตือน' },
  ...[...new Map(EVENTS.flatMap((e) => (e.userFields ?? []).map((f) => [f.key, f.label] as const))).entries()]
    .map(([key, label]) => ({ value: `field:${key}`, label: `${label} (${key})` })),
];

export default defineUi({
  module: 'automation',
  label: 'ระบบอัตโนมัติ',
  glyph: 'อ',
  icon: 'zap',
  menu: [
    { label: 'สูตรสำเร็จรูป', screen: 'templates' },
    { label: 'กฎของฉัน', screen: 'rules' },
    { label: 'การแจ้งเตือน', screen: 'notifications' },
    { label: 'ประวัติการทำงาน', screen: 'runs' },
    { label: 'ผูก LINE ของฉัน', screen: 'lineMe' },
    { label: 'ตั้งค่า LINE OA', screen: 'lineSetup' },
    { label: 'ผู้ใช้ที่ผูก LINE', screen: 'lineLinks' },
  ],
  notifications: {
    endpoint: '/notifications', readEndpoint: '/notifications/:id/read', readAllEndpoint: '/notifications/read-all', perm: 'automation.notify.read',
  },
  widgets: [
    {
      id: 'feed', kind: 'feed', title: 'บอทแจ้งเตือนล่าสุด', endpoint: '/notifications', perm: 'automation.notify.read', href: 'notifications', size: 'sm',
      rows: 'items', title2: 'title', body: 'body', time: 'created_at', level: 'level', link: 'link',
    },
    {
      id: 'automation', kind: 'kpi', title: 'บอทอัตโนมัติ', endpoint: '/summary', perm: 'automation.rule.read', href: 'rules', size: 'md',
      items: [
        { key: 'activeRules', label: 'กฎที่เปิดอยู่', tone: 'ok' },
        { key: 'firedToday', label: 'ทำงานวันนี้' },
        { key: 'failedToday', label: 'ส่งไม่สำเร็จ', tone: 'stop' },
        { key: 'unread', label: 'แจ้งเตือนยังไม่อ่าน', tone: 'warn' },
      ],
    },
  ],
  commands: [
    { id: 'rule', label: 'สร้างกฎอัตโนมัติ', example: 'ตั้งเตือน', keywords: ['ตั้งเตือน', 'สร้างกฎ', 'บอท', 'อัตโนมัติ'], screen: 'ruleNew', perm: 'automation.rule.write' },
    { id: 'templates', label: 'สูตรอัตโนมัติสำเร็จรูป', example: 'สูตร', keywords: ['สูตร', 'template'], screen: 'templates', perm: 'automation.rule.read' },
    { id: 'lineMe', label: 'ผูก LINE ของฉัน (รับแจ้งเตือนส่วนตัวทาง LINE)', example: 'ผูกไลน์', keywords: ['ผูกไลน์', 'ผูก line'], screen: 'lineMe', perm: 'automation.notify.read' },
    { id: 'inbox', label: 'การแจ้งเตือนทั้งหมด', example: 'แจ้งเตือน', keywords: ['แจ้งเตือน', 'noti'], screen: 'notifications', perm: 'automation.notify.read' },
  ],
  screens: {
    templates: {
      kind: 'list', display: 'cards', title: 'สูตรสำเร็จรูป — เปิดใช้ได้ในคลิกเดียว', endpoint: '/templates', perm: 'automation.rule.read', mobile: true,
      columns: [
        { key: 'name', label: 'ชื่อ' },
        { key: 'summary', label: 'ทำอะไร' },
        { key: 'recipients', label: 'แจ้งถึง' },
        { key: 'module_label', label: 'จากโมดูล' },
        { key: 'applied', label: 'ใช้อยู่', format: 'boolean' },
      ],
      rowActions: [
        { id: 'apply', label: 'เปิดใช้', method: 'POST', endpoint: '/templates/:id/apply', perm: 'automation.rule.write', tone: 'primary',
          when: { field: 'applied', in: [false] }, then: { screen: 'rule', idFrom: 'id' }, mobile: true },
      ],
      create: 'ruleNew', createLabel: 'สร้างกฎเอง',
      empty: 'ยังไม่มีสูตร',
    },
    rules: {
      kind: 'list', title: 'กฎอัตโนมัติ', endpoint: '/rules', perm: 'automation.rule.read', mobile: true,
      columns: [
        { key: 'name', label: 'ชื่อ' },
        { key: 'summary', label: 'เมื่อ / ถ้า / ให้' },
        { key: 'enabled', label: 'เปิด', format: 'boolean' },
        { key: 'fire_count', label: 'ทำงานแล้ว (ครั้ง)', format: 'qty' },
        { key: 'last_fired_at', label: 'ล่าสุด', format: 'datetime' },
      ],
      rowLink: { screen: 'rule' },
      rowActions: [
        { id: 'enable', label: 'เปิด', method: 'POST', endpoint: '/rules/:id/enable', perm: 'automation.rule.write', when: { field: 'enabled', in: [false] }, mobile: true },
        { id: 'disable', label: 'ปิด', method: 'POST', endpoint: '/rules/:id/disable', perm: 'automation.rule.write', when: { field: 'enabled', in: [true] }, mobile: true },
      ],
      create: 'ruleNew', createLabel: 'สร้างกฎ',
      empty: 'ยังไม่มีกฎ — เริ่มจาก "สูตรสำเร็จรูป" ได้เลย',
    },
    ruleNew: {
      kind: 'form', title: 'สร้างกฎ: เมื่อ… ถ้า… ให้…', method: 'POST', endpoint: '/rules/simple', perm: 'automation.rule.write', mobile: true,
      fields: [
        { name: 'name', label: 'ชื่อกฎ', type: 'text', required: true },
        eventSelect,
        { name: 'conditionField', label: 'ถ้า… (ช่องข้อมูล เช่น gross, onHand — เว้นว่าง = ทุกครั้ง)', type: 'text' },
        { name: 'conditionOp', label: 'เงื่อนไข', type: 'select', options: [
          { value: 'gt', label: 'มากกว่า' }, { value: 'gte', label: 'มากกว่าหรือเท่ากับ' }, { value: 'lt', label: 'น้อยกว่า' },
          { value: 'lte', label: 'น้อยกว่าหรือเท่ากับ' }, { value: 'eq', label: 'เท่ากับ' }, { value: 'ne', label: 'ไม่เท่ากับ' }, { value: 'contains', label: 'มีคำว่า' },
        ] },
        { name: 'conditionValue', label: 'ค่า', type: 'text' },
        { name: 'actionType', label: 'ให้…', type: 'select', required: true, default: 'notify', options: [
          { value: 'notify', label: 'แจ้งเตือนในแอป' }, { value: 'line', label: 'ส่ง LINE' }, { value: 'webhook', label: 'เรียก Webhook' },
        ] },
        { name: 'to', label: 'ส่งถึงใคร', type: 'select', default: 'all', options: RECIPIENTS,
          help: 'ช่องผู้รับต้องมีในเหตุการณ์ที่เลือก (เช่น คำขออนุมัติ → ผู้อนุมัติ/ผู้ขอ, ใบลา → หัวหน้า/พนักงาน) · ส่ง LINE + เลือกผู้รับ + เว้นช่อง group ID = LINE ส่วนตัวของคนนั้น (ถ้าผูก LINE ไว้)' },
        { name: 'toUserId', label: 'หรือส่งถึงผู้ใช้คนเดียว', type: 'lookup',
          lookup: { module: 'identity', path: '/users', label: ['name', 'email'], assign: { toUserId: 'id' } } },
        { name: 'target', label: 'LINE group ID หรือ URL webhook', type: 'text', help: 'ไม่ต้องกรอกถ้าแจ้งเตือนในแอปหรือ LINE ส่วนตัว · รหัสกลุ่ม: เชิญบอทเข้ากลุ่มแล้วพิมพ์ "ไอดีกลุ่ม"' },
        { name: 'message', label: 'ข้อความ (ใช้ {{ชื่อช่อง}} ได้ — เว้นว่างใช้ข้อความมาตรฐาน)', type: 'textarea' },
      ],
      submitLabel: 'บันทึกและเปิดใช้', after: { screen: 'rule', idFrom: 'id' },
    },
    rule: {
      kind: 'detail', title: 'กฎอัตโนมัติ', endpoint: '/rules/:id', perm: 'automation.rule.read', heading: 'name', mobile: true,
      fields: [
        { key: 'summary', label: 'ทำงานอย่างไร' },
        { key: 'event_label', label: 'เหตุการณ์' },
        { key: 'recipients', label: 'แจ้งในแอปถึง' },
        { key: 'enabled', label: 'เปิดใช้', format: 'boolean' },
        { key: 'fire_count', label: 'ทำงานแล้ว (ครั้ง)', format: 'qty' },
        { key: 'last_fired_at', label: 'ล่าสุด', format: 'datetime' },
        { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' },
      ],
      lines: [{ path: 'runs', label: 'ประวัติ 20 ครั้งล่าสุด', columns: [
        { key: 'created_at', label: 'เวลา', format: 'datetime' }, { key: 'status', label: 'ผล', format: 'status' }, { key: 'detail', label: 'รายละเอียด' },
      ] }],
      actions: [
        { id: 'enable', label: 'เปิดใช้', method: 'POST', endpoint: '/rules/:id/enable', perm: 'automation.rule.write', when: { field: 'enabled', in: [false] }, tone: 'primary', mobile: true },
        { id: 'disable', label: 'ปิดชั่วคราว', method: 'POST', endpoint: '/rules/:id/disable', perm: 'automation.rule.write', when: { field: 'enabled', in: [true] }, mobile: true },
        { id: 'test', label: 'ลองรัน (ไม่ส่งจริง)', method: 'POST', endpoint: '/rules/:id/test', perm: 'automation.rule.read', toast: 'preview' },
        { id: 'delete', label: 'ลบกฎ', method: 'DELETE', endpoint: '/rules/:id', perm: 'automation.rule.write', tone: 'danger', confirm: 'ลบกฎนี้?', then: { screen: 'rules' } },
      ],
    },
    notifications: {
      kind: 'list', title: 'การแจ้งเตือน', endpoint: '/notifications', rows: 'items', perm: 'automation.notify.read', mobile: true,
      filters: [{ name: 'unread', label: 'เฉพาะที่ยังไม่อ่าน', type: 'boolean' }],
      columns: [
        { key: 'created_at', label: 'เวลา', format: 'datetime' },
        { key: 'level', label: 'ระดับ', format: 'status' },
        { key: 'title', label: 'เรื่อง' },
        { key: 'body', label: 'รายละเอียด' },
        { key: 'personal', label: 'ถึงฉันโดยตรง', format: 'boolean' },
        { key: 'read_at', label: 'อ่านเมื่อ', format: 'datetime' },
      ],
      actions: [{ id: 'readAll', label: 'อ่านทั้งหมด', method: 'POST', endpoint: '/notifications/read-all', perm: 'automation.notify.read', mobile: true }],
      rowActions: [{ id: 'read', label: 'อ่านแล้ว', method: 'POST', endpoint: '/notifications/:id/read', perm: 'automation.notify.read', when: { field: 'read_at', in: [null] }, mobile: true }],
      empty: 'ไม่มีการแจ้งเตือน',
    },
    lineMe: {
      kind: 'detail', title: 'ผูก LINE ของฉัน', endpoint: '/line/me', perm: 'automation.notify.read', heading: 'status', mobile: true,
      fields: [
        { key: 'instructions', label: 'วิธีใช้' },
        { key: 'code', label: 'รหัสผูกบัญชี (6 หลัก)' },
        { key: 'send_text', label: 'พิมพ์ข้อความนี้ในแชต LINE OA' },
        { key: 'code_expires_at', label: 'รหัสหมดอายุ', format: 'datetime' },
        { key: 'add_friend_url', label: 'เพิ่มเพื่อน LINE OA ของบริษัท (สแกน)', format: 'qr' },
        { key: 'oa_id', label: 'LINE OA' },
        { key: 'line_name', label: 'ชื่อใน LINE' },
        { key: 'linked_at', label: 'ผูกเมื่อ', format: 'datetime' },
      ],
      actions: [
        { id: 'code', label: 'ขอรหัสผูกบัญชี', method: 'POST', endpoint: '/line/link-code', perm: 'automation.notify.read', tone: 'primary', toast: 'message', when: { field: 'linked', in: [false] }, mobile: true },
        { id: 'test', label: 'ทดสอบส่งถึงฉัน', method: 'POST', endpoint: '/line/test', perm: 'automation.notify.read', toast: 'message', when: { field: 'linked', in: [true] }, mobile: true },
        { id: 'relink', label: 'ผูก LINE อื่นแทน', method: 'POST', endpoint: '/line/link-code', perm: 'automation.notify.read', toast: 'message', when: { field: 'linked', in: [true] }, mobile: true },
        { id: 'unlink', label: 'ยกเลิกการผูก LINE', method: 'POST', endpoint: '/line/unlink', perm: 'automation.notify.read', tone: 'danger', confirm: 'หยุดรับแจ้งเตือนส่วนตัวทาง LINE?', toast: 'message', when: { field: 'linked', in: [true] }, mobile: true },
      ],
    },
    lineSetup: {
      kind: 'detail', title: 'ตั้งค่า LINE OA', endpoint: '/line/settings', perm: 'automation.line.manage', heading: 'status',
      fields: [
        { key: 'webhook_url', label: 'Webhook URL (วางใน LINE Developers → Messaging API)' },
        { key: 'webhook_note', label: 'หมายเหตุ' },
        { key: 'channel_secret_set', label: 'ตั้ง LINE_CHANNEL_SECRET แล้ว', format: 'boolean' },
        { key: 'access_token_set', label: 'ตั้ง LINE_CHANNEL_ACCESS_TOKEN แล้ว', format: 'boolean' },
        { key: 'public_base_url_set', label: 'ตั้ง PUBLIC_BASE_URL แล้ว', format: 'boolean' },
        { key: 'oa_id', label: 'LINE OA (LINE_OA_ID)' },
        { key: 'add_friend_url', label: 'QR เพิ่มเพื่อน (ให้พนักงานสแกน)', format: 'qr' },
        { key: 'linked_users', label: 'ผู้ใช้ที่ผูก LINE แล้ว (คน)', format: 'qty' },
        { key: 'rotated_at', label: 'สร้าง URL ใหม่ล่าสุด', format: 'datetime' },
      ],
      actions: [
        // the yellow button only once everything is configured; before that the test is a plain button (it shows what is missing)
        { id: 'test', label: 'ทดสอบส่งถึงฉัน', method: 'POST', endpoint: '/line/test', perm: 'automation.notify.read', toast: 'message', tone: 'primary', when: { field: 'ready', in: [true] } },
        { id: 'testIncomplete', label: 'ทดสอบส่งถึงฉัน', method: 'POST', endpoint: '/line/test', perm: 'automation.notify.read', toast: 'message', when: { field: 'ready', in: [false] } },
        { id: 'rotate', label: 'สร้าง Webhook URL ใหม่', method: 'POST', endpoint: '/line/settings/rotate', perm: 'automation.line.manage', toast: 'message',
          confirm: 'URL เดิมจะใช้ไม่ได้ทันที ต้องนำ URL ใหม่ไปวางใน LINE Developers — ดำเนินการต่อ?' },
      ],
    },
    lineLinks: {
      kind: 'list', title: 'ผู้ใช้ที่ผูก LINE', endpoint: '/line/links', perm: 'automation.line.manage',
      columns: [
        { key: 'user_name', label: 'ผู้ใช้ ERP' },
        { key: 'line_name', label: 'ชื่อใน LINE' },
        { key: 'linked_at', label: 'ผูกเมื่อ', format: 'datetime' },
      ],
      rowActions: [
        { id: 'unlink', label: 'ยกเลิกการผูก', method: 'DELETE', endpoint: '/line/links/:id', perm: 'automation.line.manage', tone: 'danger', confirm: 'ยกเลิกการผูก LINE ของผู้ใช้นี้? (เช่น พนักงานลาออก)' },
      ],
      empty: 'ยังไม่มีใครผูก LINE — ให้พนักงานเปิดเมนู "ผูก LINE ของฉัน"',
    },
    runs: {
      kind: 'list', title: 'ประวัติการทำงาน', endpoint: '/runs', perm: 'automation.rule.read',
      columns: [
        { key: 'created_at', label: 'เวลา', format: 'datetime' },
        { key: 'rule_name', label: 'กฎ' },
        { key: 'event_type', label: 'เหตุการณ์' },
        { key: 'status', label: 'ผล', format: 'status' },
        { key: 'detail', label: 'รายละเอียด' },
      ],
      rowLink: { screen: 'rule', idFrom: 'rule_id' },
      empty: 'ยังไม่มีการทำงาน',
    },
  },
});
