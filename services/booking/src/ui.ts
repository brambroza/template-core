import { defineUi, type Field } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const kinds = [{ value: 'room', label: 'ห้องประชุม' }, { value: 'vehicle', label: 'รถ' }, { value: 'equipment', label: 'อุปกรณ์' }];
const statuses = [
  { value: 'pending', label: 'รออนุมัติ' }, { value: 'confirmed', label: 'ยืนยันแล้ว' }, { value: 'completed', label: 'ใช้งานเสร็จแล้ว' },
  { value: 'rejected', label: 'ไม่อนุมัติ' }, { value: 'cancelled', label: 'ยกเลิก' },
];

const resourceLookup = (kind?: string) => ({
  path: '/resources', ...(kind ? { query: { kind } } : {}), label: ['code', 'name', 'plate_no'], assign: { resourceId: 'id' }, scanField: 'code',
});
const resource: Field = { name: 'resourceId', label: 'ห้อง / รถ / อุปกรณ์', type: 'lookup', required: true, lookup: resourceLookup() };

const bookingFields: Field[] = [
  resource,
  { name: 'purpose', label: 'วัตถุประสงค์', type: 'text', required: true },
  { name: 'date', label: 'วันที่', type: 'date', required: true },
  { name: 'startTime', label: 'เวลาเริ่ม (HH:MM)', type: 'text', required: true, default: '09:00' },
  { name: 'endTime', label: 'เวลาสิ้นสุด (HH:MM)', type: 'text', required: true, default: '10:00' },
  { name: 'endDate', label: 'วันที่คืน (ถ้าใช้หลายวัน)', type: 'date' },
  { name: 'attendees', label: 'จำนวนผู้เข้าร่วม/ผู้โดยสาร', type: 'number' },
  { name: 'destination', label: 'ปลายทาง (สำหรับรถ)', type: 'text' },
  { name: 'requesterName', label: 'จองแทนผู้อื่น (ชื่อ)', type: 'text', help: 'เว้นว่าง = จองในชื่อของคุณ — การจองแทนผู้อื่นใช้ได้เฉพาะผู้ดูแลการจอง' },
  { name: 'requesterDepartment', label: 'แผนก', type: 'text' },
  { name: 'requesterPhone', label: 'เบอร์ติดต่อ', type: 'text' },
];

const resourceFields: Field[] = [
  { name: 'code', label: 'รหัส (พิมพ์บน QR หน้าห้อง/ในรถ)', type: 'text', required: true },
  { name: 'name', label: 'ชื่อ', type: 'text', required: true },
  { name: 'kind', label: 'ประเภท', type: 'select', required: true, default: 'room', options: kinds },
  { name: 'capacity', label: 'รองรับ (คน/ที่นั่ง)', type: 'number' },
  { name: 'location', label: 'ที่ตั้ง', type: 'text' },
  { name: 'plateNo', label: 'ทะเบียนรถ', type: 'text' },
  { name: 'requiresApproval', label: 'ต้องอนุมัติก่อนใช้', type: 'boolean' },
  { name: 'color', label: 'สี (#RRGGBB)', type: 'text' },
  { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
];

const bookingColumns = [
  { key: 'no', label: 'เลขที่' }, { key: 'resource_name', label: 'ห้อง/รถ' }, { key: 'purpose', label: 'วัตถุประสงค์' },
  { key: 'start_at', label: 'เริ่ม', format: 'datetime' as const }, { key: 'end_at', label: 'สิ้นสุด', format: 'datetime' as const },
  { key: 'requester_name', label: 'ผู้จอง' }, { key: 'status', label: 'สถานะ', format: 'status' as const },
];

export default defineUi({
  module: 'booking',
  label: 'จองห้องและรถ',
  glyph: 'จอ',
  icon: 'calendar',
  menu: [
    { label: 'ตารางวันนี้', screen: 'board' },
    { label: 'จองใหม่', screen: 'bookingNew' },
    { label: 'การจองของฉัน', screen: 'myBookings' },
    { label: 'รออนุมัติ', screen: 'approvals' },
    { label: 'การจองทั้งหมด', screen: 'bookingList' },
    { label: 'บันทึกการใช้รถ', screen: 'trips' },
    { label: 'ห้อง รถ อุปกรณ์', screen: 'resources' },
  ],
  commands: [
    { id: 'room', label: 'จองห้องประชุม', example: 'จองห้อง MR-1 ประชุมลูกค้า', keywords: ['จองห้อง', 'จองห้องประชุม', 'ห้องประชุม'], screen: 'bookingNew', perm: 'booking.book.create',
      arg: { lookup: resourceLookup('room') }, restField: 'purpose' },
    { id: 'car', label: 'จองรถ', example: 'จองรถ VAN-01 ส่งของลูกค้าบางนา', keywords: ['จองรถ', 'ขอใช้รถ', 'ใช้รถ'], screen: 'bookingNew', perm: 'booking.book.create',
      arg: { lookup: resourceLookup('vehicle') }, restField: 'purpose' },
    { id: 'equipment', label: 'จองอุปกรณ์', example: 'จองอุปกรณ์ PJ-01 อบรมพนักงาน', keywords: ['จองอุปกรณ์', 'ยืมอุปกรณ์'], screen: 'bookingNew', perm: 'booking.book.create',
      arg: { lookup: resourceLookup('equipment') }, restField: 'purpose' },
    { id: 'board', label: 'ตารางห้องและรถวันนี้', example: 'ตารางห้อง', keywords: ['ตารางห้อง', 'ห้องว่าง', 'รถว่าง', 'ตารางรถ'], screen: 'board', perm: 'booking.resource.read' },
  ],
  search: [
    { id: 'bookings', title: 'การจอง', endpoint: '/bookings', label: ['no', 'resource_name', 'purpose', 'requester_name'], screen: 'bookingDetail', perm: 'booking.resource.read' },
    { id: 'resources', title: 'ห้อง/รถ/อุปกรณ์', endpoint: '/resources', label: ['code', 'name', 'plate_no'], screen: 'resourceDetail', perm: 'booking.resource.read' },
  ],
  screens: {
    board: {
      kind: 'list', title: 'ตารางห้องและรถรายวัน', endpoint: '/availability', perm: 'booking.resource.read', mobile: true,
      filters: [
        { name: 'date', label: 'วันที่ (ว่าง = วันนี้)', type: 'date' },
        { name: 'kind', label: 'ประเภท', type: 'select', options: kinds },
        { name: 'q', label: 'ค้นหา', type: 'text' },
      ],
      columns: [
        { key: 'name', label: 'ห้อง/รถ' }, { key: 'kind_th', label: 'ประเภท' }, { key: 'slots', label: 'ช่วงที่ถูกจอง' },
        { key: 'booked_hours', label: 'ชั่วโมงที่จอง', format: 'qty' }, { key: 'busy_now', label: 'ใช้งานอยู่ตอนนี้', format: 'boolean' },
        { key: 'location', label: 'ที่ตั้ง' }, { key: 'capacity', label: 'รองรับ', format: 'qty' },
      ],
      create: 'bookingNew', createLabel: 'จองใหม่', rowLink: { screen: 'resourceDetail' }, empty: 'ยังไม่มีห้องหรือรถ — เพิ่มที่เมนู "ห้อง รถ อุปกรณ์"',
    },
    bookingNew: {
      kind: 'form', title: 'จองห้อง / รถ / อุปกรณ์', method: 'POST', endpoint: '/bookings', perm: 'booking.book.create', mobile: true,
      fields: bookingFields, submitLabel: 'จอง', after: { screen: 'bookingDetail', idFrom: 'id' },
    },
    myBookings: {
      kind: 'list', title: 'การจองของฉัน', endpoint: '/bookings/mine', perm: 'booking.book.create', mobile: true,
      filters: [{ name: 'status', label: 'สถานะ', type: 'select', options: statuses }],
      columns: bookingColumns.filter((c) => c.key !== 'requester_name'),
      create: 'bookingNew', createLabel: 'จองใหม่', rowLink: { screen: 'bookingDetail' }, empty: 'ยังไม่มีการจอง',
      rowActions: [{ id: 'cancel', label: 'ยกเลิก', method: 'POST', endpoint: '/bookings/:id/cancel', perm: 'booking.book.create', tone: 'danger',
        when: { field: 'status', in: ['pending', 'confirmed'] }, confirm: 'ยกเลิกการจองนี้?', mobile: true }],
    },
    approvals: {
      kind: 'list', title: 'การจองรออนุมัติ', endpoint: '/bookings/pending', perm: 'booking.book.approve', mobile: true,
      filters: [{ name: 'kind', label: 'ประเภท', type: 'select', options: kinds }],
      columns: [...bookingColumns.filter((c) => c.key !== 'status'), { key: 'attendees', label: 'คน', format: 'qty' }, { key: 'destination', label: 'ปลายทาง' }],
      rowLink: { screen: 'bookingDetail' }, empty: 'ไม่มีการจองรออนุมัติ',
      rowActions: [
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/bookings/:id/approve', perm: 'booking.book.approve', tone: 'primary', mobile: true },
        { id: 'reject', label: 'ไม่อนุมัติ', method: 'POST', endpoint: '/bookings/:id/reject', perm: 'booking.book.approve', tone: 'danger', mobile: true,
          fields: [{ name: 'note', label: 'เหตุผล', type: 'textarea', required: true }] },
      ],
    },
    bookingList: {
      kind: 'list', title: 'การจองทั้งหมด', endpoint: '/bookings', perm: 'booking.resource.read',
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่/ผู้จอง/ห้อง', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: statuses },
        { name: 'kind', label: 'ประเภท', type: 'select', options: kinds },
        { ...resource, required: false },
        { name: 'from', label: 'ตั้งแต่วันที่', type: 'date' },
        { name: 'to', label: 'ถึงวันที่', type: 'date' },
      ],
      columns: bookingColumns,
      create: 'bookingNew', createLabel: 'จองใหม่', rowLink: { screen: 'bookingDetail' }, empty: 'ไม่พบการจอง',
    },
    bookingDetail: {
      kind: 'detail', title: 'การจอง', endpoint: '/bookings/:id', perm: 'booking.resource.read', heading: 'no', mobile: true, printable: true,
      flow: { field: 'status', steps: [{ value: 'pending', label: 'รออนุมัติ' }, { value: 'confirmed', label: 'ยืนยัน' }, { value: 'completed', label: 'ใช้งานเสร็จ' }],
        exits: [{ value: 'rejected', label: 'ไม่อนุมัติ' }, { value: 'cancelled', label: 'ยกเลิก' }] },
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'resource_name', label: 'ห้อง/รถ/อุปกรณ์' }, { key: 'resource_kind_th', label: 'ประเภท' },
        { key: 'plate_no', label: 'ทะเบียน' }, { key: 'location', label: 'ที่ตั้ง' }, { key: 'purpose', label: 'วัตถุประสงค์' },
        { key: 'start_at', label: 'เริ่ม', format: 'datetime' }, { key: 'end_at', label: 'สิ้นสุด', format: 'datetime' }, { key: 'hours', label: 'ชั่วโมง', format: 'qty' },
        { key: 'attendees', label: 'ผู้เข้าร่วม/ผู้โดยสาร', format: 'qty' }, { key: 'destination', label: 'ปลายทาง' },
        { key: 'requester_name', label: 'ผู้จอง' }, { key: 'requester_department', label: 'แผนก' }, { key: 'requester_phone', label: 'เบอร์ติดต่อ' },
        { key: 'approved_by_name', label: 'ผู้อนุมัติ' }, { key: 'decision_note', label: 'หมายเหตุผู้อนุมัติ' },
        { key: 'cancelled_by_name', label: 'ยกเลิกโดย' }, { key: 'cancel_reason', label: 'เหตุผลที่ยกเลิก' },
        { key: 'mileage_start', label: 'เลขไมล์ก่อนใช้', format: 'qty' }, { key: 'mileage_end', label: 'เลขไมล์หลังใช้', format: 'qty' },
        { key: 'distance_km', label: 'ระยะทาง (กม.)', format: 'qty' }, { key: 'fuel_cost', label: 'ค่าน้ำมัน', format: 'money' },
        { key: 'completion_note', label: 'บันทึกหลังใช้งาน' },
      ],
      actions: [
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/bookings/:id/approve', perm: 'booking.book.approve', tone: 'primary', mobile: true,
          when: { field: 'status', in: ['pending'] } },
        { id: 'reject', label: 'ไม่อนุมัติ', method: 'POST', endpoint: '/bookings/:id/reject', perm: 'booking.book.approve', tone: 'danger', mobile: true,
          when: { field: 'status', in: ['pending'] }, fields: [{ name: 'note', label: 'เหตุผล', type: 'textarea', required: true }] },
        { id: 'completeTrip', label: 'คืนรถ / บันทึกเลขไมล์', method: 'POST', endpoint: '/bookings/:id/complete', perm: 'booking.book.create', tone: 'primary', mobile: true,
          when: { field: 'complete_mode', in: ['vehicle'] },
          fields: [
            { name: 'mileageStart', label: 'เลขไมล์ก่อนใช้ (ว่าง = ต่อจากเที่ยวก่อน)', type: 'number', step: 0.1 },
            { name: 'mileageEnd', label: 'เลขไมล์หลังใช้', type: 'number', step: 0.1, required: true },
            { name: 'fuelCost', label: 'ค่าน้ำมัน (บาท)', type: 'number', step: 0.01 },
            { name: 'note', label: 'บันทึก', type: 'text' },
          ] },
        { id: 'complete', label: 'ใช้งานเสร็จ', method: 'POST', endpoint: '/bookings/:id/complete', perm: 'booking.book.create', mobile: true,
          when: { field: 'complete_mode', in: ['other'] }, confirm: 'บันทึกว่าใช้งานเสร็จแล้ว?' },
        { id: 'cancel', label: 'ยกเลิกการจอง', method: 'POST', endpoint: '/bookings/:id/cancel', perm: 'booking.book.create', tone: 'danger', mobile: true,
          when: { field: 'status', in: ['pending', 'confirmed'] }, fields: [{ name: 'reason', label: 'เหตุผล', type: 'text' }] },
      ],
    },
    trips: {
      kind: 'list', title: 'บันทึกการใช้รถรายเดือน', endpoint: '/trips', rows: 'rows', perm: 'booking.resource.read',
      filters: [{ name: 'month', label: 'เดือน (YYYY-MM)', type: 'text' }, { ...resource, label: 'รถ', required: false, lookup: resourceLookup('vehicle') }, { name: 'q', label: 'ค้นหา', type: 'text' }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'resource_name', label: 'รถ' }, { key: 'plate_no', label: 'ทะเบียน' }, { key: 'booking_date', label: 'วันที่', format: 'date' },
        { key: 'requester_name', label: 'ผู้ใช้รถ' }, { key: 'destination', label: 'ปลายทาง' }, { key: 'mileage_start', label: 'ไมล์เริ่ม', format: 'qty' },
        { key: 'mileage_end', label: 'ไมล์จบ', format: 'qty' }, { key: 'distance_km', label: 'ระยะทาง (กม.)', format: 'qty' }, { key: 'fuel_cost', label: 'ค่าน้ำมัน', format: 'money' },
      ],
      rowLink: { screen: 'bookingDetail' }, empty: 'ยังไม่มีการใช้รถเดือนนี้',
    },
    resources: {
      kind: 'list', title: 'ห้อง รถ และอุปกรณ์', endpoint: '/resources', perm: 'booking.resource.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหารหัส/ชื่อ/ทะเบียน', type: 'text' }, { name: 'kind', label: 'ประเภท', type: 'select', options: kinds },
        { name: 'all', label: 'รวมที่ปิดใช้งาน', type: 'select', options: [{ value: 'true', label: 'แสดงทั้งหมด' }] }],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }, { key: 'kind_th', label: 'ประเภท' }, { key: 'capacity', label: 'รองรับ', format: 'qty' },
        { key: 'plate_no', label: 'ทะเบียน' }, { key: 'location', label: 'ที่ตั้ง' }, { key: 'requires_approval', label: 'ต้องอนุมัติ', format: 'boolean' },
        { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      create: 'resourceNew', createLabel: 'เพิ่มห้อง/รถ/อุปกรณ์', rowLink: { screen: 'resourceDetail' }, empty: 'ยังไม่มีห้องหรือรถ',
    },
    resourceNew: {
      kind: 'form', title: 'เพิ่มห้อง / รถ / อุปกรณ์', method: 'POST', endpoint: '/resources', perm: 'booking.resource.write',
      fields: resourceFields, submitLabel: 'บันทึก', after: { screen: 'resourceDetail', idFrom: 'id' },
    },
    resourceEdit: {
      kind: 'form', title: 'แก้ไขห้อง / รถ / อุปกรณ์', method: 'PATCH', endpoint: '/resources/:id', load: '/resources/:id', perm: 'booking.resource.write',
      fields: [...resourceFields.map((f) => (f.name === 'kind' ? { ...f, default: undefined } : f)), { name: 'active', label: 'เปิดให้จอง', type: 'boolean' }],
      submitLabel: 'บันทึกการแก้ไข', after: { screen: 'resourceDetail', idFrom: 'id' },
    },
    resourceDetail: {
      kind: 'detail', title: 'ห้อง / รถ / อุปกรณ์', endpoint: '/resources/:id', perm: 'booking.resource.read', heading: 'name', mobile: true, edit: 'resourceEdit', printable: true,
      fields: [
        { key: 'kind_th', label: 'ประเภท' }, { key: 'capacity', label: 'รองรับ', format: 'qty' }, { key: 'location', label: 'ที่ตั้ง' },
        { key: 'plate_no', label: 'ทะเบียน' }, { key: 'requires_approval', label: 'ต้องอนุมัติ', format: 'boolean' }, { key: 'active', label: 'เปิดให้จอง', format: 'boolean' },
        { key: 'tripsMonth', label: 'เที่ยวเดือนนี้', format: 'qty' }, { key: 'kmMonth', label: 'ระยะทางเดือนนี้ (กม.)', format: 'qty' },
        { key: 'fuelMonth', label: 'ค่าน้ำมันเดือนนี้', format: 'money' }, { key: 'lastMileage', label: 'เลขไมล์ล่าสุด', format: 'qty' },
        { key: 'code', label: 'รหัส / QR ติดหน้าห้องหรือในรถ', format: 'qr' }, { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [
        { path: 'upcoming', label: 'การจองที่จะถึง', columns: bookingColumns.filter((c) => c.key !== 'resource_name') },
        { path: 'recent', label: 'ใช้งานล่าสุด', columns: [
          { key: 'no', label: 'เลขที่' }, { key: 'booking_date', label: 'วันที่', format: 'date' }, { key: 'time_range', label: 'เวลา' }, { key: 'purpose', label: 'วัตถุประสงค์' },
          { key: 'requester_name', label: 'ผู้ใช้' }, { key: 'distance_km', label: 'ระยะทาง (กม.)', format: 'qty' }, { key: 'fuel_cost', label: 'ค่าน้ำมัน', format: 'money' },
        ] },
      ],
    },
  },
  widgets: [
    { id: 'bk-kpi', kind: 'kpi', title: 'จองห้องและรถ', endpoint: '/summary', perm: 'booking.resource.read', size: 'md', href: 'board',
      items: [
        { key: 'bookingsToday', label: 'การจองวันนี้', format: 'qty' },
        { key: 'pendingApproval', label: 'รออนุมัติ', format: 'qty', tone: 'warn' },
        { key: 'utilization', label: 'อัตราใช้งานสัปดาห์นี้', format: 'percent', tone: 'ok' },
        { key: 'kmMonth', label: 'ระยะทางรถเดือนนี้ (กม.)', format: 'qty' },
      ] },
    { id: 'bk-next', kind: 'pipeline', title: 'การจองที่จะถึง', endpoint: '/summary', perm: 'booking.resource.read', size: 'md', href: 'approvals',
      rows: 'rows', field: 'status', stages: [{ value: 'pending', label: 'รออนุมัติ' }, { value: 'confirmed', label: 'ยืนยันแล้ว' }],
      title2: 'title', subtitle: 'subtitle', link: { screen: 'bookingDetail' } },
    { id: 'bk-trend', kind: 'trend', title: 'ชั่วโมงที่จอง 6 เดือน', endpoint: '/summary', perm: 'booking.resource.read', size: 'md', href: 'bookingList',
      rows: 'months', x: 'month', y: 'hours', format: 'qty' },
  ],
});
