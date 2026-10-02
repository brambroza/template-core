import { defineUi, type Field } from '@erp/ui-schema';

const machine: Field = {
  name: 'machineId', label: 'เครื่องจักร', type: 'lookup', required: true,
  lookup: { path: '/machines', label: ['code', 'name'], assign: { machineId: 'id' }, scanField: 'code' },
};

export default defineUi({
  module: 'maintenance',
  label: 'ซ่อมบำรุง',
  glyph: 'บ',
  menu: [
    { label: 'งานซ่อม', screen: 'woList' },
    { label: 'แจ้งซ่อม', screen: 'woNew' },
    { label: 'เครื่องจักร', screen: 'machines' },
    { label: 'แผน PM', screen: 'pmList' },
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
    },
    woNew: {
      kind: 'form', title: 'แจ้งซ่อม', method: 'POST', endpoint: '/work-orders', perm: 'maintenance.wo.report', mobile: true,
      fields: [machine, { name: 'title', label: 'อาการ', type: 'text', required: true }, { name: 'description', label: 'รายละเอียด', type: 'textarea' }],
      submitLabel: 'แจ้งซ่อม', after: { screen: 'woDetail', idFrom: 'id' },
    },
    woDetail: {
      kind: 'detail', title: 'งานซ่อม', endpoint: '/work-orders/:id', perm: 'maintenance.machine.read', heading: 'no', mobile: true,
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'machine_code', label: 'เครื่อง' }, { key: 'machine_name', label: 'ชื่อเครื่อง' },
        { key: 'kind', label: 'ประเภท', format: 'label' }, { key: 'title', label: 'อาการ/งาน' }, { key: 'description', label: 'รายละเอียด' },
        { key: 'reported_at', label: 'แจ้งเมื่อ', format: 'datetime' }, { key: 'started_at', label: 'เริ่มซ่อม', format: 'datetime' },
        { key: 'completed_at', label: 'ซ่อมเสร็จ', format: 'datetime' }, { key: 'downtime_minutes', label: 'เครื่องหยุด (นาที)', format: 'qty' },
        { key: 'resolution', label: 'วิธีแก้' },
      ],
      lines: [{ path: 'parts', label: 'อะไหล่ที่ใช้', columns: [{ key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' }, { key: 'qty', label: 'จำนวน', format: 'qty' }] }],
      actions: [
        { id: 'start', label: 'รับงาน', method: 'POST', endpoint: '/work-orders/:id/start', perm: 'maintenance.wo.work', when: { field: 'status', in: ['open'] }, tone: 'primary', mobile: true },
        { id: 'complete', label: 'ปิดงานซ่อม', method: 'POST', endpoint: '/work-orders/:id/complete', perm: 'maintenance.wo.work', when: { field: 'status', in: ['open', 'in_progress'] }, tone: 'primary', mobile: true,
          fields: [
            { name: 'resolution', label: 'วิธีแก้', type: 'textarea', required: true },
            { name: 'downtimeMinutes', label: 'เครื่องหยุด (นาที)', type: 'number' },
            { name: 'warehouseCode', label: 'เบิกอะไหล่จากคลัง', type: 'text', default: 'MAIN' },
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
      kind: 'detail', title: 'ประวัติเครื่องจักร', endpoint: '/machines/:id/history', perm: 'maintenance.machine.read', heading: 'machine.code', mobile: true,
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
  },
});
