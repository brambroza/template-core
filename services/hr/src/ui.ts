import { defineUi, type Field } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const leaveStatuses = [
  { value: 'pending', label: 'รออนุมัติ' }, { value: 'approved', label: 'อนุมัติแล้ว' },
  { value: 'rejected', label: 'ไม่อนุมัติ' }, { value: 'cancelled', label: 'ยกเลิก' },
];
const empStatuses = [{ value: 'current', label: 'ทำงานอยู่ทั้งหมด' }, { value: 'active', label: 'พนักงานประจำ' }, { value: 'probation', label: 'ทดลองงาน' }, { value: 'resigned', label: 'ลาออกแล้ว' }];
const dayStatuses = [
  { value: 'present', label: 'มาตรงเวลา' }, { value: 'late', label: 'มาสาย' }, { value: 'leave', label: 'ลา' },
  { value: 'not_in', label: 'ยังไม่ลงเวลา' }, { value: 'absent', label: 'ขาดงาน' }, { value: 'off', label: 'วันหยุด' },
];

const leaveType: Field = {
  name: 'leaveTypeId', label: 'ประเภทการลา', type: 'lookup', required: true,
  lookup: { path: '/leave-types', label: ['name', 'code'], assign: { leaveTypeId: 'id' } },
};
const employee: Field = {
  name: 'employeeId', label: 'พนักงาน', type: 'lookup', required: true,
  lookup: { path: '/employees', query: { status: 'current' }, label: ['code', 'full_name', 'nickname'], assign: { employeeId: 'id' }, scanField: 'code' },
};
const department: Field = {
  name: 'departmentId', label: 'แผนก', type: 'lookup',
  lookup: { path: '/departments', label: ['code', 'name'], assign: { departmentId: 'id' } },
};
const position: Field = {
  name: 'positionId', label: 'ตำแหน่ง', type: 'lookup',
  lookup: { path: '/positions', label: ['code', 'name'], assign: { positionId: 'id' } },
};
const managerLookup = (name: string, label: string, help: string): Field => ({
  name, label, type: 'lookup', help,
  lookup: { path: '/employees', query: { status: 'current' }, label: ['code', 'full_name', 'nickname'], assign: { [name]: 'id' } },
});
const leaveFields: Field[] = [
  leaveType,
  { name: 'fromDate', label: 'ลาตั้งแต่วันที่', type: 'date', required: true },
  { name: 'toDate', label: 'ถึงวันที่ (เว้นว่าง = วันเดียว)', type: 'date' },
  { name: 'halfDay', label: 'ลาครึ่งวัน', type: 'boolean' },
  { name: 'reason', label: 'เหตุผล', type: 'textarea' },
];
const employeeFields: Field[] = [
  { name: 'code', label: 'รหัสพนักงาน', type: 'text', required: true },
  { name: 'prefix', label: 'คำนำหน้า', type: 'select', options: [{ value: 'นาย', label: 'นาย' }, { value: 'นาง', label: 'นาง' }, { value: 'นางสาว', label: 'นางสาว' }] },
  { name: 'firstName', label: 'ชื่อ', type: 'text', required: true },
  { name: 'lastName', label: 'นามสกุล', type: 'text' },
  { name: 'nickname', label: 'ชื่อเล่น', type: 'text' },
  department,
  position,
  { name: 'startDate', label: 'วันเริ่มงาน', type: 'date', required: true },
  { name: 'birthDate', label: 'วันเกิด', type: 'date' },
  { name: 'phone', label: 'โทรศัพท์', type: 'text' },
  { name: 'email', label: 'อีเมล', type: 'email' },
  { name: 'status', label: 'สถานะ', type: 'select', default: 'active', options: [{ value: 'active', label: 'พนักงานประจำ' }, { value: 'probation', label: 'ทดลองงาน' }] },
  managerLookup('managerId', 'หัวหน้างาน (ผู้อนุมัติใบลา)', 'เว้นว่าง = หัวหน้าแผนก — หัวหน้าต้องผูกบัญชีผู้ใช้จึงจะอนุมัติได้ ถ้าไม่มี ใบลาจะไปที่ฝ่ายบุคคล'),
  { name: 'userId', label: 'บัญชีผู้ใช้ (สำหรับลงเวลา/ลาเอง)', type: 'lookup', help: 'ผูกกับผู้ใช้ในระบบ เพื่อให้พนักงานลงเวลาและยื่นใบลาจากมือถือได้เอง',
    lookup: { module: 'identity', path: '/users', label: ['name', 'email'], assign: { userId: 'id' } } },
];
const adminTime: Field[] = [
  { name: 'date', label: 'วันที่', type: 'date', required: true },
  { name: 'time', label: 'เวลา (HH:MM)', type: 'text', required: true },
  { name: 'note', label: 'หมายเหตุ (เช่น ลืมสแกน)', type: 'text' },
];
const leaveColumns = [
  { key: 'no', label: 'เลขที่' }, { key: 'employee_name', label: 'พนักงาน' }, { key: 'leave_type_name', label: 'ประเภท' },
  { key: 'from_date', label: 'ตั้งแต่', format: 'date' as const }, { key: 'to_date', label: 'ถึง', format: 'date' as const },
  { key: 'days', label: 'วัน', format: 'qty' as const }, { key: 'status', label: 'สถานะ', format: 'status' as const },
];

export default defineUi({
  module: 'hr',
  label: 'บุคคลและลงเวลา',
  glyph: 'บค',
  icon: 'id-card',
  menu: [
    { label: 'ของฉัน (ลงเวลา/วันลา)', screen: 'me' },
    { label: 'ยื่นใบลา', screen: 'leaveNew' },
    { label: 'ใบลาของฉัน', screen: 'myLeaves' },
    { label: 'ใบลาลูกทีมรอฉันอนุมัติ', screen: 'teamLeaveInbox' },
    { label: 'ใบลารออนุมัติ (ฝ่ายบุคคล)', screen: 'leaveInbox' },
    { label: 'ใบลาทั้งหมด', screen: 'leaveList' },
    { label: 'เวลาทำงานวันนี้', screen: 'attendanceDaily' },
    { label: 'สรุปเวลาทำงานรายเดือน', screen: 'attendanceMonthly' },
    { label: 'พนักงาน', screen: 'employees' },
    { label: 'แผนก', screen: 'departments' },
    { label: 'ตำแหน่ง', screen: 'positions' },
    { label: 'ประเภทการลา', screen: 'leaveTypes' },
    { label: 'วันหยุดบริษัท', screen: 'holidays' },
    { label: 'เวลาเข้างาน', screen: 'schedule' },
  ],
  commands: [
    { id: 'leave', label: 'ยื่นใบลา', example: 'ลา ป่วย ไข้หวัด', keywords: ['ขอลา', 'ลา', 'ยื่นลา', 'leave'], screen: 'leaveNew', perm: 'hr.leave.request',
      arg: { lookup: { path: '/leave-types', label: ['name', 'code'], assign: { leaveTypeId: 'id' } } }, restField: 'reason' },
    { id: 'checkin', label: 'ลงเวลาเข้างาน', example: 'ลงเวลา', keywords: ['ลงเวลา', 'ลงเวลาเข้างาน', 'เข้างาน', 'สแกนเข้า', 'check in'], screen: 'checkIn', perm: 'hr.attendance.self' },
    { id: 'checkout', label: 'ลงเวลาออกงาน', example: 'ออกงาน', keywords: ['ออกงาน', 'ลงเวลาออกงาน', 'ลงเวลาออก', 'เลิกงาน', 'สแกนออก', 'check out'], screen: 'checkOut', perm: 'hr.attendance.self' },
    { id: 'employee', label: 'เปิดข้อมูลพนักงาน', example: 'พนักงาน EMP-001', keywords: ['พนักงาน', 'ประวัติพนักงาน', 'employee'], screen: 'employeeDetail', perm: 'hr.employee.read',
      arg: { lookup: { path: '/employees', label: ['code', 'full_name', 'nickname'], assign: { employeeId: 'id' } }, openId: 'id' } },
  ],
  search: [
    { id: 'employees', title: 'พนักงาน', endpoint: '/employees', label: ['code', 'full_name', 'nickname', 'department_name'], screen: 'employeeDetail', perm: 'hr.employee.read' },
    { id: 'leaves', title: 'ใบลา', endpoint: '/leave-requests', label: ['no', 'employee_name', 'leave_type_name'], screen: 'leaveDetail', perm: 'hr.employee.read' },
  ],
  screens: {
    /* ---------- self service ---------- */
    me: {
      kind: 'detail', title: 'ของฉัน — ลงเวลาและวันลา', endpoint: '/me', perm: 'hr.attendance.self', heading: 'employee.full_name', mobile: true,
      fields: [
        { key: 'message', label: 'หมายเหตุ' },
        { key: 'employee.code', label: 'รหัสพนักงาน' }, { key: 'employee.department_name', label: 'แผนก' }, { key: 'employee.position_name', label: 'ตำแหน่ง' },
        { key: 'schedule', label: 'เวลางาน' }, { key: 'approverName', label: 'ผู้อนุมัติใบลาของฉัน' },
        { key: 'teamPending', label: 'ใบลาลูกทีมรอฉันอนุมัติ', format: 'qty' },
        { key: 'today.check_in_at', label: 'เข้างานวันนี้', format: 'datetime' }, { key: 'today.late_minutes', label: 'สาย (นาที)', format: 'qty' },
        { key: 'today.check_out_at', label: 'ออกงานวันนี้', format: 'datetime' },
      ],
      lines: [
        { path: 'balance', label: 'วันลาคงเหลือปีนี้', columns: [
          { key: 'name', label: 'ประเภท' }, { key: 'quota', label: 'สิทธิ์ (วัน)', format: 'qty' }, { key: 'used', label: 'ใช้แล้ว', format: 'qty' },
          { key: 'pending', label: 'รออนุมัติ', format: 'qty' }, { key: 'remaining', label: 'คงเหลือ', format: 'qty' },
        ] },
        { path: 'leaves', label: 'ใบลาล่าสุด', columns: [
          { key: 'no', label: 'เลขที่' }, { key: 'leave_type_name', label: 'ประเภท' }, { key: 'from_date', label: 'ตั้งแต่', format: 'date' },
          { key: 'to_date', label: 'ถึง', format: 'date' }, { key: 'days', label: 'วัน', format: 'qty' }, { key: 'status', label: 'สถานะ', format: 'status' },
        ] },
      ],
      actions: [
        { id: 'checkIn', label: 'ลงเวลาเข้างาน', method: 'POST', endpoint: '/attendance/check-in', perm: 'hr.attendance.self', tone: 'primary', mobile: true,
          when: { field: 'attendanceState', in: ['none'] }, toast: 'message' },
        { id: 'checkOut', label: 'ลงเวลาออกงาน', method: 'POST', endpoint: '/attendance/check-out', perm: 'hr.attendance.self', tone: 'primary', mobile: true,
          when: { field: 'attendanceState', in: ['in'] }, toast: 'message', confirm: 'ยืนยันลงเวลาออกงาน?' },
      ],
    },
    checkIn: {
      kind: 'form', title: 'ลงเวลาเข้างาน', method: 'POST', endpoint: '/attendance/check-in', perm: 'hr.attendance.self', mobile: true,
      fields: [{ name: 'note', label: 'หมายเหตุ (ไม่บังคับ)', type: 'text', help: 'ระบบใช้เวลาของเซิร์ฟเวอร์ และคำนวณนาทีที่สายให้อัตโนมัติ' }],
      submitLabel: 'ลงเวลาเข้างาน', after: { screen: 'me' },
    },
    checkOut: {
      kind: 'form', title: 'ลงเวลาออกงาน', method: 'POST', endpoint: '/attendance/check-out', perm: 'hr.attendance.self', mobile: true,
      fields: [{ name: 'note', label: 'หมายเหตุ (ไม่บังคับ)', type: 'text' }],
      submitLabel: 'ลงเวลาออกงาน', after: { screen: 'me' },
    },
    leaveNew: {
      kind: 'form', title: 'ยื่นใบลา', method: 'POST', endpoint: '/leave-requests', perm: 'hr.leave.request', mobile: true,
      fields: leaveFields, submitLabel: 'ส่งใบลา', after: { screen: 'leaveDetail', idFrom: 'id' },
    },
    myLeaves: {
      kind: 'list', title: 'ใบลาของฉัน', endpoint: '/me/leave-requests', perm: 'hr.leave.request', mobile: true,
      filters: [{ name: 'status', label: 'สถานะ', type: 'select', options: leaveStatuses }],
      columns: leaveColumns.filter((c) => c.key !== 'employee_name'),
      create: 'leaveNew', createLabel: 'ยื่นใบลา', rowLink: { screen: 'leaveDetail' }, empty: 'ยังไม่มีใบลา',
      rowActions: [{ id: 'cancel', label: 'ยกเลิก', method: 'POST', endpoint: '/leave-requests/:id/cancel', perm: 'hr.leave.request', tone: 'danger',
        when: { field: 'status', in: ['pending'] }, confirm: 'ยกเลิกใบลานี้?', mobile: true }],
    },

    /* ---------- leave (HR / approvers) ---------- */
    teamLeaveInbox: {
      kind: 'list', title: 'ใบลาลูกทีมรอฉันอนุมัติ', endpoint: '/leave-requests/inbox', perm: 'hr.leave.request', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาชื่อ/เลขที่', type: 'text' }],
      columns: [...leaveColumns.filter((c) => c.key !== 'status'), { key: 'reason', label: 'เหตุผล' }],
      rowLink: { screen: 'leaveDetail' }, empty: 'ไม่มีใบลาของลูกทีมที่รอคุณอนุมัติ',
      rowActions: [
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/leave-requests/:id/approve', perm: 'hr.leave.request', tone: 'primary', mobile: true,
          when: { field: 'can_decide', in: [true] } },
        { id: 'reject', label: 'ไม่อนุมัติ', method: 'POST', endpoint: '/leave-requests/:id/reject', perm: 'hr.leave.request', tone: 'danger', mobile: true,
          when: { field: 'can_decide', in: [true] }, fields: [{ name: 'note', label: 'เหตุผลที่ไม่อนุมัติ', type: 'textarea', required: true }] },
      ],
    },
    leaveInbox: {
      kind: 'list', title: 'ใบลารออนุมัติ (ฝ่ายบุคคล)', endpoint: '/leave-requests/pending', perm: 'hr.leave.approve', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาชื่อ/เลขที่', type: 'text' }, department],
      columns: [...leaveColumns.filter((c) => c.key !== 'status'), { key: 'approver_label', label: 'ผู้อนุมัติ' }, { key: 'reason', label: 'เหตุผล' }],
      rowLink: { screen: 'leaveDetail' }, empty: 'ไม่มีใบลารออนุมัติ',
      rowActions: [
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/leave-requests/:id/approve', perm: 'hr.leave.approve', tone: 'primary', mobile: true,
          when: { field: 'can_decide', in: [true] } },
        { id: 'reject', label: 'ไม่อนุมัติ', method: 'POST', endpoint: '/leave-requests/:id/reject', perm: 'hr.leave.approve', tone: 'danger', mobile: true,
          when: { field: 'can_decide', in: [true] }, fields: [{ name: 'note', label: 'เหตุผลที่ไม่อนุมัติ', type: 'textarea', required: true }] },
      ],
    },
    leaveList: {
      kind: 'list', title: 'ใบลาทั้งหมด', endpoint: '/leave-requests', perm: 'hr.employee.read', mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่/ชื่อ/เหตุผล', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: leaveStatuses },
        department,
        { name: 'from', label: 'ตั้งแต่วันที่', type: 'date' },
        { name: 'to', label: 'ถึงวันที่', type: 'date' },
      ],
      columns: leaveColumns,
      create: 'leaveNewFor', createLabel: 'ยื่นลาแทนพนักงาน', rowLink: { screen: 'leaveDetail' }, empty: 'ยังไม่มีใบลา',
    },
    leaveNewFor: {
      kind: 'form', title: 'ยื่นลาแทนพนักงาน', method: 'POST', endpoint: '/leave-requests', perm: 'hr.leave.approve',
      fields: [employee, ...leaveFields], submitLabel: 'บันทึกใบลา', after: { screen: 'leaveDetail', idFrom: 'id' },
    },
    leaveDetail: {
      kind: 'detail', title: 'ใบลา', endpoint: '/leave-requests/:id', perm: 'hr.leave.request', heading: 'no', attachments: { entity: 'leave', label: 'ใบรับรองแพทย์ / เอกสารประกอบ' }, mobile: true, printable: true,
      flow: { field: 'status', steps: [{ value: 'pending', label: 'ยื่นใบลา' }, { value: 'approved', label: 'อนุมัติ' }],
        exits: [{ value: 'rejected', label: 'ไม่อนุมัติ' }, { value: 'cancelled', label: 'ยกเลิก' }] },
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'employee_code', label: 'รหัสพนักงาน' }, { key: 'employee_name', label: 'พนักงาน' },
        { key: 'department_name', label: 'แผนก' }, { key: 'leave_type_name', label: 'ประเภทการลา' },
        { key: 'from_date', label: 'ตั้งแต่วันที่', format: 'date' }, { key: 'to_date', label: 'ถึงวันที่', format: 'date' },
        { key: 'half_day', label: 'ครึ่งวัน', format: 'boolean' }, { key: 'days', label: 'จำนวนวันทำงานที่ลา', format: 'qty' },
        { key: 'reason', label: 'เหตุผล' }, { key: 'balance.remaining', label: 'คงเหลือหลังหักใบนี้ (วัน)', format: 'qty' },
        { key: 'approver_label', label: 'ผู้อนุมัติ' },
        { key: 'requested_by_name', label: 'ยื่นโดย' }, { key: 'created_at', label: 'ยื่นเมื่อ', format: 'datetime' },
        { key: 'decided_by_name', label: 'พิจารณาโดย' }, { key: 'decided_at', label: 'พิจารณาเมื่อ', format: 'datetime' },
        { key: 'decision_note', label: 'หมายเหตุผู้อนุมัติ' },
      ],
      actions: [
        { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/leave-requests/:id/approve', perm: 'hr.leave.request', tone: 'primary', mobile: true,
          when: { field: 'can_decide', in: [true] } },
        { id: 'reject', label: 'ไม่อนุมัติ', method: 'POST', endpoint: '/leave-requests/:id/reject', perm: 'hr.leave.request', tone: 'danger', mobile: true,
          when: { field: 'can_decide', in: [true] }, fields: [{ name: 'note', label: 'เหตุผลที่ไม่อนุมัติ', type: 'textarea', required: true }] },
        { id: 'cancel', label: 'ยกเลิกใบลา', method: 'POST', endpoint: '/leave-requests/:id/cancel', perm: 'hr.leave.request', tone: 'danger', mobile: true,
          when: { field: 'status', in: ['pending', 'approved'] }, confirm: 'ยกเลิกใบลานี้?' },
      ],
    },

    /* ---------- attendance ---------- */
    attendanceDaily: {
      kind: 'list', title: 'เวลาทำงานรายวัน', endpoint: '/attendance', perm: 'hr.attendance.read', mobile: true,
      filters: [
        { name: 'date', label: 'วันที่ (ว่าง = วันนี้)', type: 'date' },
        { name: 'status', label: 'สถานะ', type: 'select', options: dayStatuses },
        department,
        { name: 'q', label: 'ค้นหาพนักงาน', type: 'text' },
      ],
      columns: [
        { key: 'employee_code', label: 'รหัส' }, { key: 'employee_name', label: 'พนักงาน' }, { key: 'nickname', label: 'ชื่อเล่น' },
        { key: 'department_name', label: 'แผนก' }, { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'check_in_at', label: 'เข้า', format: 'datetime' }, { key: 'check_out_at', label: 'ออก', format: 'datetime' },
        { key: 'late_minutes', label: 'สาย (นาที)', format: 'qty' }, { key: 'leave_type', label: 'ลา' },
      ],
      rowLink: { screen: 'employeeDetail', idFrom: 'employee_id' }, empty: 'ยังไม่มีพนักงาน',
    },
    attendanceMonthly: {
      kind: 'list', title: 'สรุปเวลาทำงานรายเดือน', endpoint: '/attendance/monthly', rows: 'rows', perm: 'hr.attendance.read',
      filters: [{ name: 'month', label: 'เดือน (YYYY-MM)', type: 'text' }, department, { name: 'q', label: 'ค้นหาพนักงาน', type: 'text' }],
      columns: [
        { key: 'employee_code', label: 'รหัส' }, { key: 'employee_name', label: 'พนักงาน' }, { key: 'department_name', label: 'แผนก' },
        { key: 'work_days', label: 'วันทำงาน', format: 'qty' }, { key: 'present_days', label: 'มาทำงาน', format: 'qty' },
        { key: 'late_count', label: 'สาย (ครั้ง)', format: 'qty' }, { key: 'late_minutes', label: 'สาย (นาที)', format: 'qty' },
        { key: 'leave_days', label: 'ลา (วัน)', format: 'qty' }, { key: 'absent_days', label: 'ขาด (วัน)', format: 'qty' },
        { key: 'work_hours', label: 'ชั่วโมงทำงาน', format: 'qty' },
      ],
      rowLink: { screen: 'employeeDetail', idFrom: 'employee_id' }, empty: 'ไม่มีข้อมูลเดือนนี้',
    },

    /* ---------- employees ---------- */
    employees: {
      kind: 'list', title: 'พนักงาน', endpoint: '/employees', perm: 'hr.employee.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหารหัส/ชื่อ/ชื่อเล่น', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: empStatuses }, department, position],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'full_name', label: 'ชื่อ-สกุล' }, { key: 'nickname', label: 'ชื่อเล่น' },
        { key: 'department_name', label: 'แผนก' }, { key: 'position_name', label: 'ตำแหน่ง' }, { key: 'start_date', label: 'เริ่มงาน', format: 'date' },
        { key: 'status', label: 'สถานะ', format: 'status' },
      ],
      create: 'employeeNew', createLabel: 'เพิ่มพนักงาน', rowLink: { screen: 'employeeDetail' }, empty: 'ยังไม่มีพนักงาน',
    },
    employeeNew: {
      kind: 'form', title: 'เพิ่มพนักงาน', method: 'POST', endpoint: '/employees', perm: 'hr.employee.write',
      fields: employeeFields, submitLabel: 'บันทึกพนักงาน', after: { screen: 'employeeDetail', idFrom: 'id' },
    },
    employeeEdit: {
      kind: 'form', title: 'แก้ไขข้อมูลพนักงาน', method: 'PATCH', endpoint: '/employees/:id', load: '/employees/:id', perm: 'hr.employee.write',
      fields: employeeFields.map((f) => (f.name === 'status' ? { ...f, default: undefined } : f)), submitLabel: 'บันทึกการแก้ไข', after: { screen: 'employeeDetail', idFrom: 'id' },
    },
    employeeDetail: {
      kind: 'detail', title: 'ข้อมูลพนักงาน', endpoint: '/employees/:id', perm: 'hr.employee.read', heading: 'full_name', mobile: true, edit: 'employeeEdit', printable: true,
      fields: [
        { key: 'code', label: 'รหัสพนักงาน' }, { key: 'nickname', label: 'ชื่อเล่น' }, { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'department_name', label: 'แผนก' }, { key: 'position_name', label: 'ตำแหน่ง' },
        { key: 'manager_name', label: 'หัวหน้างาน' }, { key: 'approver_label', label: 'ผู้อนุมัติใบลา' },
        { key: 'start_date', label: 'วันเริ่มงาน', format: 'date' }, { key: 'birth_date', label: 'วันเกิด', format: 'date' },
        { key: 'phone', label: 'โทรศัพท์' }, { key: 'email', label: 'อีเมล' }, { key: 'resigned_on', label: 'วันที่ลาออก', format: 'date' },
      ],
      lines: [
        { path: 'balance', label: 'วันลาปีนี้', columns: [
          { key: 'name', label: 'ประเภท' }, { key: 'quota', label: 'สิทธิ์', format: 'qty' }, { key: 'used', label: 'ใช้แล้ว', format: 'qty' },
          { key: 'pending', label: 'รออนุมัติ', format: 'qty' }, { key: 'remaining', label: 'คงเหลือ', format: 'qty' },
        ] },
        { path: 'leaves', label: 'ใบลาล่าสุด', columns: leaveColumns.filter((c) => c.key !== 'employee_name') },
        { path: 'reports', label: 'ลูกทีม (หัวหน้าโดยตรง)', columns: [
          { key: 'code', label: 'รหัส' }, { key: 'full_name', label: 'ชื่อ-สกุล' }, { key: 'position_name', label: 'ตำแหน่ง' },
        ] },
        { path: 'attendance', label: 'ลงเวลาล่าสุด', columns: [
          { key: 'work_date', label: 'วันที่', format: 'date' }, { key: 'check_in_at', label: 'เข้า', format: 'datetime' },
          { key: 'check_out_at', label: 'ออก', format: 'datetime' }, { key: 'late_minutes', label: 'สาย (นาที)', format: 'qty' },
          { key: 'source', label: 'บันทึกโดย', format: 'label' }, { key: 'note', label: 'หมายเหตุ' },
        ] },
      ],
      actions: [
        { id: 'confirm', label: 'ผ่านทดลองงาน', method: 'POST', endpoint: '/employees/:id/confirm', perm: 'hr.employee.write', tone: 'primary',
          when: { field: 'status', in: ['probation'] }, confirm: 'ยืนยันบรรจุเป็นพนักงานประจำ?' },
        { id: 'checkIn', label: 'บันทึกเวลาเข้าแทน', method: 'POST', endpoint: '/employees/:id/check-in', perm: 'hr.attendance.manage',
          when: { field: 'status', in: ['active', 'probation'] }, fields: adminTime, toast: 'message' },
        { id: 'checkOut', label: 'บันทึกเวลาออกแทน', method: 'POST', endpoint: '/employees/:id/check-out', perm: 'hr.attendance.manage',
          when: { field: 'status', in: ['active', 'probation'] }, fields: adminTime, toast: 'message' },
        { id: 'resign', label: 'บันทึกลาออก', method: 'POST', endpoint: '/employees/:id/resign', perm: 'hr.employee.write', tone: 'danger',
          when: { field: 'status', in: ['active', 'probation'] },
          fields: [{ name: 'resignedOn', label: 'วันทำงานวันสุดท้าย', type: 'date', required: true }, { name: 'note', label: 'หมายเหตุ', type: 'text' }] },
      ],
    },

    /* ---------- organisation & setup ---------- */
    departments: {
      kind: 'list', title: 'แผนก', endpoint: '/departments', perm: 'hr.employee.read',
      filters: [{ name: 'q', label: 'ค้นหา', type: 'text' }],
      columns: [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อแผนก' }, { key: 'manager_name', label: 'หัวหน้าแผนก' }, { key: 'headcount', label: 'พนักงาน (คน)', format: 'qty' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' }],
      create: 'departmentNew', createLabel: 'เพิ่มแผนก', rowLink: { screen: 'departmentDetail' }, empty: 'ยังไม่มีแผนก',
    },
    departmentNew: {
      kind: 'form', title: 'เพิ่มแผนก', method: 'POST', endpoint: '/departments', perm: 'hr.employee.write',
      fields: [{ name: 'code', label: 'รหัส', type: 'text', required: true }, { name: 'name', label: 'ชื่อแผนก', type: 'text', required: true }, managerLookup('managerEmployeeId', 'หัวหน้าแผนก', 'เป็นผู้อนุมัติใบลาของพนักงานในแผนกที่ไม่ได้ระบุหัวหน้างาน')],
      submitLabel: 'บันทึกแผนก', after: { screen: 'departments' },
    },
    departmentEdit: {
      kind: 'form', title: 'แก้ไขแผนก', method: 'PATCH', endpoint: '/departments/:id', load: '/departments/:id', perm: 'hr.employee.write',
      fields: [{ name: 'code', label: 'รหัส', type: 'text', required: true }, { name: 'name', label: 'ชื่อแผนก', type: 'text', required: true }, managerLookup('managerEmployeeId', 'หัวหน้าแผนก', 'เป็นผู้อนุมัติใบลาของพนักงานในแผนกที่ไม่ได้ระบุหัวหน้างาน'), { name: 'active', label: 'ใช้งาน', type: 'boolean' }],
      submitLabel: 'บันทึกการแก้ไข', after: { screen: 'departmentDetail', idFrom: 'id' },
    },
    departmentDetail: {
      kind: 'detail', title: 'แผนก', endpoint: '/departments/:id', perm: 'hr.employee.read', heading: 'name', edit: 'departmentEdit',
      fields: [{ key: 'code', label: 'รหัส' }, { key: 'manager_name', label: 'หัวหน้าแผนก' }, { key: 'headcount', label: 'พนักงาน (คน)', format: 'qty' }],
      lines: [{ path: 'employees', label: 'พนักงานในแผนก', columns: [
        { key: 'code', label: 'รหัส' }, { key: 'full_name', label: 'ชื่อ-สกุล' }, { key: 'nickname', label: 'ชื่อเล่น' }, { key: 'position_name', label: 'ตำแหน่ง' }, { key: 'status', label: 'สถานะ', format: 'status' },
      ] }],
    },
    positions: {
      kind: 'list', title: 'ตำแหน่งงาน', endpoint: '/positions', perm: 'hr.employee.read',
      filters: [{ name: 'q', label: 'ค้นหา', type: 'text' }],
      columns: [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ตำแหน่ง' }, { key: 'headcount', label: 'พนักงาน (คน)', format: 'qty' }],
      create: 'positionNew', createLabel: 'เพิ่มตำแหน่ง', empty: 'ยังไม่มีตำแหน่ง',
    },
    positionNew: {
      kind: 'form', title: 'เพิ่มตำแหน่ง', method: 'POST', endpoint: '/positions', perm: 'hr.employee.write',
      fields: [{ name: 'code', label: 'รหัส', type: 'text', required: true }, { name: 'name', label: 'ชื่อตำแหน่ง', type: 'text', required: true }],
      submitLabel: 'บันทึกตำแหน่ง', after: { screen: 'positions' },
    },
    leaveTypes: {
      kind: 'list', title: 'ประเภทการลาและสิทธิ์ต่อปี', endpoint: '/leave-types', perm: 'hr.employee.read',
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ประเภท' }, { key: 'days_per_year', label: 'สิทธิ์ต่อปี (วัน, ว่าง = ไม่จำกัด)', format: 'qty' },
        { key: 'allow_half_day', label: 'ลาครึ่งวันได้', format: 'boolean' }, { key: 'unpaid', label: 'ไม่รับค่าจ้าง', format: 'boolean' },
        { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      create: 'leaveTypeNew', createLabel: 'เพิ่มประเภทการลา', rowLink: { screen: 'leaveTypeEdit' }, empty: 'ยังไม่มีประเภทการลา — กด "เพิ่มตามกฎหมายแรงงาน"',
      actions: [{ id: 'defaults', label: 'เพิ่มตามกฎหมายแรงงาน', method: 'POST', endpoint: '/leave-types/defaults', perm: 'hr.setup.write', toast: 'message',
        confirm: 'เพิ่มลาป่วย 30 วัน ลากิจ 3 วัน ลาพักร้อน 6 วัน ลาคลอด 98 วัน ลาบวช ลารับราชการทหาร และลาไม่รับค่าจ้าง?' }],
    },
    leaveTypeNew: {
      kind: 'form', title: 'เพิ่มประเภทการลา', method: 'POST', endpoint: '/leave-types', perm: 'hr.setup.write',
      fields: [
        { name: 'code', label: 'รหัส', type: 'text', required: true }, { name: 'name', label: 'ชื่อ', type: 'text', required: true },
        { name: 'daysPerYear', label: 'สิทธิ์ต่อปี (วัน) — เว้นว่าง = ไม่จำกัด', type: 'number', step: 0.5 },
        { name: 'allowHalfDay', label: 'ลาครึ่งวันได้', type: 'boolean', default: true },
        { name: 'unpaid', label: 'ลาไม่รับค่าจ้าง', type: 'boolean', default: false, help: 'วันลาที่อนุมัติแล้วจะถูกหักเงินเดือนในรอบเงินเดือนของเดือนนั้น' },
      ],
      submitLabel: 'บันทึก', after: { screen: 'leaveTypes' },
    },
    leaveTypeEdit: {
      kind: 'form', title: 'แก้ไขประเภทการลา', method: 'PATCH', endpoint: '/leave-types/:id', load: '/leave-types/:id', perm: 'hr.setup.write',
      fields: [
        { name: 'code', label: 'รหัส', type: 'text', required: true }, { name: 'name', label: 'ชื่อ', type: 'text', required: true },
        { name: 'daysPerYear', label: 'สิทธิ์ต่อปี (วัน)', type: 'number', step: 0.5 },
        { name: 'allowHalfDay', label: 'ลาครึ่งวันได้', type: 'boolean' },
        { name: 'unpaid', label: 'ลาไม่รับค่าจ้าง', type: 'boolean', help: 'วันลาที่อนุมัติแล้วจะถูกหักเงินเดือนในรอบเงินเดือนของเดือนนั้น' },
        { name: 'active', label: 'ใช้งาน', type: 'boolean' },
      ],
      submitLabel: 'บันทึกการแก้ไข', after: { screen: 'leaveTypes' },
    },
    holidays: {
      kind: 'list', title: 'วันหยุดบริษัท', endpoint: '/holidays', perm: 'hr.employee.read',
      filters: [{ name: 'year', label: 'ปี (ค.ศ. หรือ พ.ศ.)', type: 'number' }],
      columns: [{ key: 'date', label: 'วันที่', format: 'date' }, { key: 'name', label: 'วันหยุด' }],
      create: 'holidayNew', createLabel: 'เพิ่มวันหยุด', empty: 'ยังไม่มีวันหยุด',
      rowActions: [{ id: 'delete', label: 'ลบ', method: 'DELETE', endpoint: '/holidays/:id', perm: 'hr.setup.write', tone: 'danger', confirm: 'ลบวันหยุดนี้?' }],
    },
    holidayNew: {
      kind: 'form', title: 'เพิ่มวันหยุด', method: 'POST', endpoint: '/holidays', perm: 'hr.setup.write',
      fields: [{ name: 'date', label: 'วันที่', type: 'date', required: true }, { name: 'name', label: 'ชื่อวันหยุด', type: 'text', required: true }],
      submitLabel: 'บันทึกวันหยุด', after: { screen: 'holidays' },
    },
    schedule: {
      kind: 'form', title: 'เวลาเข้างานและวันทำงาน', method: 'PUT', endpoint: '/schedule', load: '/schedule', perm: 'hr.setup.write',
      fields: [
        { name: 'startTime', label: 'เวลาเข้างาน (HH:MM)', type: 'text', required: true, default: '08:00' },
        { name: 'endTime', label: 'เวลาเลิกงาน (HH:MM)', type: 'text', default: '17:00' },
        { name: 'graceMinutes', label: 'ผ่อนผันสาย (นาที)', type: 'number', default: 0, help: 'มาหลังเวลาเข้างานไม่เกินนี้ไม่นับสาย เกินแล้วนับนาทีสายจากเวลาเข้างาน' },
        { name: 'saturdayWorkday', label: 'ทำงานวันเสาร์', type: 'boolean' },
      ],
      submitLabel: 'บันทึกการตั้งค่า', after: { screen: 'attendanceDaily' },
    },
  },
  widgets: [
    { id: 'hr-kpi', kind: 'kpi', title: 'บุคคลวันนี้', endpoint: '/summary', perm: 'hr.employee.read', size: 'md', href: 'attendanceDaily',
      items: [
        { key: 'presentToday', label: 'มาทำงาน', format: 'qty', tone: 'ok' },
        { key: 'lateToday', label: 'มาสาย', format: 'qty', tone: 'warn' },
        { key: 'onLeaveToday', label: 'ลาวันนี้', format: 'qty' },
        { key: 'pendingLeave', label: 'ใบลารออนุมัติ', format: 'qty', tone: 'warn' },
        { key: 'headcount', label: 'พนักงานทั้งหมด', format: 'qty' },
      ] },
    { id: 'hr-leaves', kind: 'pipeline', title: 'ใบลา', endpoint: '/summary', perm: 'hr.employee.read', size: 'md', href: 'leaveInbox',
      rows: 'rows', field: 'status', stages: [{ value: 'pending', label: 'รออนุมัติ' }, { value: 'approved', label: 'อนุมัติแล้ว' }, { value: 'rejected', label: 'ไม่อนุมัติ' }],
      title2: 'title', subtitle: 'subtitle', link: { screen: 'leaveDetail' } },
    { id: 'hr-trend', kind: 'trend', title: 'วันลาที่อนุมัติ 6 เดือน', endpoint: '/summary', perm: 'hr.employee.read', size: 'md', href: 'attendanceMonthly',
      rows: 'months', x: 'month', y: 'leaveDays', format: 'qty' },
  ],
});
