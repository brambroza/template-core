import { defineUi, type Field } from '@erp/ui-schema';

const machine: Field = {
  name: 'machineId', label: 'เครื่องจักร', type: 'lookup', required: true,
  lookup: { path: '/machines', label: ['code', 'name'], assign: { machineId: 'id' }, scanField: 'code' },
};

export default defineUi({
  module: 'maintenance',
  label: 'ซ่อมบำรุง',
  glyph: 'บ',
  icon: 'wrench',
  statusLabels: { in_progress: 'กำลังซ่อม' },
  menu: [
    { label: 'งานซ่อม', screen: 'woList' },
    { label: 'แจ้งซ่อม', screen: 'woNew' },
    { label: 'เครื่องจักร', screen: 'machines' },
    { label: 'แผน PM', screen: 'pmList' },
    { label: 'ตั้งค่า', screen: 'settings' },
  ],
  commands: [
    { id: 'report', label: 'แจ้งซ่อมเครื่องจักร', example: 'แจ้งซ่อม PRESS-01 น้ำมันรั่ว', keywords: ['แจ้งซ่อม', 'ซ่อม', 'เครื่องเสีย', 'เสีย'], screen: 'woNew', perm: 'maintenance.wo.report',
      arg: { lookup: { path: '/machines', label: ['code', 'name'], assign: { machineId: 'id' } } }, restField: 'title' },
    { id: 'history', label: 'ประวัติเครื่องจักร', example: 'เครื่อง CNC-01', keywords: ['เครื่อง', 'ประวัติเครื่อง', 'machine'], screen: 'machineHistory', perm: 'maintenance.machine.read',
      arg: { lookup: { path: '/machines', label: ['code', 'name'], assign: { machineId: 'id' } }, openId: 'id' } },
    { id: 'jobs', label: 'งานซ่อมที่ค้าง', example: 'งานซ่อม', keywords: ['งานซ่อม', 'งานค้าง'], screen: 'woList', perm: 'maintenance.machine.read' },
  ],
  search: [
    { id: 'machines', title: 'เครื่องจักร', endpoint: '/machines', label: ['code', 'name', 'location'], screen: 'machineHistory', perm: 'maintenance.machine.read' },
    { id: 'workOrders', title: 'งานซ่อม', endpoint: '/work-orders', label: ['no', 'machine_code', 'title'], screen: 'woDetail', perm: 'maintenance.machine.read' },
  ],
  screens: {
    woList: {
      kind: 'list', title: 'งานซ่อม', endpoint: '/work-orders', perm: 'maintenance.machine.read', mobile: true,
      filters: [{ name: 'status', label: 'สถานะ', type: 'select', options: [{ value: 'open', label: 'รอดำเนินการ' }, { value: 'in_progress', label: 'กำลังซ่อม' }, { value: 'done', label: 'เสร็จแล้ว' }] }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'machine_code', label: 'เครื่อง' }, { key: 'kind', label: 'ประเภท', format: 'label' },
        { key: 'title', label: 'อาการ/งาน' }, { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'reported_at', label: 'แจ้งเมื่อ', format: 'datetime' },
      ],
      create: 'woNew', createLabel: 'แจ้งซ่อม', rowLink: { screen: 'woDetail' }, empty: 'ไม่มีงานซ่อม',
      display: 'board',
      board: {
        field: 'status', lanes: [{ value: 'open', label: 'รอดำเนินการ' }, { value: 'in_progress', label: 'กำลังซ่อม' }, { value: 'done', label: 'เสร็จแล้ว' }],
        moves: { in_progress: ['start'], done: ['complete'] },
        card: ['title', 'machine_code', 'no', 'kind', 'reported_at'],
      },
    },
    woNew: {
      kind: 'form', title: 'แจ้งซ่อม', method: 'POST', endpoint: '/work-orders', perm: 'maintenance.wo.report', mobile: true,
      fields: [machine, { name: 'title', label: 'อาการ', type: 'text', required: true }, { name: 'description', label: 'รายละเอียด', type: 'textarea' }],
      // photo of the breakdown taken on the spot (or a video still, an error screen, a manual page) goes in with the report
      attach: { entity: 'work-order', label: 'รูปถ่าย / ไฟล์แนบ', hint: 'ถ่ายรูปจุดที่เสีย หน้าจอ error หรือป้ายเครื่อง แนบ PDF/คู่มือก็ได้ — ช่างเห็นก่อนไปหน้างาน', photos: true },
      submitLabel: 'แจ้งซ่อม', after: { screen: 'woDetail', idFrom: 'id' },
    },
    woDetail: {
      kind: 'detail', title: 'งานซ่อม', endpoint: '/work-orders/:id', perm: 'maintenance.machine.read', heading: 'no', attachments: { entity: 'work-order', label: 'รูปถ่าย / เอกสาร' }, mobile: true,
      flow: { field: 'status', steps: [{ value: 'open', label: 'แจ้ง' }, { value: 'in_progress', label: 'กำลังซ่อม' }, { value: 'done', label: 'เสร็จ' }], exits: [{ value: 'cancelled', label: 'ยกเลิก' }] },
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'machine_code', label: 'เครื่อง' }, { key: 'machine_name', label: 'ชื่อเครื่อง' },
        { key: 'kind', label: 'ประเภท', format: 'label' }, { key: 'title', label: 'อาการ/งาน' }, { key: 'description', label: 'รายละเอียด' },
        { key: 'reported_at', label: 'แจ้งเมื่อ', format: 'datetime' }, { key: 'started_at', label: 'เริ่มซ่อม', format: 'datetime' },
        { key: 'completed_at', label: 'ซ่อมเสร็จ', format: 'datetime' }, { key: 'downtime_minutes', label: 'เครื่องหยุด (นาที)', format: 'qty' },
        { key: 'resolution', label: 'วิธีแก้' }, { key: 'parts_warehouse', label: 'คลังอะไหล่' },
      ],
      lines: [{ path: 'parts', label: 'อะไหล่ที่ใช้', columns: [{ key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' }, { key: 'qty', label: 'จำนวน', format: 'qty' }] }],
      actions: [
        { id: 'start', label: 'รับงาน', method: 'POST', endpoint: '/work-orders/:id/start', perm: 'maintenance.wo.work', when: { field: 'status', in: ['open'] }, tone: 'primary', mobile: true },
        { id: 'complete', label: 'ปิดงานซ่อม', method: 'POST', endpoint: '/work-orders/:id/complete', perm: 'maintenance.wo.work', when: { field: 'status', in: ['open', 'in_progress'] }, tone: 'primary', mobile: true,
          fields: [
            { name: 'resolution', label: 'วิธีแก้', type: 'textarea', required: true },
            { name: 'downtimeMinutes', label: 'เครื่องหยุด (นาที)', type: 'number' },
            { name: 'warehouseCode', label: 'เบิกอะไหล่จากคลัง', type: 'text',
              help: 'เว้นว่าง = คลังอะไหล่ที่ตั้งไว้ (เริ่มต้น SPARE ดูช่อง "คลังอะไหล่" ด้านบน) · ใส่รหัสคลังเมื่อเบิกจากคลังอื่น' },
          ],
          lines: {
            name: 'parts', label: 'อะไหล่ที่ใช้',
            fields: [
              { name: 'itemId', label: 'อะไหล่', type: 'lookup', lookup: { module: 'master-data', path: '/items', query: { type: 'spare' }, label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' }, scanField: 'code' } },
              { name: 'qty', label: 'จำนวน', type: 'number' },
            ],
          } },
      ],
    },
    machines: {
      kind: 'list', title: 'เครื่องจักร', endpoint: '/machines', perm: 'maintenance.machine.read', mobile: true,
      columns: [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }, { key: 'location', label: 'ที่ตั้ง' }, { key: 'status', label: 'สถานะ', format: 'status' }],
      filters: [{ name: 'status', label: 'สถานะ', type: 'select', options: [{ value: 'running', label: 'เดินเครื่อง' }, { value: 'down', label: 'เครื่องเสีย' }, { value: 'retired', label: 'เลิกใช้' }] }],
      create: 'machineNew', createLabel: 'เพิ่มเครื่องจักร', rowLink: { screen: 'machineHistory' }, empty: 'ยังไม่มีเครื่องจักร',
    },
    machineNew: {
      kind: 'form', title: 'เพิ่มเครื่องจักร', method: 'POST', endpoint: '/machines', perm: 'maintenance.machine.write',
      fields: [
        { name: 'code', label: 'รหัส (พิมพ์บน QR)', type: 'text', required: true },
        { name: 'name', label: 'ชื่อ', type: 'text', required: true },
        { name: 'location', label: 'ที่ตั้ง', type: 'text' },
      ],
      submitLabel: 'บันทึกเครื่องจักร', after: { screen: 'machines' },
    },
    machineHistory: {
      kind: 'detail', title: 'ประวัติเครื่องจักร', endpoint: '/machines/:id/history', perm: 'maintenance.machine.read', heading: 'machine.code', attachments: { entity: 'machine', label: 'รูปเครื่อง / คู่มือ / ใบรับรอง' }, mobile: true,
      fields: [
        { key: 'machine.name', label: 'ชื่อ' }, { key: 'machine.location', label: 'ที่ตั้ง' }, { key: 'machine.status', label: 'สถานะ', format: 'status' },
        { key: 'breakdowns', label: 'เสียทั้งหมด (ครั้ง)', format: 'qty' }, { key: 'totalDowntimeMinutes', label: 'เครื่องหยุดรวม (นาที)', format: 'qty' },
      ],
      lines: [{
        path: 'workOrders', label: 'งานซ่อมทั้งหมด',
        columns: [{ key: 'no', label: 'เลขที่' }, { key: 'kind', label: 'ประเภท', format: 'label' }, { key: 'title', label: 'อาการ/งาน' }, { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'reported_at', label: 'แจ้งเมื่อ', format: 'datetime' }, { key: 'downtime_minutes', label: 'หยุด (นาที)', format: 'qty' }],
      }],
    },
    pmList: {
      kind: 'list', title: 'แผนบำรุงรักษาเชิงป้องกัน (PM)', endpoint: '/pm-plans', perm: 'maintenance.machine.read',
      columns: [
        { key: 'machine_code', label: 'เครื่อง' }, { key: 'title', label: 'งาน' }, { key: 'interval_days', label: 'ทุก (วัน)', format: 'qty' },
        { key: 'next_due_on', label: 'ครบกำหนด', format: 'date' }, { key: 'last_done_on', label: 'ทำล่าสุด', format: 'date' },
      ],
      create: 'pmNew', createLabel: 'เพิ่มแผน PM', empty: 'ยังไม่มีแผน PM',
      actions: [{ id: 'generate', label: 'สร้างงาน PM ที่ถึงกำหนด', method: 'POST', endpoint: '/pm-plans/generate', perm: 'maintenance.machine.write',
        fields: [{ name: 'asOf', label: 'ถึงวันที่', type: 'date', required: true }] }],
    },
    pmNew: {
      kind: 'form', title: 'เพิ่มแผน PM', method: 'POST', endpoint: '/pm-plans', perm: 'maintenance.machine.write',
      fields: [
        machine,
        { name: 'title', label: 'งาน', type: 'text', required: true },
        { name: 'intervalDays', label: 'ทำทุกกี่วัน', type: 'number', required: true },
        { name: 'firstDueOn', label: 'ครบกำหนดครั้งแรก', type: 'date', required: true },
      ],
      submitLabel: 'บันทึกแผน', after: { screen: 'pmList' },
    },
    settings: {
      kind: 'form', title: 'ตั้งค่าซ่อมบำรุง', method: 'PUT', endpoint: '/settings', load: '/settings', perm: 'maintenance.settings.write',
      fields: [{ name: 'defaultPartsWarehouse', label: 'คลังอะไหล่เริ่มต้น (ตัดอะไหล่เมื่อปิดงานซ่อม)', type: 'text', required: true, default: 'SPARE',
        help: 'รหัสคลังในโมดูลคลังสินค้า เช่น SPARE · ช่างเปลี่ยนเป็นคลังอื่นได้ตอนปิดงาน' }],
      submitLabel: 'บันทึกการตั้งค่า', after: { screen: 'woList' },
    },
  },
  widgets: [
    { id: 'floor', kind: 'floor3d', title: 'ผังโรงงาน', endpoint: '/summary', perm: 'maintenance.machine.read', size: 'wide', href: 'machines',
      rows: 'machines', code: 'code', name: 'name', status: 'status', group: 'location', badge: 'open_work_orders', link: { screen: 'machineHistory' } },
    { id: 'mt-kpi', kind: 'kpi', title: 'ซ่อมบำรุง', endpoint: '/summary', perm: 'maintenance.machine.read', size: 'sm', href: 'woList',
      items: [{ key: 'down', label: 'เครื่องเสียตอนนี้', format: 'qty', tone: 'stop' }, { key: 'openWorkOrders', label: 'งานซ่อมค้าง', format: 'qty', tone: 'warn' }, { key: 'pmDue7d', label: 'PM ใน 7 วัน', format: 'qty' }] },
  ],
});
