import { defineUi, type Field } from '@erp/ui-schema';
import { EVENTS } from './catalog.js';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */
const eventSelect: Field = {
  name: 'eventType', label: 'เมื่อ…', type: 'select', required: true,
  options: EVENTS.map((e) => ({ value: e.type, label: e.label })),
};

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
  ],
  notifications: {
    endpoint: '/notifications', readEndpoint: '/notifications/:id/read', readAllEndpoint: '/notifications/read-all', perm: 'automation.notify.read',
  },
  widgets: [
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
    { id: 'inbox', label: 'การแจ้งเตือนทั้งหมด', example: 'แจ้งเตือน', keywords: ['แจ้งเตือน', 'noti'], screen: 'notifications', perm: 'automation.notify.read' },
  ],
  screens: {
    templates: {
      kind: 'list', title: 'สูตรสำเร็จรูป — เปิดใช้ได้ในคลิกเดียว', endpoint: '/templates', perm: 'automation.rule.read', mobile: true,
      columns: [
        { key: 'name', label: 'ชื่อ' },
        { key: 'summary', label: 'ทำอะไร' },
        { key: 'module', label: 'จากโมดูล', format: 'label' },
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
        { name: 'target', label: 'LINE group/user ID หรือ URL webhook', type: 'text', help: 'ไม่ต้องกรอกถ้าแจ้งเตือนในแอป' },
        { name: 'message', label: 'ข้อความ (ใช้ {{ชื่อช่อง}} ได้ — เว้นว่างใช้ข้อความมาตรฐาน)', type: 'textarea' },
      ],
      submitLabel: 'บันทึกและเปิดใช้', after: { screen: 'rule', idFrom: 'id' },
    },
    rule: {
      kind: 'detail', title: 'กฎอัตโนมัติ', endpoint: '/rules/:id', perm: 'automation.rule.read', heading: 'name', mobile: true,
      fields: [
        { key: 'summary', label: 'ทำงานอย่างไร' },
        { key: 'event_label', label: 'เหตุการณ์' },
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
      columns: [
        { key: 'created_at', label: 'เวลา', format: 'datetime' },
        { key: 'level', label: 'ระดับ', format: 'status' },
        { key: 'title', label: 'เรื่อง' },
        { key: 'body', label: 'รายละเอียด' },
        { key: 'read_at', label: 'อ่านเมื่อ', format: 'datetime' },
      ],
      actions: [{ id: 'readAll', label: 'อ่านทั้งหมด', method: 'POST', endpoint: '/notifications/read-all', perm: 'automation.notify.read', mobile: true }],
      rowActions: [{ id: 'read', label: 'อ่านแล้ว', method: 'POST', endpoint: '/notifications/:id/read', perm: 'automation.notify.read', when: { field: 'read_at', in: [null] }, mobile: true }],
      empty: 'ไม่มีการแจ้งเตือน',
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
