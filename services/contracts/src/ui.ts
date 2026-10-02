import { defineUi, type Column, type Field, type Lookup } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const opt = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const contractStatuses = opt([['draft', 'ร่าง'], ['active', 'มีผล'], ['expired', 'หมดอายุ'], ['cancelled', 'ยกเลิก']]);
const visitStatuses = opt([['planned', 'นัดแล้ว'], ['done', 'เข้าแล้ว'], ['missed', 'ไม่ได้เข้า'], ['cancelled', 'ยกเลิก']]);
const plans = opt([['one_time', 'ครั้งเดียว'], ['monthly', 'รายเดือน'], ['quarterly', 'รายไตรมาส'], ['yearly', 'รายปี']]);
const coverages = opt([['8x5', 'เวลาทำการ (8x5)'], ['24x7', '24 ชม. ทุกวัน (24x7)']]);

const customerLookup: Lookup = {
  module: 'master-data', path: '/partners', query: { kind: 'customer' }, label: ['code', 'name'],
  assign: { customerId: 'id', customerCode: 'code', customerName: 'name' },
};
const userLookup = (id: string, name: string): Lookup => ({ module: 'identity', path: '/users/directory', label: ['name', 'email'], assign: { [id]: 'id', [name]: 'name' } });

const contractFields: Field[] = [
  { name: 'customerId', label: 'ลูกค้า', type: 'lookup', required: true, lookup: customerLookup },
  { name: 'title', label: 'ชื่อสัญญา / ขอบเขตงาน', type: 'text', required: true, help: 'เช่น MA ระบบ CCTV และเครือข่าย ปี 2570' },
  { name: 'contactName', label: 'ผู้ติดต่อฝั่งลูกค้า', type: 'text' },
  { name: 'contactPhone', label: 'เบอร์ / LINE ผู้ติดต่อ', type: 'text' },
  { name: 'startDate', label: 'เริ่มสัญญา', type: 'date', required: true },
  { name: 'endDate', label: 'สิ้นสุดสัญญา', type: 'date', required: true },
  { name: 'value', label: 'มูลค่าสัญญา (บาท ก่อน VAT)', type: 'number', step: 0.01, required: true },
  { name: 'billingPlan', label: 'การวางบิล', type: 'select', default: 'yearly', options: plans },
  { name: 'coverage', label: 'ช่วงเวลาให้บริการ', type: 'select', default: '8x5', options: coverages },
  { name: 'slaResponseHours', label: 'SLA ตอบรับ (ชั่วโมง)', type: 'number', default: 4, step: 0.5 },
  { name: 'slaResolveHours', label: 'SLA แก้ไขเสร็จ (ชั่วโมง)', type: 'number', default: 24, step: 0.5 },
  { name: 'pmEveryMonths', label: 'เข้า PM ทุก (เดือน)', type: 'number', default: 3, step: 1, help: '0 = ไม่มีรอบ PM' },
  { name: 'firstPmDate', label: 'วัน PM ครั้งแรก', type: 'date', help: 'เว้นว่าง = วันเริ่มสัญญา' },
  { name: 'technicianId', label: 'ช่างประจำสัญญา', type: 'lookup', lookup: userLookup('technicianId', 'technicianName') },
  { name: 'checklistText', label: 'รายการตรวจเช็ค PM (บรรทัดละรายการ)', type: 'textarea', help: 'เช่น ตรวจภาพกล้องทุกตัว / ตรวจ HDD ของ NVR / ทำความสะอาดหน้ากล้อง' },
  { name: 'note', label: 'เงื่อนไข / หมายเหตุ', type: 'textarea' },
];

const itemFields: Field[] = [
  { name: 'asset', label: 'อุปกรณ์ / ระบบ', type: 'text', required: true },
  { name: 'serialNo', label: 'Serial No.', type: 'text' },
  { name: 'location', label: 'สถานที่ / จุดติดตั้ง', type: 'text' },
];

const contractColumns: Column[] = [
  { key: 'no', label: 'เลขที่' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'title', label: 'สัญญา' },
  { key: 'end_date', label: 'สิ้นสุด', format: 'date' }, { key: 'days_left', label: 'เหลือ (วัน)', format: 'qty' },
  { key: 'value', label: 'มูลค่า', format: 'money', total: true }, { key: 'billing_plan_label', label: 'วางบิล' }, { key: 'status', label: 'สถานะ', format: 'status' },
];

const visitColumns: Column[] = [
  { key: 'no', label: 'เลขที่' }, { key: 'scheduled_date', label: 'วันนัด', format: 'date' }, { key: 'customer_name', label: 'ลูกค้า' },
  { key: 'contract_no', label: 'สัญญา' }, { key: 'technician_name', label: 'ช่าง' }, { key: 'status', label: 'สถานะ', format: 'status' },
  { key: 'overdue', label: 'เลยนัด', format: 'boolean' },
];

const startAction = {
  id: 'start', label: 'เริ่มตรวจเช็ค', method: 'POST' as const, endpoint: '/visits/:id/start', perm: 'contracts.visit.work',
  when: { field: 'status', in: ['planned'] }, tone: 'primary' as const, mobile: true, then: { screen: 'visitChecks', idFrom: 'id' },
};

export default defineUi({
  module: 'contracts',
  label: 'สัญญาบริการ MA',
  glyph: 'ส',
  icon: 'file-signature',
  area: 'service',
  statusLabels: { active: 'มีผล', planned: 'นัดแล้ว', done: 'เข้าแล้ว', missed: 'ไม่ได้เข้า', open: 'ยังไม่ตรวจ', pass: 'ผ่าน', fail: 'ไม่ผ่าน' },
  menu: [
    { label: 'สัญญาทั้งหมด', screen: 'contracts' },
    { label: 'สัญญาใกล้หมด (60 วัน)', screen: 'expiring' },
    { label: 'PM วันนี้', screen: 'visitsToday' },
    { label: 'งาน PM ของฉัน', screen: 'myVisits' },
    { label: 'นัด PM ทั้งหมด', screen: 'visits' },
    { label: 'ถึงกำหนดวางบิล', screen: 'billingDue' },
    { label: 'ตรวจสอบความคุ้มครอง', screen: 'coverage' },
  ],
  commands: [
    { id: 'new', label: 'สร้างสัญญาบริการ MA', example: 'สัญญา MA CUS-001 ดูแลระบบ CCTV', keywords: ['สัญญา ma', 'สัญญาบริการ', 'สัญญา'], screen: 'contractNew', perm: 'contracts.contract.write',
      arg: { lookup: customerLookup }, restField: 'title' },
    { id: 'today', label: 'งาน PM วันนี้', example: 'PM วันนี้', keywords: ['pm วันนี้', 'งาน pm', 'เข้า pm'], screen: 'visitsToday', perm: 'contracts.visit.read' },
    { id: 'expiring', label: 'สัญญา MA ใกล้หมด', example: 'MA ใกล้หมด', keywords: ['ma ใกล้หมด', 'สัญญาใกล้หมด', 'ต่อสัญญา'], screen: 'expiring', perm: 'contracts.contract.read' },
    { id: 'billing', label: 'งวดสัญญาถึงกำหนดวางบิล', example: 'วางบิล MA', keywords: ['วางบิล ma', 'วางบิล', 'ถึงกำหนดวางบิล'], screen: 'billingDue', perm: 'contracts.billing.read' },
  ],
  search: [
    { id: 'contracts', title: 'สัญญาบริการ MA', endpoint: '/contracts', label: ['no', 'customer_name', 'title'], screen: 'contract', perm: 'contracts.contract.read' },
    { id: 'visits', title: 'นัดเข้า PM', endpoint: '/visits', label: ['no', 'customer_name', 'contract_no'], screen: 'visit', perm: 'contracts.visit.read' },
  ],
  screens: {
    /* ---------- contracts ---------- */
    contracts: {
      kind: 'list', title: 'สัญญาบริการ MA', endpoint: '/contracts', perm: 'contracts.contract.read', mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่ ลูกค้า สัญญา Serial', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: contractStatuses },
        { name: 'billingPlan', label: 'การวางบิล', type: 'select', options: plans },
        { name: 'expiringDays', label: 'หมดภายใน (วัน)', type: 'number' },
      ],
      columns: contractColumns, create: 'contractNew', createLabel: 'สร้างสัญญา', rowLink: { screen: 'contract' }, empty: 'ยังไม่มีสัญญาบริการ',
    },
    contractNew: {
      kind: 'form', title: 'สร้างสัญญาบริการ MA', method: 'POST', endpoint: '/contracts', perm: 'contracts.contract.write',
      fields: contractFields, lines: { name: 'items', label: 'อุปกรณ์ / สถานที่ในสัญญา', fields: itemFields },
      submitLabel: 'บันทึกร่างสัญญา', after: { screen: 'contract', idFrom: 'id' },
    },
    contractEdit: {
      kind: 'form', title: 'แก้ไขสัญญา (ร่าง)', method: 'PUT', endpoint: '/contracts/:id', load: '/contracts/:id', perm: 'contracts.contract.write',
      fields: contractFields, submitLabel: 'บันทึกการแก้ไข (อุปกรณ์แก้ที่ปุ่ม "เพิ่มอุปกรณ์")', after: { screen: 'contract', idFrom: 'id' },
    },
    contract: {
      kind: 'detail', title: 'สัญญาบริการ MA', endpoint: '/contracts/:id', perm: 'contracts.contract.read', heading: 'no', mobile: true, edit: 'contractEdit',
      print: { title: 'สัญญาบริการบำรุงรักษา (MA)', signatures: ['ผู้ให้บริการ', { label: 'ลูกค้า', name: 'contact_name' }] },
      flow: {
        field: 'status',
        steps: [{ value: 'draft', label: 'ร่าง' }, { value: 'active', label: 'มีผล' }, { value: 'expired', label: 'หมดอายุ' }],
        exits: [{ value: 'cancelled', label: 'ยกเลิก' }],
      },
      fields: [
        { key: 'customer_name', label: 'ลูกค้า' }, { key: 'title', label: 'สัญญา' }, { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'contact_name', label: 'ผู้ติดต่อ' }, { key: 'contact_phone', label: 'เบอร์ / LINE' },
        { key: 'start_date', label: 'เริ่มสัญญา', format: 'date', section: 'ระยะเวลาและมูลค่า' }, { key: 'end_date', label: 'สิ้นสุดสัญญา', format: 'date' }, { key: 'days_left', label: 'เหลือ (วัน)', format: 'qty' },
        { key: 'value', label: 'มูลค่าสัญญา (ก่อน VAT)', format: 'money', emphasis: true }, { key: 'billing_plan_label', label: 'การวางบิล' },
        { key: 'billed_amount', label: 'วางบิลแล้ว', format: 'money' }, { key: 'unbilled_amount', label: 'ยังไม่วางบิล', format: 'money' },
        { key: 'coverage_label', label: 'ช่วงเวลาให้บริการ', section: 'ระดับบริการและ PM' }, { key: 'sla_response_hours', label: 'SLA ตอบรับ (ชม.)', format: 'qty' }, { key: 'sla_resolve_hours', label: 'SLA แก้ไขเสร็จ (ชม.)', format: 'qty' },
        { key: 'pm_label', label: 'รอบ PM' }, { key: 'next_visit_date', label: 'นัด PM ถัดไป', format: 'date' }, { key: 'visits_done', label: 'เข้า PM แล้ว (ครั้ง)', format: 'qty' },
        { key: 'technician_name', label: 'ช่างประจำสัญญา' }, { key: 'checklist', label: 'รายการตรวจเช็ค PM', format: 'list' }, { key: 'note', label: 'เงื่อนไข / หมายเหตุ' },
        { key: 'renewal_of_no', label: 'ต่ออายุจากสัญญา', section: 'การต่ออายุ / ยกเลิก' }, { key: 'renewed_to_no', label: 'ต่ออายุเป็นสัญญา' }, { key: 'uplift_pct', label: 'ปรับราคาต่ออายุ (%)', format: 'percent' },
        { key: 'cancel_reason', label: 'เหตุผลที่ยกเลิก' },
      ],
      lines: [
        { path: 'items', label: 'อุปกรณ์ / สถานที่ในสัญญา', columns: [{ key: 'asset', label: 'อุปกรณ์ / ระบบ' }, { key: 'serial_no', label: 'Serial No.' }, { key: 'location', label: 'สถานที่' }] },
        { path: 'installments', label: 'งวดวางบิล', columns: [
          { key: 'seq', label: 'งวด', format: 'qty' }, { key: 'due_date', label: 'ถึงกำหนด', format: 'date' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money', total: true },
          { key: 'invoiced', label: 'วางบิลแล้ว', format: 'boolean' }, { key: 'invoice_no', label: 'เลขที่ใบแจ้งหนี้' }] },
        { path: 'visits', label: 'นัดเข้า PM', columns: [
          { key: 'no', label: 'เลขที่' }, { key: 'scheduled_date', label: 'วันนัด', format: 'date' }, { key: 'technician_name', label: 'ช่าง' },
          { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'done_on', label: 'เข้าเมื่อ', format: 'date' }] },
      ],
      actions: [
        { id: 'activate', label: 'เปิดใช้สัญญา', method: 'POST', endpoint: '/contracts/:id/activate', perm: 'contracts.contract.activate', when: { field: 'status', in: ['draft'] }, tone: 'primary',
          confirm: 'เปิดใช้สัญญาและสร้างงวดวางบิลตามแผน' },
        { id: 'generate', label: 'สร้างนัด PM', method: 'POST', endpoint: '/contracts/:id/generate-visits', perm: 'contracts.visit.plan', when: { field: 'status', in: ['active'] }, toast: 'message',
          fields: [{ name: 'until', label: 'สร้างนัดถึงวันที่', type: 'date', required: true }] },
        { id: 'item', label: 'เพิ่มอุปกรณ์', method: 'POST', endpoint: '/contracts/:id/items', perm: 'contracts.contract.write', when: { field: 'status', in: ['draft', 'active'] }, fields: itemFields },
        { id: 'renew', label: 'ต่ออายุสัญญา', method: 'POST', endpoint: '/contracts/:id/renew', perm: 'contracts.contract.write', when: { field: 'status', in: ['active', 'expired'] },
          fields: [
            { name: 'upliftPct', label: 'ปรับราคา (%)', type: 'number', default: 0, step: 0.5, help: 'มูลค่าใหม่ = มูลค่าเดิม × (1 + %)' },
            { name: 'startDate', label: 'เริ่มสัญญาใหม่', type: 'date', help: 'เว้นว่าง = วันถัดจากวันสิ้นสุดเดิม' },
            { name: 'endDate', label: 'สิ้นสุดสัญญาใหม่', type: 'date', help: 'เว้นว่าง = ระยะเวลาเท่าเดิม' },
          ],
          then: { screen: 'contract', idFrom: 'id' } },
        { id: 'cancel', label: 'ยกเลิกสัญญา', method: 'POST', endpoint: '/contracts/:id/cancel', perm: 'contracts.contract.activate', when: { field: 'status', in: ['draft', 'active'] }, tone: 'danger',
          confirm: 'ยกเลิกสัญญานี้ (นัด PM ที่ยังไม่เข้าจะถูกยกเลิก)', fields: [{ name: 'reason', label: 'เหตุผล', type: 'text' }] },
      ],
    },
    expiring: {
      kind: 'list', title: 'สัญญาใกล้หมด — ยังไม่ต่ออายุ', endpoint: '/contracts/expiring', perm: 'contracts.contract.read', mobile: true,
      filters: [{ name: 'days', label: 'หมดภายใน (วัน)', type: 'number', default: 60 }, { name: 'all', label: 'รวมที่ต่ออายุแล้ว', type: 'boolean' }],
      columns: [...contractColumns.slice(0, 6), { key: 'renewed_to_no', label: 'ต่ออายุเป็น' }],
      rowLink: { screen: 'contract' }, empty: 'ไม่มีสัญญาที่จะหมดในช่วงนี้',
      actions: [{ id: 'notify', label: 'ส่งแจ้งเตือนสัญญาใกล้หมด', method: 'POST', endpoint: '/contracts/expiring/notify', perm: 'contracts.contract.write', toast: 'message',
        fields: [{ name: 'days', label: 'หมดภายใน (วัน)', type: 'number', default: 60 }] }],
      rowActions: [{ id: 'renew', label: 'ต่ออายุ', method: 'POST', endpoint: '/contracts/:id/renew', perm: 'contracts.contract.write', when: { field: 'renewed_to_no', in: [null] }, tone: 'primary',
        fields: [{ name: 'upliftPct', label: 'ปรับราคา (%)', type: 'number', default: 0, step: 0.5 }], then: { screen: 'contract', idFrom: 'id' } }],
    },
    coverage: {
      kind: 'list', title: 'ตรวจสอบความคุ้มครอง (สัญญาที่มีผล)', endpoint: '/coverage', perm: 'contracts.contract.read', mobile: true,
      filters: [{ name: 'q', label: 'Serial / อุปกรณ์ / ลูกค้า / สถานที่', type: 'text' }, { name: 'customerId', label: 'ลูกค้า', type: 'lookup', lookup: { ...customerLookup, assign: { customerId: 'id' } } }],
      columns: [
        { key: 'serial_no', label: 'Serial No.' }, { key: 'asset', label: 'อุปกรณ์' }, { key: 'location', label: 'สถานที่' }, { key: 'customer_name', label: 'ลูกค้า' },
        { key: 'no', label: 'สัญญา' }, { key: 'end_date', label: 'คุ้มครองถึง', format: 'date' }, { key: 'coverage_label', label: 'ช่วงเวลา' },
        { key: 'sla_response_hours', label: 'ตอบรับ (ชม.)', format: 'qty' }, { key: 'sla_resolve_hours', label: 'แก้เสร็จ (ชม.)', format: 'qty' },
      ],
      rowLink: { screen: 'contract' }, empty: 'ไม่พบในสัญญาที่มีผล — อยู่นอกสัญญา MA',
    },

    /* ---------- PM visits ---------- */
    visitsToday: {
      kind: 'list', title: 'PM วันนี้ (รวมที่เลยนัด)', endpoint: '/visits/today', perm: 'contracts.visit.read', mobile: true,
      columns: visitColumns, rowLink: { screen: 'visit' }, empty: 'วันนี้ไม่มีนัดเข้า PM',
      actions: [{ id: 'generate', label: 'สร้างนัด PM จากสัญญา', method: 'POST', endpoint: '/visits/generate', perm: 'contracts.visit.plan', toast: 'message',
        fields: [{ name: 'until', label: 'สร้างนัดถึงวันที่', type: 'date', required: true }] }],
      rowActions: [{ ...startAction, label: 'เริ่ม' }],
    },
    myVisits: {
      kind: 'list', title: 'งาน PM ของฉัน', endpoint: '/visits/mine', perm: 'contracts.visit.work', mobile: true,
      filters: [{ name: 'days', label: 'ล่วงหน้า (วัน)', type: 'number' }],
      columns: [{ key: 'customer_name', label: 'ลูกค้า' }, { key: 'scheduled_date', label: 'วันนัด', format: 'date' }, { key: 'no', label: 'เลขที่' }, { key: 'overdue', label: 'เลยนัด', format: 'boolean' }, { key: 'checks_total', label: 'รายการตรวจ', format: 'qty' }],
      rowLink: { screen: 'visit' }, empty: 'วันนี้ไม่มีงาน PM', rowActions: [{ ...startAction, label: 'เริ่ม' }],
    },
    visits: {
      kind: 'list', title: 'นัดเข้า PM ทั้งหมด', endpoint: '/visits', perm: 'contracts.visit.read', mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่ ลูกค้า สัญญา ช่าง', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: visitStatuses },
        { name: 'overdue', label: 'เลยนัด', type: 'boolean' },
        { name: 'from', label: 'นัดตั้งแต่', type: 'date' }, { name: 'to', label: 'ถึงวันที่', type: 'date' },
        { name: 'technicianId', label: 'ช่าง', type: 'lookup', lookup: userLookup('technicianId', 'technicianName') },
      ],
      columns: visitColumns, rowLink: { screen: 'visit' }, empty: 'ยังไม่มีนัด PM — เปิดใช้สัญญาแล้วกด "สร้างนัด PM"',
      actions: [{ id: 'generate', label: 'สร้างนัด PM จากสัญญา', method: 'POST', endpoint: '/visits/generate', perm: 'contracts.visit.plan', toast: 'message',
        fields: [{ name: 'until', label: 'สร้างนัดถึงวันที่', type: 'date', required: true }] }],
    },
    visitEdit: {
      kind: 'form', title: 'นัดหมาย / มอบหมายช่าง', method: 'PUT', endpoint: '/visits/:id', load: '/visits/:id', perm: 'contracts.visit.plan',
      fields: [
        { name: 'scheduledDate', label: 'วันนัด', type: 'date', required: true },
        { name: 'technicianId', label: 'ช่าง', type: 'lookup', lookup: userLookup('technicianId', 'technicianName') },
      ],
      submitLabel: 'บันทึกนัด', after: { screen: 'visit', idFrom: 'id' },
    },
    visit: {
      kind: 'detail', title: 'นัดเข้า PM', endpoint: '/visits/:id', perm: 'contracts.visit.read', heading: 'no', mobile: true, edit: 'visitEdit',
      print: { title: 'รายงานการบำรุงรักษา', signatures: [{ label: 'ช่างผู้ปฏิบัติงาน', name: 'technician_name' }, { label: 'ลูกค้า', name: 'signoff_name' }] },
      flow: {
        field: 'status',
        steps: [{ value: 'planned', label: 'นัดแล้ว' }, { value: 'done', label: 'เข้าแล้ว' }],
        exits: [{ value: 'missed', label: 'ไม่ได้เข้า' }, { value: 'cancelled', label: 'ยกเลิก' }],
      },
      fields: [
        { key: 'customer_name', label: 'ลูกค้า' }, { key: 'contract_no', label: 'สัญญา' }, { key: 'contract_title', label: 'ขอบเขตสัญญา' },
        { key: 'items_text', label: 'อุปกรณ์ / สถานที่' }, { key: 'contact_name', label: 'ผู้ติดต่อ' }, { key: 'contact_phone', label: 'เบอร์ / LINE' },
        { key: 'due_date', label: 'ครบกำหนด PM', format: 'date', section: 'นัดหมาย' }, { key: 'scheduled_date', label: 'วันนัด', format: 'date' }, { key: 'overdue', label: 'เลยนัด', format: 'boolean' },
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'technician_name', label: 'ช่างผู้ปฏิบัติงาน' },
        { key: 'coverage_label', label: 'ช่วงเวลาให้บริการ' }, { key: 'sla_text', label: 'SLA' },
        { key: 'checks_done', label: 'ตรวจแล้ว (รายการ)', format: 'qty', section: 'ผลการปฏิบัติงาน' }, { key: 'checks_failed', label: 'ไม่ผ่าน (รายการ)', format: 'qty' },
        { key: 'done_on', label: 'เข้าปฏิบัติงานเมื่อ', format: 'date' }, { key: 'findings', label: 'สิ่งที่พบ / ข้อเสนอแนะ' },
        { key: 'signoff_name', label: 'ลูกค้าผู้รับรอง' }, { key: 'missed_reason', label: 'เหตุที่ไม่ได้เข้า' },
      ],
      lines: [{ path: 'checks', label: 'ผลการตรวจเช็ค', columns: [{ key: 'seq', label: 'ลำดับ', format: 'qty' }, { key: 'item', label: 'รายการตรวจ' }, { key: 'result_label', label: 'ผล' }, { key: 'note', label: 'หมายเหตุ' }] }],
      actions: [
        startAction,
        { id: 'complete', label: 'ปิดงาน + ลูกค้ารับรอง', method: 'POST', endpoint: '/visits/:id/complete', perm: 'contracts.visit.work', when: { field: 'status', in: ['planned'] }, tone: 'primary', mobile: true,
          fields: [
            { name: 'signoffName', label: 'ชื่อลูกค้าผู้รับรองงาน', type: 'text', required: true },
            { name: 'findings', label: 'สิ่งที่พบ / ข้อเสนอแนะ', type: 'textarea' },
            { name: 'markRemainingPass', label: 'รายการที่ยังไม่บันทึก = ผ่าน', type: 'boolean' },
            { name: 'doneOn', label: 'วันที่เข้าปฏิบัติงาน', type: 'date', help: 'เว้นว่าง = วันนี้' },
          ] },
        { id: 'miss', label: 'ไม่ได้เข้า', method: 'POST', endpoint: '/visits/:id/miss', perm: 'contracts.visit.plan', when: { field: 'status', in: ['planned'] }, tone: 'danger', mobile: true,
          fields: [{ name: 'reason', label: 'เหตุผล', type: 'text', required: true }] },
        { id: 'reschedule', label: 'นัดใหม่', method: 'POST', endpoint: '/visits/:id/reschedule', perm: 'contracts.visit.plan', when: { field: 'status', in: ['missed'] }, mobile: true,
          fields: [{ name: 'scheduledDate', label: 'วันนัดใหม่', type: 'date', required: true }] },
      ],
    },
    visitChecks: {
      kind: 'list', title: 'ตรวจเช็คตามรายการ', endpoint: '/visits/:id/checks', perm: 'contracts.visit.read', mobile: true,
      columns: [{ key: 'item', label: 'รายการตรวจ' }, { key: 'status', label: 'ผล', format: 'status' }, { key: 'note', label: 'หมายเหตุ' }],
      rowLink: { screen: 'visit', idFrom: 'visit_id' }, empty: 'นัดนี้ไม่มีรายการตรวจ — ปิดงานได้เลย',
      rowActions: [
        { id: 'pass', label: 'ผ่าน', method: 'POST', endpoint: '/checks/:id/pass', perm: 'contracts.visit.work', tone: 'primary', mobile: true },
        { id: 'fail', label: 'ไม่ผ่าน', method: 'POST', endpoint: '/checks/:id/fail', perm: 'contracts.visit.work', tone: 'danger', mobile: true,
          fields: [{ name: 'note', label: 'พบปัญหาอะไร', type: 'text' }] },
      ],
    },

    /* ---------- billing ---------- */
    billingDue: {
      kind: 'list', title: 'งวดสัญญาถึงกำหนดวางบิล', endpoint: '/billing', perm: 'contracts.billing.read', mobile: true,
      filters: [
        { name: 'scope', label: 'แสดง', type: 'select', default: 'due', options: opt([['due', 'ถึงกำหนดภายในเดือนนี้'], ['open', 'ยังไม่วางบิลทั้งหมด'], ['all', 'ทุกงวด']]) },
        { name: 'q', label: 'ค้นหาสัญญา ลูกค้า เลขใบแจ้งหนี้', type: 'text' },
        { name: 'overdue', label: 'เลยกำหนด', type: 'boolean' },
      ],
      columns: [
        { key: 'due_date', label: 'ถึงกำหนด', format: 'date' }, { key: 'contract_no', label: 'สัญญา' }, { key: 'customer_name', label: 'ลูกค้า' },
        { key: 'period_label', label: 'งวด' }, { key: 'billing_plan_label', label: 'แผน' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money', total: true },
        { key: 'overdue', label: 'เลยกำหนด', format: 'boolean' }, { key: 'invoice_no', label: 'ใบแจ้งหนี้' },
      ],
      rowLink: { screen: 'contract', idFrom: 'contract_id' }, empty: 'ไม่มีงวดที่ต้องวางบิล',
      actions: [{ id: 'notify', label: 'ส่งให้ฝ่ายขายร่างใบสั่งขาย', method: 'POST', endpoint: '/billing/due/notify', perm: 'contracts.billing.write', toast: 'message',
        fields: [{ name: 'days', label: 'รวมงวดที่ถึงกำหนดหลังสิ้นเดือนอีก (วัน)', type: 'number', default: 0 }] }],
      rowActions: [
        { id: 'bill', label: 'บันทึกวางบิลแล้ว', method: 'POST', endpoint: '/installments/:id/bill', perm: 'contracts.billing.write', when: { field: 'invoiced', in: [false] }, tone: 'primary', toast: 'message',
          fields: [{ name: 'invoiceNo', label: 'เลขที่ใบแจ้งหนี้/ใบกำกับ (ฝ่ายขาย)', type: 'text', required: true }, { name: 'invoicedOn', label: 'วันที่วางบิล', type: 'date' }] },
        { id: 'unbill', label: 'ยกเลิกการวางบิล', method: 'POST', endpoint: '/installments/:id/unbill', perm: 'contracts.billing.write', when: { field: 'invoiced', in: [true] }, confirm: 'ยกเลิกการบันทึกวางบิลงวดนี้', toast: 'message' },
      ],
    },
  },
  widgets: [
    { id: 'ma-kpi', kind: 'kpi', title: 'สัญญาบริการ MA', endpoint: '/summary', perm: 'contracts.contract.read', size: 'md', href: 'contracts',
      items: [
        { key: 'activeContracts', label: 'สัญญาที่มีผล', format: 'qty' },
        { key: 'activeValue', label: 'มูลค่าสัญญาที่มีผล', format: 'money', tone: 'ok' },
        { key: 'expiring60', label: 'หมดใน 60 วัน', format: 'qty', tone: 'warn' },
        { key: 'billingDueMonth', label: 'ถึงกำหนดวางบิลเดือนนี้', format: 'money', tone: 'warn' },
      ] },
    { id: 'ma-pm', kind: 'kpi', title: 'งานเข้า PM', endpoint: '/summary', perm: 'contracts.visit.read', size: 'md', href: 'visitsToday',
      items: [
        { key: 'visitsToday', label: 'PM วันนี้ (รวมเลยนัด)', format: 'qty' },
        { key: 'visitsDueWeek', label: 'นัด 7 วันข้างหน้า', format: 'qty' },
        { key: 'overdueVisits', label: 'เลยนัด', format: 'qty', tone: 'stop' },
        { key: 'visitsDoneMonth', label: 'เข้าแล้วเดือนนี้', format: 'qty', tone: 'ok' },
      ] },
    { id: 'ma-pipeline', kind: 'pipeline', title: 'สัญญา MA ตามสถานะ', endpoint: '/summary', perm: 'contracts.contract.read', size: 'wide', href: 'contracts',
      rows: 'rows', field: 'status', stages: contractStatuses.slice(0, 3), title2: 'customer_name', subtitle: 'no', link: { screen: 'contract' } },
    { id: 'ma-trend', kind: 'trend', title: 'เข้า PM แล้ว 6 เดือน', endpoint: '/summary', perm: 'contracts.visit.read', size: 'sm', href: 'visits', rows: 'months', x: 'month', y: 'done', format: 'qty' },
  ],
});
