import { defineUi, type Action, type Field } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const projectStatuses = [
  { value: 'planning', label: 'วางแผน' }, { value: 'active', label: 'กำลังดำเนินการ' }, { value: 'on_hold', label: 'พักไว้' },
  { value: 'done', label: 'เสร็จแล้ว' }, { value: 'cancelled', label: 'ยกเลิก' },
];
const taskStatuses = [{ value: 'todo', label: 'รอทำ' }, { value: 'doing', label: 'กำลังทำ' }, { value: 'review', label: 'รอตรวจ' }, { value: 'done', label: 'เสร็จ' }];
const priorities = [{ value: 'low', label: 'ต่ำ' }, { value: 'normal', label: 'ปกติ' }, { value: 'high', label: 'สูง' }, { value: 'urgent', label: 'ด่วน' }];
const weekStatuses = [{ value: 'draft', label: 'ร่าง' }, { value: 'submitted', label: 'ส่งแล้ว รออนุมัติ' }, { value: 'approved', label: 'อนุมัติแล้ว' }];
const yesNo = [{ value: 'true', label: 'ใช่' }, { value: 'false', label: 'ไม่ใช่' }];

const projectLookup: Field = {
  name: 'projectId', label: 'โครงการ', type: 'lookup', required: true,
  lookup: { path: '/projects', query: { open: 'true' }, label: ['no', 'name'], assign: { projectId: 'id' } },
};
const userLookup = (name: string, label: string, nameField: string, required = false): Field => ({
  name, label, type: 'lookup', required,
  lookup: { module: 'identity', path: '/users', label: ['name', 'email'], assign: { [name]: 'id', [nameField]: 'name' } },
});

const taskActions = (mobile: boolean): Action[] => [
  { id: 'start', label: 'เริ่มทำ', method: 'POST', endpoint: '/tasks/:id/start', perm: 'projects.task.write', when: { field: 'status', in: ['todo'] }, tone: 'primary', mobile },
  { id: 'back', label: 'ส่งกลับไปแก้', method: 'POST', endpoint: '/tasks/:id/start', perm: 'projects.task.write', when: { field: 'status', in: ['review'] }, mobile },
  { id: 'review', label: 'ส่งตรวจ', method: 'POST', endpoint: '/tasks/:id/review', perm: 'projects.task.write', when: { field: 'status', in: ['doing'] }, tone: 'primary', mobile },
  { id: 'done', label: 'เสร็จแล้ว', method: 'POST', endpoint: '/tasks/:id/done', perm: 'projects.task.write', when: { field: 'status', in: ['todo', 'doing', 'review'] }, mobile },
];
const reopenTask: Action = { id: 'reopen', label: 'เปิดงานใหม่', method: 'POST', endpoint: '/tasks/:id/reopen', perm: 'projects.task.write', when: { field: 'status', in: ['done'] }, confirm: 'งานจะกลับไปสถานะรอทำ' };

const approveWeek: Action = { id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/timesheet-weeks/:id/approve', perm: 'projects.timesheet.approve', when: { field: 'status', in: ['submitted'] }, tone: 'primary', mobile: true };
const rejectWeek: Action = {
  id: 'reject', label: 'ตีกลับให้แก้', method: 'POST', endpoint: '/timesheet-weeks/:id/reject', perm: 'projects.timesheet.approve', when: { field: 'status', in: ['submitted'] }, tone: 'danger',
  fields: [{ name: 'reason', label: 'เหตุผล', type: 'textarea', required: true }],
};

const entryColumns = [
  { key: 'work_date', label: 'วันที่', format: 'date' as const }, { key: 'project_no', label: 'โครงการ' }, { key: 'project_name', label: 'ชื่อโครงการ' },
  { key: 'task_title', label: 'งาน' }, { key: 'hours', label: 'ชั่วโมง', format: 'qty' as const }, { key: 'note', label: 'หมายเหตุ' },
];

export default defineUi({
  module: 'projects',
  label: 'โครงการ',
  glyph: 'จ',
  icon: 'kanban',
  menu: [
    { label: 'โครงการ', screen: 'projectList' },
    { label: 'งานของฉัน', screen: 'myTasks' },
    { label: 'งานทั้งหมด', screen: 'taskList' },
    { label: 'งวดงาน', screen: 'milestoneList' },
    { label: 'ลงชั่วโมง (สัปดาห์นี้)', screen: 'myWeek' },
    { label: 'อนุมัติชั่วโมงทำงาน', screen: 'weekApprovals' },
    { label: 'ชั่วโมงทำงานทั้งหมด', screen: 'entryList' },
  ],
  commands: [
    { id: 'task', label: 'สร้างงานในโครงการ', example: 'งาน PJ-2569-0001 ติดตั้งเครื่องที่หน้างาน', keywords: ['งาน', 'สร้างงาน', 'task'], screen: 'taskNew', perm: 'projects.task.write',
      arg: { lookup: { path: '/projects', query: { open: 'true' }, label: ['no', 'name'], assign: { projectId: 'id' } } }, restField: 'title' },
    { id: 'log', label: 'ลงชั่วโมงทำงาน', example: 'ลงชั่วโมง PJ-2569-0001 ประชุมลูกค้า', keywords: ['ลงชั่วโมง', 'ลงชั่วโมงทำงาน', 'timesheet'], screen: 'timesheetNew', perm: 'projects.timesheet.log',
      arg: { lookup: { path: '/projects', query: { open: 'true' }, label: ['no', 'name'], assign: { projectId: 'id' } } }, restField: 'note' },
    { id: 'mine', label: 'งานของฉัน', example: 'งานของฉัน', keywords: ['งานของฉัน', 'my tasks'], screen: 'myTasks', perm: 'projects.project.read' },
    { id: 'approve', label: 'ชั่วโมงทำงานรออนุมัติ', example: 'อนุมัติชั่วโมง', keywords: ['อนุมัติชั่วโมง', 'อนุมัติ timesheet'], screen: 'weekApprovals', perm: 'projects.timesheet.approve' },
  ],
  search: [
    { id: 'projects', title: 'โครงการ', endpoint: '/projects', label: ['no', 'name', 'customer_name'], screen: 'projectDetail', perm: 'projects.project.read' },
    { id: 'tasks', title: 'งาน', endpoint: '/tasks', label: ['title', 'project_no', 'assignee_name'], screen: 'taskDetail', perm: 'projects.project.read' },
  ],
  screens: {
    /* ---------- projects ---------- */
    projectList: {
      kind: 'list', title: 'โครงการ', endpoint: '/projects', perm: 'projects.project.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาเลขที่ ชื่อ หรือลูกค้า', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: projectStatuses }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'name', label: 'โครงการ' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'manager_name', label: 'ผู้จัดการ' },
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'progress', label: 'คืบหน้า', format: 'percent' },
        { key: 'hours_logged', label: 'ชั่วโมงจริง', format: 'qty' }, { key: 'cost', label: 'ต้นทุนแรงงาน', format: 'money' },
        { key: 'budget', label: 'งบประมาณ', format: 'money' }, { key: 'budget_at_risk', label: 'ใกล้เกินงบ', format: 'boolean' },
      ],
      create: 'projectNew', createLabel: 'สร้างโครงการ', rowLink: { screen: 'projectDetail' }, empty: 'ยังไม่มีโครงการ',
    },
    projectNew: {
      kind: 'form', title: 'สร้างโครงการ', method: 'POST', endpoint: '/projects', perm: 'projects.project.write',
      fields: [
        { name: 'name', label: 'ชื่อโครงการ', type: 'text', required: true },
        { name: 'customerId', label: 'ลูกค้า', type: 'lookup',
          lookup: { module: 'master-data', path: '/partners', query: { kind: 'customer' }, label: ['code', 'name'], assign: { customerId: 'id', customerName: 'name' } } },
        userLookup('managerId', 'ผู้จัดการโครงการ', 'managerName'),
        { name: 'budget', label: 'งบประมาณ (บาท)', type: 'number', step: 0.01, default: 0 },
        { name: 'startDate', label: 'วันเริ่ม', type: 'date' },
        { name: 'endDate', label: 'วันสิ้นสุด', type: 'date' },
        { name: 'description', label: 'รายละเอียด / ขอบเขตงาน', type: 'textarea' },
      ],
      submitLabel: 'สร้างโครงการ', after: { screen: 'projectDetail', idFrom: 'id' },
    },
    projectEdit: {
      kind: 'form', title: 'แก้ไขโครงการ', method: 'PATCH', endpoint: '/projects/:id', load: '/projects/:id', perm: 'projects.project.write',
      fields: [
        { name: 'name', label: 'ชื่อโครงการ', type: 'text', required: true },
        { name: 'customerName', label: 'ชื่อลูกค้า', type: 'text' },
        { name: 'budget', label: 'งบประมาณ (บาท)', type: 'number', step: 0.01 },
        { name: 'startDate', label: 'วันเริ่ม', type: 'date' },
        { name: 'endDate', label: 'วันสิ้นสุด', type: 'date' },
        { name: 'description', label: 'รายละเอียด / ขอบเขตงาน', type: 'textarea' },
      ],
      submitLabel: 'บันทึกการแก้ไข', after: { screen: 'projectDetail', idFrom: 'id' },
    },
    projectDetail: {
      kind: 'detail', title: 'โครงการ', endpoint: '/projects/:id', perm: 'projects.project.read', heading: 'no', attachments: { entity: 'project' }, mobile: true, printable: true, edit: 'projectEdit',
      flow: {
        field: 'status',
        steps: [{ value: 'planning', label: 'วางแผน' }, { value: 'active', label: 'ดำเนินการ' }, { value: 'done', label: 'เสร็จ' }],
        exits: [{ value: 'on_hold', label: 'พักไว้' }, { value: 'cancelled', label: 'ยกเลิก' }],
      },
      fields: [
        { key: 'name', label: 'โครงการ' }, { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'customer_name', label: 'ลูกค้า' }, { key: 'manager_name', label: 'ผู้จัดการโครงการ' },
        { key: 'start_date', label: 'วันเริ่ม', format: 'date' }, { key: 'end_date', label: 'วันสิ้นสุด', format: 'date' },
        { key: 'progress', label: 'ความคืบหน้า', format: 'percent' },
        { key: 'tasks_done', label: 'งานเสร็จ', format: 'qty' }, { key: 'task_count', label: 'งานทั้งหมด', format: 'qty' }, { key: 'overdue_tasks', label: 'งานเลยกำหนด', format: 'qty' },
        { key: 'hours_estimated', label: 'ชั่วโมงประมาณการ', format: 'qty' }, { key: 'hours_logged', label: 'ชั่วโมงที่ลงจริง', format: 'qty' },
        { key: 'budget', label: 'งบประมาณ', format: 'money' }, { key: 'cost', label: 'ต้นทุนแรงงาน (ชม. × อัตรา)', format: 'money' },
        { key: 'budget_used_pct', label: 'ใช้งบไปแล้ว', format: 'percent' }, { key: 'budget_left', label: 'งบคงเหลือ', format: 'money' },
        { key: 'budget_at_risk', label: 'ใกล้เกินงบ (>90%)', format: 'boolean' }, { key: 'description', label: 'รายละเอียด' },
      ],
      lines: [
        { path: 'milestones', label: 'งวดงาน', columns: [
          { key: 'name', label: 'งวดงาน' }, { key: 'due_date', label: 'กำหนด', format: 'date' }, { key: 'done', label: 'เสร็จ', format: 'boolean' },
          { key: 'overdue', label: 'เลยกำหนด', format: 'boolean' }, { key: 'tasks_done', label: 'งานเสร็จ', format: 'qty' }, { key: 'task_count', label: 'งานทั้งหมด', format: 'qty' },
        ] },
        { path: 'tasks', label: 'งาน', columns: [
          { key: 'title', label: 'งาน' }, { key: 'assignee_name', label: 'ผู้รับผิดชอบ' }, { key: 'status', label: 'สถานะ', format: 'status' },
          { key: 'priority', label: 'ความสำคัญ', format: 'label' }, { key: 'due_date', label: 'กำหนดเสร็จ', format: 'date' }, { key: 'overdue', label: 'เลยกำหนด', format: 'boolean' },
          { key: 'estimate_hours', label: 'ประมาณ (ชม.)', format: 'qty' }, { key: 'hours_logged', label: 'จริง (ชม.)', format: 'qty' },
        ] },
        { path: 'members', label: 'สมาชิก', columns: [
          { key: 'user_name', label: 'ชื่อ' }, { key: 'role', label: 'บทบาท' }, { key: 'hourly_rate', label: 'อัตรา/ชม.', format: 'money' },
          { key: 'hours_logged', label: 'ชั่วโมง', format: 'qty' }, { key: 'cost', label: 'ต้นทุน', format: 'money' },
        ] },
      ],
      actions: [
        { id: 'activate', label: 'เริ่มโครงการ', method: 'POST', endpoint: '/projects/:id/activate', perm: 'projects.project.write', when: { field: 'status', in: ['planning', 'on_hold'] }, tone: 'primary' },
        { id: 'hold', label: 'พักโครงการ', method: 'POST', endpoint: '/projects/:id/hold', perm: 'projects.project.write', when: { field: 'status', in: ['active'] } },
        { id: 'complete', label: 'ปิดโครงการ (เสร็จ)', method: 'POST', endpoint: '/projects/:id/complete', perm: 'projects.project.write', when: { field: 'status', in: ['active', 'on_hold'] }, confirm: 'ปิดโครงการแล้วจะเพิ่มงานใหม่ไม่ได้', tone: 'primary' },
        { id: 'reopen', label: 'เปิดโครงการอีกครั้ง', method: 'POST', endpoint: '/projects/:id/reopen', perm: 'projects.project.write', when: { field: 'status', in: ['done'] } },
        { id: 'member', label: 'เพิ่ม/แก้สมาชิก', method: 'POST', endpoint: '/projects/:id/members', perm: 'projects.project.write', when: { field: 'status', in: ['planning', 'active', 'on_hold'] },
          fields: [
            userLookup('userId', 'พนักงาน', 'userName', true),
            { name: 'role', label: 'บทบาท', type: 'text' },
            { name: 'hourlyRate', label: 'ต้นทุนต่อชั่วโมง (บาท)', type: 'number', step: 0.01, default: 0, help: 'ใช้คำนวณต้นทุนแรงงานเทียบงบประมาณ' },
          ] },
        { id: 'milestone', label: 'เพิ่มงวดงาน', method: 'POST', endpoint: '/projects/:id/milestones', perm: 'projects.project.write', when: { field: 'status', in: ['planning', 'active', 'on_hold'] },
          fields: [{ name: 'name', label: 'ชื่องวดงาน', type: 'text', required: true }, { name: 'dueDate', label: 'กำหนดเสร็จ', type: 'date' }] },
        { id: 'cancel', label: 'ยกเลิกโครงการ', method: 'POST', endpoint: '/projects/:id/cancel', perm: 'projects.project.write', when: { field: 'status', in: ['planning', 'active', 'on_hold'] }, confirm: 'ยกเลิกแล้วจะลงชั่วโมงและเพิ่มงานไม่ได้อีก', tone: 'danger' },
      ],
    },

    /* ---------- milestones ---------- */
    milestoneList: {
      kind: 'list', title: 'งวดงาน', endpoint: '/milestones', perm: 'projects.project.read',
      filters: [{ name: 'q', label: 'ค้นหา', type: 'text' }, { name: 'done', label: 'เสร็จแล้ว', type: 'select', options: yesNo }, { name: 'overdue', label: 'เลยกำหนด', type: 'select', options: yesNo }],
      columns: [
        { key: 'project_no', label: 'โครงการ' }, { key: 'project_name', label: 'ชื่อโครงการ' }, { key: 'name', label: 'งวดงาน' },
        { key: 'due_date', label: 'กำหนด', format: 'date' }, { key: 'done', label: 'เสร็จ', format: 'boolean' }, { key: 'overdue', label: 'เลยกำหนด', format: 'boolean' },
      ],
      rowLink: { screen: 'projectDetail', idFrom: 'project_id' }, empty: 'ยังไม่มีงวดงาน',
      rowActions: [
        { id: 'done', label: 'เสร็จแล้ว', method: 'POST', endpoint: '/milestones/:id/done', perm: 'projects.project.write', when: { field: 'done', in: [false] }, tone: 'primary' },
        { id: 'undo', label: 'ยังไม่เสร็จ', method: 'POST', endpoint: '/milestones/:id/undo', perm: 'projects.project.write', when: { field: 'done', in: [true] } },
      ],
    },

    /* ---------- tasks ---------- */
    myTasks: {
      kind: 'list', title: 'งานของฉัน', endpoint: '/tasks/mine', perm: 'projects.project.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหางาน', type: 'text' }],
      columns: [
        { key: 'title', label: 'งาน' }, { key: 'project_no', label: 'โครงการ' }, { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'priority', label: 'ความสำคัญ', format: 'label' }, { key: 'due_date', label: 'กำหนดเสร็จ', format: 'date' }, { key: 'overdue', label: 'เลยกำหนด', format: 'boolean' },
      ],
      rowLink: { screen: 'taskDetail' }, create: 'timesheetNew', createLabel: 'ลงชั่วโมง', empty: 'ไม่มีงานค้าง',
      rowActions: taskActions(true),
    },
    taskList: {
      kind: 'list', title: 'งานทั้งหมด', endpoint: '/tasks', perm: 'projects.project.read', mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหางาน โครงการ หรือผู้รับผิดชอบ', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: taskStatuses },
        { name: 'priority', label: 'ความสำคัญ', type: 'select', options: priorities },
        { name: 'overdue', label: 'เลยกำหนด', type: 'select', options: yesNo },
      ],
      columns: [
        { key: 'title', label: 'งาน' }, { key: 'project_no', label: 'โครงการ' }, { key: 'assignee_name', label: 'ผู้รับผิดชอบ' },
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'priority', label: 'ความสำคัญ', format: 'label' },
        { key: 'due_date', label: 'กำหนดเสร็จ', format: 'date' }, { key: 'overdue', label: 'เลยกำหนด', format: 'boolean' },
        { key: 'estimate_hours', label: 'ประมาณ (ชม.)', format: 'qty' }, { key: 'hours_logged', label: 'จริง (ชม.)', format: 'qty' },
      ],
      create: 'taskNew', createLabel: 'สร้างงาน', rowLink: { screen: 'taskDetail' }, empty: 'ยังไม่มีงาน',
      rowActions: taskActions(false),
    },
    taskNew: {
      kind: 'form', title: 'สร้างงาน', method: 'POST', endpoint: '/tasks', perm: 'projects.task.write', mobile: true,
      fields: [
        projectLookup,
        { name: 'title', label: 'ชื่องาน', type: 'text', required: true },
        { name: 'description', label: 'รายละเอียด', type: 'textarea' },
        userLookup('assigneeId', 'ผู้รับผิดชอบ', 'assigneeName'),
        { name: 'priority', label: 'ความสำคัญ', type: 'select', options: priorities, default: 'normal' },
        { name: 'dueDate', label: 'กำหนดเสร็จ', type: 'date' },
        { name: 'estimateHours', label: 'ประมาณการ (ชั่วโมง)', type: 'number', step: 0.25 },
        { name: 'milestoneId', label: 'งวดงาน', type: 'lookup', help: 'ต้องเป็นงวดงานของโครงการเดียวกัน',
          lookup: { path: '/milestones', query: { done: 'false' }, label: ['project_no', 'name'], assign: { milestoneId: 'id' } } },
      ],
      submitLabel: 'สร้างงาน', after: { screen: 'taskDetail', idFrom: 'id' },
    },
    taskEdit: {
      kind: 'form', title: 'แก้ไขงาน', method: 'PATCH', endpoint: '/tasks/:id', load: '/tasks/:id', perm: 'projects.task.write', mobile: true,
      fields: [
        { name: 'title', label: 'ชื่องาน', type: 'text', required: true },
        { name: 'description', label: 'รายละเอียด', type: 'textarea' },
        userLookup('assigneeId', 'ผู้รับผิดชอบ', 'assigneeName'),
        { name: 'priority', label: 'ความสำคัญ', type: 'select', options: priorities },
        { name: 'dueDate', label: 'กำหนดเสร็จ', type: 'date' },
        { name: 'estimateHours', label: 'ประมาณการ (ชั่วโมง)', type: 'number', step: 0.25 },
      ],
      submitLabel: 'บันทึกการแก้ไข', after: { screen: 'taskDetail', idFrom: 'id' },
    },
    taskDetail: {
      kind: 'detail', title: 'งาน', endpoint: '/tasks/:id', perm: 'projects.project.read', heading: 'title', attachments: { entity: 'task' }, mobile: true, edit: 'taskEdit',
      flow: { field: 'status', steps: taskStatuses },
      fields: [
        { key: 'project_no', label: 'โครงการ' }, { key: 'project_name', label: 'ชื่อโครงการ' }, { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'priority', label: 'ความสำคัญ', format: 'label' }, { key: 'assignee_name', label: 'ผู้รับผิดชอบ' }, { key: 'milestone_name', label: 'งวดงาน' },
        { key: 'due_date', label: 'กำหนดเสร็จ', format: 'date' }, { key: 'overdue', label: 'เลยกำหนด', format: 'boolean' },
        { key: 'estimate_hours', label: 'ประมาณการ (ชม.)', format: 'qty' }, { key: 'hours_logged', label: 'ลงจริง (ชม.)', format: 'qty' },
        { key: 'completed_at', label: 'เสร็จเมื่อ', format: 'datetime' }, { key: 'description', label: 'รายละเอียด' },
      ],
      lines: [{ path: 'timesheets', label: 'ชั่วโมงที่ลงในงานนี้', columns: [
        { key: 'work_date', label: 'วันที่', format: 'date' }, { key: 'user_name', label: 'ผู้ลง' }, { key: 'hours', label: 'ชั่วโมง', format: 'qty' }, { key: 'note', label: 'หมายเหตุ' },
      ] }],
      actions: [...taskActions(true), reopenTask],
    },

    /* ---------- timesheets ---------- */
    timesheetNew: {
      kind: 'form', title: 'ลงชั่วโมงทำงาน', method: 'POST', endpoint: '/timesheets', perm: 'projects.timesheet.log', mobile: true,
      fields: [
        { name: 'workDate', label: 'วันที่ทำงาน', type: 'date', required: true },
        projectLookup,
        { name: 'taskId', label: 'งาน (ถ้ามี)', type: 'lookup', help: 'ต้องเป็นงานในโครงการที่เลือก',
          lookup: { path: '/tasks', query: { open: 'true' }, label: ['project_no', 'title'], assign: { taskId: 'id' } } },
        { name: 'hours', label: 'ชั่วโมง (0.25–24)', type: 'number', step: 0.25, required: true },
        { name: 'note', label: 'ทำอะไร', type: 'textarea' },
      ],
      submitLabel: 'บันทึกชั่วโมง', after: { screen: 'myWeek' },
    },
    myWeek: {
      kind: 'list', title: 'ชั่วโมงทำงานของฉัน (รายสัปดาห์)', endpoint: '/timesheets/week', rows: 'rows', perm: 'projects.timesheet.log', mobile: true,
      filters: [{ name: 'start', label: 'สัปดาห์ของวันที่', type: 'date' }],
      columns: [...entryColumns, { key: 'week_status', label: 'สถานะสัปดาห์', format: 'status' }],
      create: 'timesheetNew', createLabel: 'ลงชั่วโมง', empty: 'สัปดาห์นี้ยังไม่ได้ลงชั่วโมง',
      actions: [
        { id: 'submit', label: 'ส่งชั่วโมงทำงานให้อนุมัติ', method: 'POST', endpoint: '/timesheets/week/submit', perm: 'projects.timesheet.log', tone: 'primary', mobile: true,
          fields: [{ name: 'start', label: 'สัปดาห์ของวันที่ (เว้นว่าง = สัปดาห์นี้)', type: 'date' }] },
      ],
      rowActions: [
        { id: 'delete', label: 'ลบ', method: 'DELETE', endpoint: '/timesheets/:id', perm: 'projects.timesheet.log', when: { field: 'week_status', in: ['draft'] }, confirm: 'ลบชั่วโมงรายการนี้', tone: 'danger', mobile: true },
      ],
    },
    entryList: {
      kind: 'list', title: 'ชั่วโมงทำงาน', endpoint: '/timesheets', perm: 'projects.timesheet.log',
      filters: [
        { name: 'q', label: 'ค้นหาโครงการ งาน หรือพนักงาน', type: 'text' },
        { name: 'from', label: 'ตั้งแต่', type: 'date' }, { name: 'to', label: 'ถึง', type: 'date' },
      ],
      columns: [{ key: 'user_name', label: 'พนักงาน' }, ...entryColumns, { key: 'week_status', label: 'สถานะ', format: 'status' }],
      empty: 'ยังไม่มีการลงชั่วโมง',
    },
    weekApprovals: {
      kind: 'list', title: 'อนุมัติชั่วโมงทำงาน', endpoint: '/timesheet-weeks', perm: 'projects.timesheet.approve', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาพนักงาน', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: weekStatuses }],
      columns: [
        { key: 'user_name', label: 'พนักงาน' }, { key: 'week_start', label: 'สัปดาห์เริ่ม', format: 'date' }, { key: 'week_end', label: 'ถึง', format: 'date' },
        { key: 'total_hours', label: 'รวมชั่วโมง', format: 'qty' }, { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'submitted_at', label: 'ส่งเมื่อ', format: 'datetime' },
      ],
      rowLink: { screen: 'weekDetail' }, empty: 'ไม่มีชั่วโมงทำงานรออนุมัติ',
      rowActions: [approveWeek, rejectWeek],
    },
    weekDetail: {
      kind: 'detail', title: 'ชั่วโมงทำงานรายสัปดาห์', endpoint: '/timesheet-weeks/:id', perm: 'projects.timesheet.log', heading: 'user_name', mobile: true, printable: true,
      flow: { field: 'status', steps: weekStatuses },
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'week_start', label: 'สัปดาห์เริ่ม', format: 'date' },
        { key: 'total_hours', label: 'รวมชั่วโมง', format: 'qty' }, { key: 'submitted_at', label: 'ส่งเมื่อ', format: 'datetime' },
        { key: 'approved_by_name', label: 'ผู้อนุมัติ' }, { key: 'approved_at', label: 'อนุมัติเมื่อ', format: 'datetime' },
        { key: 'reject_reason', label: 'เหตุผลที่ตีกลับ' }, { key: 'rejected_by_name', label: 'ตีกลับโดย' },
      ],
      lines: [{ path: 'entries', label: 'รายการชั่วโมง', columns: entryColumns }],
      actions: [approveWeek, rejectWeek],
    },
  },
  widgets: [
    { id: 'pj-kpi', kind: 'kpi', title: 'โครงการ', endpoint: '/summary', perm: 'projects.project.read', size: 'md', href: 'projectList',
      items: [
        { key: 'activeProjects', label: 'โครงการที่ดำเนินการ', format: 'qty', tone: 'ok' },
        { key: 'overdueTasks', label: 'งานเลยกำหนด', format: 'qty', tone: 'stop' },
        { key: 'tasksDueThisWeek', label: 'งานครบกำหนดสัปดาห์นี้', format: 'qty', tone: 'warn' },
        { key: 'hoursThisWeek', label: 'ชั่วโมงสัปดาห์นี้', format: 'qty' },
        { key: 'budgetAtRisk', label: 'ใกล้เกินงบ', format: 'qty', tone: 'stop' },
      ] },
    { id: 'pj-board', kind: 'pipeline', title: 'บอร์ดงาน', endpoint: '/summary', perm: 'projects.project.read', size: 'wide', href: 'taskList',
      rows: 'rows', field: 'status', stages: taskStatuses, title2: 'title', subtitle: 'project_no', link: { screen: 'taskDetail' } },
    { id: 'pj-hours', kind: 'trend', title: 'ชั่วโมงทำงาน 6 เดือน', endpoint: '/summary', perm: 'projects.project.read', size: 'md', href: 'entryList',
      rows: 'months', x: 'month', y: 'hours', format: 'qty' },
    { id: 'pj-budget', kind: 'bars', title: 'ใช้งบโครงการ (%)', endpoint: '/summary', perm: 'projects.project.read', size: 'md', href: 'projectList',
      rows: 'budgetRows', label: 'label', value: 'budget_used_pct', threshold: 'limit', format: 'percent' },
  ],
});
