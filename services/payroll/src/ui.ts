import { defineUi, type Column, type Field, type ImportColumn } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const runStatuses = [
  { value: 'draft', label: 'ร่าง' }, { value: 'calculated', label: 'คำนวณแล้ว' }, { value: 'approved', label: 'อนุมัติแล้ว' },
  { value: 'paid', label: 'จ่ายแล้ว' }, { value: 'cancelled', label: 'ยกเลิก' },
];
const payTypes = [{ value: 'monthly', label: 'รายเดือน' }, { value: 'daily', label: 'รายวัน' }];
const yesNo = [{ value: 'true', label: 'ใช้งาน' }, { value: 'false', label: 'ไม่ใช้งาน' }];

const READ = 'payroll.run.read';
const WRITE = 'payroll.run.write';
const PROFILE_READ = 'payroll.profile.read';
const PROFILE_WRITE = 'payroll.profile.write';
const SELF = 'payroll.payslip.self';

const profileFields: Field[] = [
  { name: 'employeeCode', label: 'รหัสพนักงาน', type: 'text', required: true, help: 'ใช้รหัสเดียวกับทะเบียนพนักงาน (HR)' },
  { name: 'employeeName', label: 'ชื่อ-นามสกุล', type: 'text', required: true },
  { name: 'department', label: 'แผนก', type: 'text' },
  { name: 'position', label: 'ตำแหน่ง', type: 'text' },
  { name: 'userId', label: 'บัญชีผู้ใช้ (ให้เห็นสลิปของตนเอง)', type: 'lookup',
    lookup: { module: 'identity', path: '/users', label: ['name', 'email'], assign: { userId: 'id', userName: 'name' } } },
  { name: 'payType', label: 'ประเภทการจ่าย', type: 'select', required: true, default: 'monthly', options: payTypes },
  { name: 'baseSalary', label: 'เงินเดือน (บาท/เดือน)', type: 'number', step: 0.01, help: 'พนักงานรายเดือน' },
  { name: 'dailyWage', label: 'ค่าจ้างรายวัน (บาท/วัน)', type: 'number', step: 0.01, help: 'พนักงานรายวัน' },
  { name: 'startDate', label: 'วันเริ่มงาน', type: 'date', help: 'เข้างานกลางเดือน ระบบคิดเงินเดือนตามสัดส่วนวัน' },
  { name: 'endDate', label: 'วันสิ้นสุดการจ้าง', type: 'date' },
  { name: 'bankName', label: 'ธนาคาร', type: 'text', help: 'เช่น กสิกรไทย, กรุงเทพ, ไทยพาณิชย์' },
  { name: 'bankAccount', label: 'เลขบัญชี (เก็บเฉพาะ 4 หลักท้าย)', type: 'text', help: 'ระบบไม่เก็บเลขบัญชีเต็มและเลขบัตรประชาชน' },
  { name: 'ssoEnrolled', label: 'ผู้ประกันตน (หักประกันสังคม)', type: 'boolean', default: true },
  { name: 'pvdEmployeePct', label: 'กองทุนสำรองเลี้ยงชีพ: เงินสะสม % (2–15)', type: 'number', step: 0.5 },
  { name: 'pvdEmployerPct', label: 'กองทุนสำรองเลี้ยงชีพ: เงินสมทบนายจ้าง %', type: 'number', step: 0.5 },
  { name: 'taxSpouse', label: 'ลดหย่อนคู่สมรส (ไม่มีเงินได้)', type: 'boolean' },
  { name: 'taxChildren', label: 'จำนวนบุตร (ลดหย่อนคนละ 30,000)', type: 'number', step: 1 },
  { name: 'taxChildren2018', label: 'บุตรคนที่ 2 ขึ้นไปที่เกิดตั้งแต่ปี 2561 (60,000)', type: 'number', step: 1 },
  { name: 'taxParents', label: 'จำนวนบิดามารดาที่อุปการะ (0–4)', type: 'number', step: 1 },
  { name: 'taxLifeInsurance', label: 'เบี้ยประกันชีวิต (บาท/ปี)', type: 'number', step: 0.01 },
  { name: 'taxHealthInsurance', label: 'เบี้ยประกันสุขภาพตนเอง (บาท/ปี)', type: 'number', step: 0.01 },
  { name: 'taxParentHealth', label: 'เบี้ยประกันสุขภาพบิดามารดา (บาท/ปี)', type: 'number', step: 0.01 },
  { name: 'taxHomeLoan', label: 'ดอกเบี้ยเงินกู้ที่อยู่อาศัย (บาท/ปี)', type: 'number', step: 0.01 },
  { name: 'taxOther', label: 'ลดหย่อนอื่นๆ (บาท/ปี)', type: 'number', step: 0.01, help: 'เช่น RMF/SSF/Thai ESG หลังคำนวณเพดานแล้ว' },
  { name: 'openingYear', label: 'ยอดยกมา: ปี ค.ศ.', type: 'number', step: 1, help: 'เริ่มใช้ระบบกลางปี — ยอดสะสมจากโปรแกรมเงินเดือนเดิม' },
  { name: 'openingIncome', label: 'ยอดยกมา: เงินได้สะสม', type: 'number', step: 0.01 },
  { name: 'openingTax', label: 'ยอดยกมา: ภาษีที่หักแล้ว', type: 'number', step: 0.01 },
  { name: 'openingSso', label: 'ยอดยกมา: ประกันสังคมสะสม', type: 'number', step: 0.01 },
  { name: 'openingPvd', label: 'ยอดยกมา: กองทุนสำรองเลี้ยงชีพสะสม', type: 'number', step: 0.01 },
  { name: 'active', label: 'ใช้งาน (รวมในรอบเงินเดือน)', type: 'boolean', default: true },
  { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
];

const profileImport: ImportColumn[] = [
  { key: 'employeeCode', label: 'รหัสพนักงาน', required: true },
  { key: 'employeeName', label: 'ชื่อ-นามสกุล', required: true },
  { key: 'department', label: 'แผนก' },
  { key: 'position', label: 'ตำแหน่ง' },
  { key: 'payType', label: 'ประเภทการจ่าย' },
  { key: 'baseSalary', label: 'เงินเดือน' },
  { key: 'dailyWage', label: 'ค่าจ้างรายวัน' },
  { key: 'startDate', label: 'วันเริ่มงาน' },
  { key: 'endDate', label: 'วันสิ้นสุดการจ้าง' },
  { key: 'bankName', label: 'ธนาคาร' },
  { key: 'bankAccount', label: 'เลขบัญชี' },
  { key: 'ssoEnrolled', label: 'ประกันสังคม' },
  { key: 'pvdEmployeePct', label: 'กองทุนสำรองฯ ลูกจ้าง %' },
  { key: 'pvdEmployerPct', label: 'กองทุนสำรองฯ นายจ้าง %' },
  { key: 'taxSpouse', label: 'ลดหย่อนคู่สมรส' },
  { key: 'taxChildren', label: 'จำนวนบุตร' },
  { key: 'taxChildren2018', label: 'บุตรคนที่ 2 เกิดตั้งแต่ 2561' },
  { key: 'taxParents', label: 'บิดามารดาที่อุปการะ' },
  { key: 'taxLifeInsurance', label: 'เบี้ยประกันชีวิต' },
  { key: 'taxHealthInsurance', label: 'เบี้ยประกันสุขภาพ' },
];

const inputFields: Field[] = [
  { name: 'workDays', label: 'วันทำงาน (พนักงานรายวัน)', type: 'number', step: 0.5 },
  { name: 'ot15Hours', label: 'OT 1.5 เท่า (ชั่วโมง)', type: 'number', step: 0.5, help: 'ทำงานเกินเวลาในวันทำงาน' },
  { name: 'ot1Hours', label: 'ทำงานวันหยุด 1 เท่า (ชั่วโมง)', type: 'number', step: 0.5, help: 'พนักงานรายเดือนทำงานในวันหยุด' },
  { name: 'ot2Hours', label: 'ทำงานวันหยุด 2 เท่า (ชั่วโมง)', type: 'number', step: 0.5, help: 'พนักงานรายวันทำงานในวันหยุด' },
  { name: 'ot3Hours', label: 'OT วันหยุด 3 เท่า (ชั่วโมง)', type: 'number', step: 0.5 },
  { name: 'unpaidLeaveDays', label: 'ลาไม่รับค่าจ้าง / ขาดงาน (วัน)', type: 'number', step: 0.5 },
  { name: 'bonus', label: 'โบนัส', type: 'number', step: 0.01 },
  { name: 'otherIncome', label: 'รายได้อื่น (ครั้งเดียว)', type: 'number', step: 0.01 },
  { name: 'otherDeduction', label: 'รายการหักอื่น (ครั้งเดียว)', type: 'number', step: 0.01 },
  { name: 'note', label: 'หมายเหตุ', type: 'text' },
];

const inputImport: ImportColumn[] = [
  { key: 'period', label: 'เดือน (YYYY-MM)', required: true },
  { key: 'employeeCode', label: 'รหัสพนักงาน', required: true },
  { key: 'workDays', label: 'วันทำงาน' },
  { key: 'ot15Hours', label: 'OT 1.5' },
  { key: 'ot1Hours', label: 'OT 1' },
  { key: 'ot2Hours', label: 'OT 2' },
  { key: 'ot3Hours', label: 'OT 3' },
  { key: 'unpaidLeaveDays', label: 'ลาไม่รับค่าจ้าง (วัน)' },
  { key: 'bonus', label: 'โบนัส' },
  { key: 'otherIncome', label: 'รายได้อื่น' },
  { key: 'otherDeduction', label: 'รายการหักอื่น' },
  { key: 'note', label: 'หมายเหตุ' },
];

const itemFields: Field[] = [
  { name: 'kind', label: 'ประเภท', type: 'select', required: true, default: 'earning', options: [{ value: 'earning', label: 'รายได้ประจำ' }, { value: 'deduction', label: 'รายการหักประจำ' }] },
  { name: 'code', label: 'รหัส', type: 'text', required: true, help: 'เช่น POSITION, TRANSPORT, LOAN' },
  { name: 'name', label: 'ชื่อรายการ', type: 'text', required: true, help: 'เช่น ค่าตำแหน่ง, ค่าเดินทาง, หักเงินกู้สหกรณ์' },
  { name: 'amount', label: 'จำนวนเงินต่อเดือน', type: 'number', step: 0.01, required: true },
  { name: 'taxable', label: 'รายได้: นำไปคิดภาษี', type: 'boolean', default: true },
  { name: 'sso', label: 'รายได้: นับเป็นค่าจ้างประกันสังคม', type: 'boolean' },
  { name: 'balance', label: 'รายการหัก: ยอดคงเหลือ (เงินกู้)', type: 'number', step: 0.01, help: 'หักจนครบแล้วหยุดเอง' },
];

const runColumns: Column[] = [
  { key: 'no', label: 'เลขที่' },
  { key: 'period', label: 'เดือน', format: 'month' },
  { key: 'pay_date', label: 'วันจ่าย', format: 'date' },
  { key: 'headcount', label: 'จำนวนคน', format: 'qty' },
  { key: 'gross', label: 'รายได้รวม', format: 'money' },
  { key: 'net', label: 'จ่ายสุทธิ', format: 'money' },
  { key: 'status', label: 'สถานะ', format: 'status' },
];

const slipFields: Column[] = [
  { key: 'employee_name', label: 'ชื่อพนักงาน' },
  { key: 'employee_code', label: 'รหัสพนักงาน' },
  { key: 'department', label: 'แผนก' },
  { key: 'position', label: 'ตำแหน่ง' },
  { key: 'period_label', label: 'งวดเดือน' },
  { key: 'pay_date', label: 'วันที่จ่าย', format: 'date' },
  { key: 'bank_text', label: 'โอนเข้าบัญชี' },
  { key: 'gross', label: 'รวมรายได้', format: 'money' },
  { key: 'total_deductions', label: 'รวมรายการหัก', format: 'money' },
  { key: 'net', label: 'เงินได้สุทธิ', format: 'money' },
  { key: 'net_text', label: 'ตัวอักษร' },
  { key: 'ytd_income', label: 'เงินได้สะสมทั้งปี', format: 'money' },
  { key: 'ytd_tax', label: 'ภาษีสะสมทั้งปี', format: 'money' },
  { key: 'ytd_sso', label: 'ประกันสังคมสะสม', format: 'money' },
  { key: 'ytd_pvd', label: 'กองทุนสำรองฯ สะสม', format: 'money' },
  { key: 'pvd_employer', label: 'เงินสมทบกองทุนฯ จากนายจ้าง', format: 'money' },
];
const slipLines = [
  { path: 'earnings', label: 'รายได้', columns: [{ key: 'name', label: 'รายการ' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' as const }] },
  { path: 'deductions', label: 'รายการหัก', columns: [{ key: 'name', label: 'รายการ' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' as const }] },
];

const pickRun = (title: string, screen: string) => ({
  kind: 'list' as const, title, endpoint: '/runs', perm: READ,
  filters: [{ name: 'year', label: 'ปี (ค.ศ. หรือ พ.ศ.)', type: 'number' as const }],
  columns: runColumns.filter((c) => c.key !== 'gross'),
  rowLink: { screen }, empty: 'ยังไม่มีรอบเงินเดือน',
});

export default defineUi({
  module: 'payroll',
  label: 'เงินเดือน',
  glyph: 'ง',
  icon: 'banknote',
  area: 'finance',
  statusLabels: { calculated: 'คำนวณแล้ว', earning: 'รายได้', deduction: 'รายการหัก' },
  menu: [
    { label: 'สลิปเงินเดือนของฉัน', screen: 'myPayslips' },
    { label: 'รอบเงินเดือน', screen: 'runs' },
    { label: 'สลิปเงินเดือนทุกคน', screen: 'payslips' },
    { label: 'ข้อมูลเงินเดือนพนักงาน', screen: 'profiles' },
    { label: 'รายได้/รายการหักประจำ', screen: 'items' },
    { label: 'โอนเงินเดือนเข้าธนาคาร', screen: 'bankRuns' },
    { label: 'ประกันสังคม สปส.1-10', screen: 'ssoRuns' },
    { label: 'ภ.ง.ด.1 รายเดือน', screen: 'pnd1Runs' },
    { label: 'หนังสือรับรอง 50 ทวิ', screen: 'certificates' },
    { label: 'ตั้งค่าเงินเดือน', screen: 'settings' },
  ],
  commands: [
    { id: 'myslip', label: 'สลิปเงินเดือนของฉัน', example: 'สลิป', keywords: ['สลิป', 'สลิปเงินเดือน', 'สลิปของฉัน'], screen: 'myPayslips', perm: SELF },
    { id: 'run', label: 'ทำเงินเดือน (สร้างรอบใหม่)', example: 'ทำเงินเดือน รอบปกติ', keywords: ['ทำเงินเดือน', 'รันเงินเดือน', 'คำนวณเงินเดือน'], screen: 'runNew', perm: WRITE, restField: 'note' },
    { id: 'profile', label: 'ข้อมูลเงินเดือนพนักงาน', example: 'เงินเดือนพนักงาน EMP-001', keywords: ['เงินเดือนพนักงาน', 'ฐานเงินเดือน'], screen: 'profileDetail', perm: PROFILE_READ,
      arg: { lookup: { path: '/profiles', label: ['employee_code', 'employee_name'], assign: { id: 'id' } }, openId: 'id' } },
    { id: 'cert', label: 'หนังสือรับรองการหักภาษี 50 ทวิ', example: '50 ทวิ', keywords: ['50 ทวิ', 'หนังสือรับรองภาษี'], screen: 'certificates', perm: READ },
  ],
  search: [
    { id: 'profiles', title: 'ข้อมูลเงินเดือนพนักงาน', endpoint: '/profiles', label: ['employee_code', 'employee_name', 'department'], screen: 'profileDetail', perm: PROFILE_READ },
    { id: 'runs', title: 'รอบเงินเดือน', endpoint: '/runs', label: ['no', 'period'], screen: 'runDetail', perm: READ },
  ],
  screens: {
    /* ---- self-service ---- */
    myPayslips: {
      kind: 'list', title: 'สลิปเงินเดือนของฉัน', endpoint: '/my-payslips', perm: SELF, mobile: true,
      filters: [{ name: 'year', label: 'ปี (ค.ศ. หรือ พ.ศ.)', type: 'number' }],
      columns: [
        { key: 'period', label: 'เดือน', format: 'month' }, { key: 'pay_date', label: 'วันจ่าย', format: 'date' },
        { key: 'gross', label: 'รายได้', format: 'money' }, { key: 'total_deductions', label: 'รายการหัก', format: 'money' }, { key: 'net', label: 'รับสุทธิ', format: 'money' },
      ],
      rowLink: { screen: 'myPayslip' }, empty: 'ยังไม่มีสลิปเงินเดือน (สลิปจะแสดงเมื่อบริษัทบันทึกจ่ายเงินเดือนแล้ว และบัญชีของคุณผูกกับข้อมูลเงินเดือน)',
    },
    myPayslip: {
      kind: 'detail', title: 'สลิปเงินเดือน', endpoint: '/my-payslips/:id', perm: SELF, heading: 'period_label', mobile: true,
      print: { title: 'สลิปเงินเดือน / ใบแจ้งเงินเดือน', signatures: ['ผู้จ่ายเงิน', { label: 'ผู้รับเงิน', name: 'employee_name' }] },
      fields: slipFields, lines: slipLines,
    },

    /* ---- runs ---- */
    runs: {
      kind: 'list', title: 'รอบเงินเดือน', endpoint: '/runs', perm: READ, mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่หรือเดือน', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: runStatuses },
        { name: 'year', label: 'ปี (ค.ศ. หรือ พ.ศ.)', type: 'number' },
      ],
      columns: runColumns,
      create: 'runNew', createLabel: 'ทำเงินเดือนเดือนใหม่', rowLink: { screen: 'runDetail' },
      empty: 'ยังไม่มีรอบเงินเดือน — เพิ่มข้อมูลเงินเดือนพนักงานก่อน แล้วกด "ทำเงินเดือนเดือนใหม่"',
    },
    runNew: {
      kind: 'form', title: 'ทำเงินเดือนเดือนใหม่', method: 'POST', endpoint: '/runs', perm: WRITE,
      fields: [
        { name: 'period', label: 'งวดเดือน (YYYY-MM)', type: 'text', required: true, help: 'เช่น 2026-10 — ระบบดึงพนักงานที่ทำงานในเดือนนั้นให้อัตโนมัติ' },
        { name: 'payDate', label: 'วันที่จ่าย', type: 'date', required: true },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      submitLabel: 'สร้างรอบเงินเดือน', after: { screen: 'runDetail', idFrom: 'id' },
    },
    runDetail: {
      kind: 'detail', title: 'รอบเงินเดือน', endpoint: '/runs/:id', perm: READ, heading: 'no', mobile: true,
      print: { title: 'สรุปเงินเดือน', signatures: [{ label: 'ผู้จัดทำ', name: 'created_by_name' }, { label: 'ผู้อนุมัติ', name: 'approved_by_name' }, { label: 'ผู้จ่ายเงิน', name: 'paid_by_name' }] },
      flow: {
        field: 'status',
        steps: [{ value: 'draft', label: 'ร่าง' }, { value: 'calculated', label: 'คำนวณแล้ว' }, { value: 'approved', label: 'อนุมัติ' }, { value: 'paid', label: 'จ่ายแล้ว' }],
        exits: [{ value: 'cancelled', label: 'ยกเลิก' }],
      },
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'period_label', label: 'งวดเดือน' },
        { key: 'pay_date', label: 'วันที่จ่าย', format: 'date' },
        { key: 'headcount', label: 'จำนวนพนักงาน', format: 'qty' },
        { key: 'salary', label: 'เงินเดือน/ค่าจ้าง', format: 'money' },
        { key: 'overtime', label: 'ค่าล่วงเวลา', format: 'money' },
        { key: 'allowances', label: 'รายได้ประจำอื่น', format: 'money' },
        { key: 'bonus', label: 'โบนัส', format: 'money' },
        { key: 'gross', label: 'รวมรายได้', format: 'money' },
        { key: 'sso_employee', label: 'ประกันสังคม (ลูกจ้าง)', format: 'money' },
        { key: 'sso_employer', label: 'ประกันสังคม (นายจ้าง)', format: 'money' },
        { key: 'wht', label: 'ภาษีหัก ณ ที่จ่าย', format: 'money' },
        { key: 'pvd_employee', label: 'กองทุนสำรองฯ (ลูกจ้าง)', format: 'money' },
        { key: 'pvd_employer', label: 'กองทุนสำรองฯ (นายจ้าง)', format: 'money' },
        { key: 'unpaid_leave', label: 'หักลาไม่รับค่าจ้าง', format: 'money' },
        { key: 'loans', label: 'หักเงินกู้/รายการประจำ', format: 'money' },
        { key: 'net', label: 'จ่ายสุทธิ', format: 'money' },
        { key: 'net_text', label: 'ตัวอักษร' },
        { key: 'employer_cost', label: 'ต้นทุนบริษัท (รวมเงินสมทบ)', format: 'money' },
        { key: 'created_by_name', label: 'ผู้จัดทำ' },
        { key: 'approved_by_name', label: 'ผู้อนุมัติ' },
        { key: 'paid_at', label: 'วันที่บันทึกจ่าย', format: 'date' },
        { key: 'pay_reference', label: 'อ้างอิงการโอน' },
        { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [
        { path: 'lines', label: 'พนักงาน', columns: [
          { key: 'employee_code', label: 'รหัส' }, { key: 'employee_name', label: 'ชื่อ' }, { key: 'pay_type_label', label: 'ประเภท' },
          { key: 'salary', label: 'เงินเดือน/ค่าจ้าง', format: 'money' }, { key: 'overtime', label: 'OT', format: 'money' }, { key: 'gross', label: 'รวมรายได้', format: 'money' },
          { key: 'sso_employee', label: 'ประกันสังคม', format: 'money' }, { key: 'wht', label: 'ภาษี', format: 'money' }, { key: 'pvd_employee', label: 'กองทุนฯ', format: 'money' },
          { key: 'total_deductions', label: 'รวมหัก', format: 'money' }, { key: 'net', label: 'สุทธิ', format: 'money' },
        ] },
        { path: 'problems', label: 'ต้องตรวจสอบ', columns: [{ key: 'employee_code', label: 'รหัส' }, { key: 'employee_name', label: 'ชื่อ' }, { key: 'message', label: 'รายละเอียด' }] },
      ],
      actions: [
        { id: 'calculate', label: 'คำนวณเงินเดือน', method: 'POST', endpoint: '/runs/:id/calculate', perm: WRITE, when: { field: 'status', in: ['draft', 'calculated'] }, tone: 'primary' },
        { id: 'approve', label: 'อนุมัติจ่ายเงินเดือน', method: 'POST', endpoint: '/runs/:id/approve', perm: 'payroll.run.approve', when: { field: 'status', in: ['calculated'] }, tone: 'primary',
          confirm: 'อนุมัติรอบเงินเดือนนี้? หลังอนุมัติจะแก้ไขตัวเลขไม่ได้จนกว่าจะเปิดแก้ไข', mobile: true },
        { id: 'pay', label: 'บันทึกจ่ายเงินเดือนแล้ว', method: 'POST', endpoint: '/runs/:id/pay', perm: 'payroll.run.pay', when: { field: 'status', in: ['approved'] }, tone: 'primary',
          fields: [{ name: 'paidDate', label: 'วันที่โอน (เว้นว่าง = วันนี้)', type: 'date' }, { name: 'reference', label: 'อ้างอิงการโอน', type: 'text' }] },
        { id: 'reopen', label: 'เปิดแก้ไข', method: 'POST', endpoint: '/runs/:id/reopen', perm: 'payroll.run.approve', when: { field: 'status', in: ['approved'] }, confirm: 'ยกเลิกการอนุมัติเพื่อแก้ไขและคำนวณใหม่?' },
        { id: 'cancel', label: 'ยกเลิกรอบ', method: 'POST', endpoint: '/runs/:id/cancel', perm: WRITE, when: { field: 'status', in: ['draft', 'calculated'] }, tone: 'danger', confirm: 'ยกเลิกรอบเงินเดือนนี้?' },
      ],
    },

    /* ---- payslips ---- */
    payslips: {
      kind: 'list', title: 'สลิปเงินเดือนทุกคน', endpoint: '/payslips', perm: READ,
      filters: [
        { name: 'q', label: 'ค้นหารหัส ชื่อ แผนก', type: 'text' },
        { name: 'period', label: 'เดือน (YYYY-MM)', type: 'text' },
      ],
      columns: [
        { key: 'run_no', label: 'รอบ' }, { key: 'period', label: 'เดือน', format: 'month' }, { key: 'employee_code', label: 'รหัส' }, { key: 'employee_name', label: 'ชื่อ' },
        { key: 'work_days', label: 'วันทำงาน', format: 'qty' }, { key: 'ot_hours', label: 'OT (ชม.)', format: 'qty' }, { key: 'unpaid_leave_days', label: 'ลาไม่รับค่าจ้าง', format: 'qty' },
        { key: 'gross', label: 'รายได้', format: 'money' }, { key: 'total_deductions', label: 'หัก', format: 'money' }, { key: 'net', label: 'สุทธิ', format: 'money' },
        { key: 'run_status', label: 'สถานะรอบ', format: 'status' }, { key: 'warning_text', label: 'ต้องตรวจสอบ' },
      ],
      rowLink: { screen: 'payslipDetail' },
      rowActions: [
        { id: 'inputs', label: 'กรอก OT/วันลา', method: 'PUT', endpoint: '/payslips/:id/inputs', perm: WRITE, when: { field: 'run_status', in: ['draft', 'calculated'] }, fields: inputFields },
      ],
      import: { endpoint: '/inputs/import', perm: WRITE, columns: inputImport, template: 'แบบฟอร์มนำเข้า-OT-วันลา.csv' },
      empty: 'ยังไม่มีสลิป — สร้างรอบเงินเดือนก่อน',
    },
    payslipDetail: {
      kind: 'detail', title: 'สลิปเงินเดือน', endpoint: '/payslips/:id', perm: READ, heading: 'heading',
      print: { title: 'สลิปเงินเดือน / ใบแจ้งเงินเดือน', signatures: ['ผู้จ่ายเงิน', { label: 'ผู้รับเงิน', name: 'employee_name' }] },
      fields: [
        ...slipFields,
        { key: 'run_no', label: 'รอบเงินเดือน' }, { key: 'run_status', label: 'สถานะรอบ', format: 'status' },
        { key: 'pay_type_label', label: 'ประเภทการจ่าย' }, { key: 'employed_days', label: 'วันที่อยู่ในการจ้าง', format: 'qty' },
        { key: 'work_days', label: 'วันทำงาน', format: 'qty' }, { key: 'ot15_hours', label: 'OT 1.5 (ชม.)', format: 'qty' }, { key: 'ot1_hours', label: 'OT 1 (ชม.)', format: 'qty' },
        { key: 'ot2_hours', label: 'OT 2 (ชม.)', format: 'qty' }, { key: 'ot3_hours', label: 'OT 3 (ชม.)', format: 'qty' }, { key: 'unpaid_leave_days', label: 'ลาไม่รับค่าจ้าง (วัน)', format: 'qty' },
        { key: 'sso_wage', label: 'ค่าจ้างที่ใช้คิดประกันสังคม', format: 'money' }, { key: 'sso_employer', label: 'ประกันสังคมส่วนนายจ้าง', format: 'money' },
        { key: 'tax_detail.projectedIncome', label: 'ประมาณการเงินได้ทั้งปี', format: 'money' }, { key: 'tax_detail.netIncome', label: 'เงินได้สุทธิ (หลังลดหย่อน)', format: 'money' },
        { key: 'tax_detail.annualTax', label: 'ภาษีทั้งปี (ประมาณการ)', format: 'money' }, { key: 'tax_detail.remainingPeriods', label: 'งวดที่เหลือในปี', format: 'qty' },
        { key: 'warning_text', label: 'ต้องตรวจสอบ' }, { key: 'input_note', label: 'หมายเหตุ' },
      ],
      lines: slipLines,
      actions: [
        { id: 'inputs', label: 'กรอก OT/วันลา/โบนัส', method: 'PUT', endpoint: '/payslips/:id/inputs', perm: WRITE, when: { field: 'run_status', in: ['draft', 'calculated'] }, fields: inputFields, tone: 'primary' },
      ],
    },

    /* ---- profiles ---- */
    profiles: {
      kind: 'list', title: 'ข้อมูลเงินเดือนพนักงาน', endpoint: '/profiles', perm: PROFILE_READ,
      filters: [
        { name: 'q', label: 'ค้นหารหัส ชื่อ แผนก', type: 'text' },
        { name: 'active', label: 'สถานะ', type: 'select', options: yesNo },
        { name: 'payType', label: 'ประเภทการจ่าย', type: 'select', options: payTypes },
      ],
      columns: [
        { key: 'employee_code', label: 'รหัส' }, { key: 'employee_name', label: 'ชื่อ' }, { key: 'department', label: 'แผนก' },
        { key: 'pay_type_label', label: 'ประเภท' }, { key: 'rate', label: 'เงินเดือน/ค่าจ้าง', format: 'money' },
        { key: 'bank_name', label: 'ธนาคาร' }, { key: 'bank_account_last4', label: 'บัญชี 4 หลักท้าย' },
        { key: 'sso_enrolled', label: 'ประกันสังคม', format: 'boolean' }, { key: 'pvd_employee_pct', label: 'กองทุนฯ %', format: 'qty' },
        { key: 'user_name', label: 'บัญชีผู้ใช้' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      create: 'profileNew', createLabel: 'เพิ่มข้อมูลเงินเดือน', rowLink: { screen: 'profileDetail' },
      import: { endpoint: '/profiles/import', perm: PROFILE_WRITE, columns: profileImport, template: 'แบบฟอร์มนำเข้าข้อมูลเงินเดือน.csv' },
      empty: 'ยังไม่มีข้อมูลเงินเดือน — เพิ่มทีละคน หรือนำเข้าจากไฟล์ Excel (ส่งออกรายชื่อจากเมนูพนักงานได้)',
    },
    profileNew: {
      kind: 'form', title: 'เพิ่มข้อมูลเงินเดือน', method: 'POST', endpoint: '/profiles', perm: PROFILE_WRITE,
      fields: profileFields, submitLabel: 'บันทึก', after: { screen: 'profileDetail', idFrom: 'id' },
    },
    profileEdit: {
      kind: 'form', title: 'แก้ไขข้อมูลเงินเดือน', method: 'PATCH', endpoint: '/profiles/:id', load: '/profiles/:id', perm: PROFILE_WRITE,
      fields: profileFields, submitLabel: 'บันทึกการแก้ไข', after: { screen: 'profileDetail', idFrom: 'id' },
    },
    profileDetail: {
      kind: 'detail', title: 'ข้อมูลเงินเดือนพนักงาน', endpoint: '/profiles/:id', perm: PROFILE_READ, heading: 'employee_name', edit: 'profileEdit',
      fields: [
        { key: 'employee_code', label: 'รหัสพนักงาน' }, { key: 'department', label: 'แผนก' }, { key: 'position', label: 'ตำแหน่ง' },
        { key: 'pay_type_label', label: 'ประเภทการจ่าย' }, { key: 'base_salary', label: 'เงินเดือน', format: 'money' }, { key: 'daily_wage', label: 'ค่าจ้างรายวัน', format: 'money' },
        { key: 'start_date', label: 'วันเริ่มงาน', format: 'date' }, { key: 'end_date', label: 'วันสิ้นสุดการจ้าง', format: 'date' },
        { key: 'bank_name', label: 'ธนาคาร' }, { key: 'bank_account', label: 'เลขบัญชี' },
        { key: 'sso_enrolled', label: 'ผู้ประกันตน', format: 'boolean' },
        { key: 'pvd_employee_pct', label: 'กองทุนฯ ลูกจ้าง %', format: 'qty' }, { key: 'pvd_employer_pct', label: 'กองทุนฯ นายจ้าง %', format: 'qty' },
        { key: 'tax_spouse', label: 'ลดหย่อนคู่สมรส', format: 'boolean' }, { key: 'tax_children', label: 'บุตร', format: 'qty' }, { key: 'tax_children2018', label: 'บุตรคนที่ 2+ (2561 ขึ้นไป)', format: 'qty' },
        { key: 'tax_parents', label: 'บิดามารดา', format: 'qty' }, { key: 'tax_life_insurance', label: 'เบี้ยประกันชีวิต', format: 'money' },
        { key: 'tax_health_insurance', label: 'เบี้ยประกันสุขภาพ', format: 'money' }, { key: 'tax_home_loan', label: 'ดอกเบี้ยบ้าน', format: 'money' }, { key: 'tax_other', label: 'ลดหย่อนอื่น', format: 'money' },
        { key: 'user_name', label: 'บัญชีผู้ใช้ (ดูสลิปตนเอง)' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' }, { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [
        { path: 'items', label: 'รายได้/รายการหักประจำ', columns: [
          { key: 'kind', label: 'ประเภท', format: 'label' }, { key: 'code', label: 'รหัส' }, { key: 'name', label: 'รายการ' }, { key: 'amount', label: 'ต่อเดือน', format: 'money' },
          { key: 'balance', label: 'คงเหลือ', format: 'money' }, { key: 'taxable', label: 'คิดภาษี', format: 'boolean' }, { key: 'sso', label: 'คิดประกันสังคม', format: 'boolean' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' },
        ] },
        { path: 'recent', label: 'ประวัติเงินเดือน', columns: [
          { key: 'run_no', label: 'รอบ' }, { key: 'period', label: 'เดือน', format: 'month' }, { key: 'gross', label: 'รายได้', format: 'money' },
          { key: 'total_deductions', label: 'หัก', format: 'money' }, { key: 'net', label: 'สุทธิ', format: 'money' }, { key: 'run_status', label: 'สถานะ', format: 'status' },
        ] },
      ],
      actions: [
        { id: 'item', label: 'เพิ่มรายได้/รายการหักประจำ', method: 'POST', endpoint: '/profiles/:id/items', perm: PROFILE_WRITE, fields: itemFields },
      ],
    },
    items: {
      kind: 'list', title: 'รายได้/รายการหักประจำ', endpoint: '/items', perm: PROFILE_READ,
      filters: [
        { name: 'q', label: 'ค้นหารหัส ชื่อรายการ หรือพนักงาน', type: 'text' },
        { name: 'kind', label: 'ประเภท', type: 'select', options: [{ value: 'earning', label: 'รายได้' }, { value: 'deduction', label: 'รายการหัก' }] },
        { name: 'active', label: 'สถานะ', type: 'select', options: yesNo },
      ],
      columns: [
        { key: 'employee_code', label: 'รหัส' }, { key: 'employee_name', label: 'พนักงาน' }, { key: 'kind_label', label: 'ประเภท' }, { key: 'name', label: 'รายการ' },
        { key: 'amount', label: 'ต่อเดือน', format: 'money' }, { key: 'balance', label: 'คงเหลือ', format: 'money' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      rowActions: [
        { id: 'edit', label: 'แก้ไข', method: 'PATCH', endpoint: '/items/:id', perm: PROFILE_WRITE,
          fields: [{ name: 'amount', label: 'จำนวนเงินต่อเดือน', type: 'number', step: 0.01 }, { name: 'balance', label: 'ยอดคงเหลือ (เงินกู้)', type: 'number', step: 0.01 }, { name: 'active', label: 'ใช้งาน', type: 'boolean', default: true }] },
        { id: 'delete', label: 'ลบ', method: 'DELETE', endpoint: '/items/:id', perm: PROFILE_WRITE, tone: 'danger', confirm: 'ลบรายการนี้?' },
      ],
      empty: 'ยังไม่มีรายการประจำ — เพิ่มจากหน้าข้อมูลเงินเดือนของพนักงาน',
    },

    /* ---- reports ---- */
    bankRuns: pickRun('เลือกรอบ: โอนเงินเดือนเข้าธนาคาร', 'bankTransfer'),
    bankTransfer: {
      kind: 'list', title: 'รายการโอนเงินเดือนเข้าธนาคาร', endpoint: '/runs/:id/bank-transfer', rows: 'rows', perm: READ,
      columns: [
        { key: 'bank_name', label: 'ธนาคาร' }, { key: 'bank_account_last4', label: 'บัญชี 4 หลักท้าย' },
        { key: 'employee_code', label: 'รหัสพนักงาน' }, { key: 'employee_name', label: 'ชื่อบัญชี/พนักงาน' }, { key: 'net', label: 'จำนวนเงินโอน', format: 'money' },
      ],
      rowLink: { screen: 'payslipDetail' }, empty: 'ไม่มีรายการโอน',
    },
    ssoRuns: pickRun('เลือกรอบ: ประกันสังคม สปส.1-10', 'ssoReport'),
    ssoReport: {
      kind: 'list', title: 'แบบรายการแสดงการส่งเงินสมทบ สปส.1-10 (ส่วนที่ 2)', endpoint: '/runs/:id/sso', rows: 'rows', perm: READ,
      columns: [
        { key: 'seq', label: 'ลำดับ', format: 'qty' }, { key: 'id_card', label: 'เลขประจำตัวประชาชน' }, { key: 'employee_code', label: 'รหัสพนักงาน' },
        { key: 'employee_name', label: 'ชื่อ-สกุล' }, { key: 'wage', label: 'ค่าจ้าง', format: 'money' }, { key: 'sso_employee', label: 'เงินสมทบผู้ประกันตน', format: 'money' },
        { key: 'sso_employer', label: 'เงินสมทบนายจ้าง', format: 'money' },
      ],
      empty: 'ไม่มีผู้ประกันตนในรอบนี้',
    },
    pnd1Runs: pickRun('เลือกรอบ: ภ.ง.ด.1', 'pnd1Report'),
    pnd1Report: {
      kind: 'detail', title: 'ภ.ง.ด.1 รายเดือน', endpoint: '/runs/:id/pnd1', perm: READ, heading: 'period_label', printable: true,
      fields: [
        { key: 'run_no', label: 'รอบเงินเดือน' }, { key: 'pay_date', label: 'วันที่จ่าย', format: 'date' }, { key: 'people', label: 'จำนวนราย', format: 'qty' },
        { key: 'total_income', label: 'รวมเงินได้ 40(1)', format: 'money' }, { key: 'total_tax', label: 'รวมภาษีที่หักนำส่ง', format: 'money' }, { key: 'total_tax_text', label: 'ตัวอักษร' },
      ],
      lines: [{ path: 'rows', label: 'ใบแนบ ภ.ง.ด.1', columns: [
        { key: 'seq', label: 'ลำดับ', format: 'qty' }, { key: 'tax_id', label: 'เลขประจำตัวผู้เสียภาษี' }, { key: 'employee_name', label: 'ชื่อผู้มีเงินได้' },
        { key: 'income', label: 'จำนวนเงินได้', format: 'money' }, { key: 'wht', label: 'ภาษีที่หักนำส่ง', format: 'money' }, { key: 'condition', label: 'เงื่อนไข' },
      ] }],
    },
    certificates: {
      kind: 'list', title: 'หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)', endpoint: '/certificates', perm: READ,
      filters: [{ name: 'year', label: 'ปีภาษี (ค.ศ. หรือ พ.ศ., เว้นว่าง = ปีนี้)', type: 'number' }, { name: 'q', label: 'ค้นหารหัสหรือชื่อ', type: 'text' }],
      columns: [
        { key: 'year_be', label: 'ปีภาษี' }, { key: 'employee_code', label: 'รหัส' }, { key: 'employee_name', label: 'ชื่อ' }, { key: 'months', label: 'จำนวนเดือน', format: 'qty' },
        { key: 'income', label: 'เงินได้ทั้งปี', format: 'money' }, { key: 'tax', label: 'ภาษีที่หัก', format: 'money' }, { key: 'sso', label: 'ประกันสังคม', format: 'money' }, { key: 'pvd', label: 'กองทุนฯ', format: 'money' },
      ],
      rowLink: { screen: 'certificate' }, empty: 'ยังไม่มีรอบเงินเดือนที่จ่ายแล้วในปีนี้',
    },
    certificate: {
      kind: 'detail', title: 'หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ', endpoint: '/certificates/:id', perm: READ, heading: 'heading',
      print: { title: 'หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)', copyLabel: true, signatures: ['ผู้จ่ายเงิน (ผู้มีหน้าที่หักภาษี ณ ที่จ่าย)'] },
      fields: [
        { key: 'employee_name', label: 'ผู้ถูกหักภาษี ณ ที่จ่าย' }, { key: 'payee_tax_id', label: 'เลขประจำตัวผู้เสียภาษีอากร' }, { key: 'employee_code', label: 'รหัสพนักงาน' },
        { key: 'year_be', label: 'ปีภาษี' }, { key: 'form', label: 'ลำดับที่ในแบบ' }, { key: 'income_type', label: 'ประเภทเงินได้' },
        { key: 'income', label: 'จำนวนเงินที่จ่าย', format: 'money' }, { key: 'tax', label: 'ภาษีที่หักและนำส่งไว้', format: 'money' }, { key: 'tax_text', label: 'รวมเงินภาษีที่หักนำส่ง (ตัวอักษร)' },
        { key: 'sso', label: 'เงินสมทบกองทุนประกันสังคม', format: 'money' }, { key: 'pvd', label: 'เงินสะสมกองทุนสำรองเลี้ยงชีพ', format: 'money' },
        { key: 'payer_condition', label: 'ผู้จ่ายเงิน' },
      ],
      lines: [{ path: 'months', label: 'รายละเอียดรายเดือน', columns: [
        { key: 'period_label', label: 'เดือน' }, { key: 'income', label: 'เงินได้', format: 'money' }, { key: 'wht', label: 'ภาษี', format: 'money' },
        { key: 'sso_employee', label: 'ประกันสังคม', format: 'money' }, { key: 'pvd_employee', label: 'กองทุนฯ', format: 'money' },
      ] }],
    },

    /* ---- settings ---- */
    settings: {
      kind: 'detail', title: 'ตั้งค่าเงินเดือน', endpoint: '/settings', perm: READ, heading: 'title', edit: 'settingsEdit',
      fields: [
        { key: 'ssoEmployeeRate', label: 'ประกันสังคม ลูกจ้าง %', format: 'qty' }, { key: 'ssoEmployerRate', label: 'ประกันสังคม นายจ้าง %', format: 'qty' },
        { key: 'ssoWageMin', label: 'ฐานค่าจ้างต่ำสุด', format: 'money' }, { key: 'ssoWageMax', label: 'เพดานค่าจ้าง', format: 'money' },
        { key: 'ssoMaxContribution', label: 'เงินสมทบสูงสุด/เดือน', format: 'money' }, { key: 'ssoIncludeOvertime', label: 'นับ OT เป็นค่าจ้างประกันสังคม', format: 'boolean' },
        { key: 'ssoEmployerAccount', label: 'เลขที่บัญชีนายจ้าง (สปส.)' }, { key: 'ssoBranch', label: 'ลำดับที่สาขา (สปส.)' },
        { key: 'expenseRatePct', label: 'หักค่าใช้จ่าย 40(1) %', format: 'qty' }, { key: 'expenseCap', label: 'หักค่าใช้จ่ายไม่เกิน', format: 'money' },
        { key: 'personalAllowance', label: 'ลดหย่อนส่วนตัว', format: 'money' }, { key: 'spouseAllowance', label: 'ลดหย่อนคู่สมรส', format: 'money' },
        { key: 'childAllowance', label: 'ลดหย่อนบุตร/คน', format: 'money' }, { key: 'child2018Allowance', label: 'บุตรคนที่ 2+ เกิดตั้งแต่ 2561/คน', format: 'money' },
        { key: 'parentAllowance', label: 'ลดหย่อนบิดามารดา/คน', format: 'money' }, { key: 'lifeInsuranceCap', label: 'เพดานเบี้ยประกันชีวิต', format: 'money' },
        { key: 'healthInsuranceCap', label: 'เพดานเบี้ยประกันสุขภาพ', format: 'money' }, { key: 'lifeHealthCap', label: 'เพดานประกันชีวิต+สุขภาพ', format: 'money' },
        { key: 'parentHealthCap', label: 'เพดานประกันสุขภาพบิดามารดา', format: 'money' }, { key: 'homeLoanCap', label: 'เพดานดอกเบี้ยบ้าน', format: 'money' },
        { key: 'pvdRateCapPct', label: 'กองทุนสำรองฯ ลดหย่อนได้ไม่เกิน % ของค่าจ้าง', format: 'qty' }, { key: 'pvdCap', label: 'กองทุนสำรองฯ ไม่เกิน', format: 'money' },
        { key: 'hoursPerDay', label: 'ชั่วโมงทำงานต่อวัน', format: 'qty' }, { key: 'daysPerMonth', label: 'หารเงินเดือนเป็นรายวันด้วย', format: 'qty' },
        { key: 'proration', label: 'วิธีคิดเงินเดือนไม่เต็มเดือน' }, { key: 'defaultDailyWorkDays', label: 'วันทำงานรายวันเริ่มต้น', format: 'qty' },
        { key: 'otX15', label: 'OT วันทำงาน (เท่า)', format: 'qty' }, { key: 'otX1', label: 'ทำงานวันหยุด รายเดือน (เท่า)', format: 'qty' },
        { key: 'otX2', label: 'ทำงานวันหยุด รายวัน (เท่า)', format: 'qty' }, { key: 'otX3', label: 'OT วันหยุด (เท่า)', format: 'qty' },
        { key: 'updatedAt', label: 'แก้ไขล่าสุด', format: 'datetime' },
      ],
      lines: [{ path: 'brackets', label: 'อัตราภาษีเงินได้บุคคลธรรมดา (เงินได้สุทธิ)', columns: [{ key: 'from', label: 'ตั้งแต่', format: 'money' }, { key: 'label', label: 'ช่วง' }, { key: 'rate', label: 'อัตรา %', format: 'qty' }] }],
    },
    settingsEdit: {
      kind: 'form', title: 'แก้ไขตั้งค่าเงินเดือน', method: 'PUT', endpoint: '/settings', load: '/settings', perm: 'payroll.setup.write',
      fields: [
        { name: 'ssoEmployeeRate', label: 'ประกันสังคม ลูกจ้าง %', type: 'number', step: 0.1, help: 'กฎหมายปัจจุบัน 5% — เปลี่ยนเมื่อรัฐประกาศลดอัตราชั่วคราว' },
        { name: 'ssoEmployerRate', label: 'ประกันสังคม นายจ้าง %', type: 'number', step: 0.1 },
        { name: 'ssoWageMin', label: 'ฐานค่าจ้างต่ำสุด (บาท)', type: 'number', step: 1 },
        { name: 'ssoWageMax', label: 'เพดานค่าจ้าง (บาท)', type: 'number', step: 1, help: 'ตรวจสอบประกาศสำนักงานประกันสังคมเรื่องการปรับเพดานค่าจ้าง' },
        { name: 'ssoIncludeOvertime', label: 'นับ OT เป็นค่าจ้างประกันสังคม', type: 'boolean' },
        { name: 'ssoEmployerAccount', label: 'เลขที่บัญชีนายจ้าง (สปส.)', type: 'text' },
        { name: 'ssoBranch', label: 'ลำดับที่สาขา (สปส.)', type: 'text' },
        { name: 'expenseRatePct', label: 'หักค่าใช้จ่าย 40(1) %', type: 'number', step: 1 },
        { name: 'expenseCap', label: 'หักค่าใช้จ่ายไม่เกิน (บาท)', type: 'number', step: 1 },
        { name: 'personalAllowance', label: 'ลดหย่อนส่วนตัว', type: 'number', step: 1 },
        { name: 'spouseAllowance', label: 'ลดหย่อนคู่สมรส', type: 'number', step: 1 },
        { name: 'childAllowance', label: 'ลดหย่อนบุตร/คน', type: 'number', step: 1 },
        { name: 'child2018Allowance', label: 'บุตรคนที่ 2+ เกิดตั้งแต่ 2561/คน', type: 'number', step: 1 },
        { name: 'parentAllowance', label: 'ลดหย่อนบิดามารดา/คน', type: 'number', step: 1 },
        { name: 'lifeInsuranceCap', label: 'เพดานเบี้ยประกันชีวิต', type: 'number', step: 1 },
        { name: 'healthInsuranceCap', label: 'เพดานเบี้ยประกันสุขภาพ', type: 'number', step: 1 },
        { name: 'lifeHealthCap', label: 'เพดานประกันชีวิต+สุขภาพรวม', type: 'number', step: 1 },
        { name: 'parentHealthCap', label: 'เพดานประกันสุขภาพบิดามารดา', type: 'number', step: 1 },
        { name: 'homeLoanCap', label: 'เพดานดอกเบี้ยบ้าน', type: 'number', step: 1 },
        { name: 'pvdRateCapPct', label: 'กองทุนสำรองฯ ลดหย่อนได้ไม่เกิน % ของค่าจ้าง', type: 'number', step: 1 },
        { name: 'pvdCap', label: 'กองทุนสำรองฯ ไม่เกิน (บาท)', type: 'number', step: 1 },
        { name: 'hoursPerDay', label: 'ชั่วโมงทำงานต่อวัน', type: 'number', step: 0.5 },
        { name: 'daysPerMonth', label: 'หารเงินเดือนเป็นรายวันด้วย (วัน)', type: 'number', step: 1, help: 'พ.ร.บ.คุ้มครองแรงงาน: 30' },
        { name: 'proration', label: 'วิธีคิดเงินเดือนไม่เต็มเดือน', type: 'select', options: [{ value: 'calendar', label: 'ตามจำนวนวันจริงของเดือน' }, { value: 'days30', label: 'เงินเดือน ÷ 30 × จำนวนวัน' }] },
        { name: 'defaultDailyWorkDays', label: 'วันทำงานรายวันเริ่มต้น (ถ้าไม่ได้กรอก)', type: 'number', step: 1 },
        { name: 'otX15', label: 'OT วันทำงาน (เท่า)', type: 'number', step: 0.1 },
        { name: 'otX1', label: 'ทำงานวันหยุด รายเดือน (เท่า)', type: 'number', step: 0.1 },
        { name: 'otX2', label: 'ทำงานวันหยุด รายวัน (เท่า)', type: 'number', step: 0.1 },
        { name: 'otX3', label: 'OT วันหยุด (เท่า)', type: 'number', step: 0.1 },
      ],
      submitLabel: 'บันทึกการตั้งค่า', after: { screen: 'settings' },
    },
  },
  widgets: [
    { id: 'payroll-kpi', kind: 'kpi', title: 'เงินเดือน', endpoint: '/summary', perm: READ, size: 'md', href: 'runs',
      items: [
        { key: 'activeProfiles', label: 'พนักงานในระบบเงินเดือน', format: 'qty' },
        { key: 'toApprove', label: 'รอบรออนุมัติ', format: 'qty', tone: 'warn' },
        { key: 'lastNet', label: 'จ่ายสุทธิรอบล่าสุด', format: 'money' },
        { key: 'lastCost', label: 'ต้นทุนค่าแรงรอบล่าสุด', format: 'money' },
      ] },
    { id: 'payroll-pipeline', kind: 'pipeline', title: 'รอบเงินเดือน', endpoint: '/summary', perm: READ, size: 'lg', href: 'runs',
      rows: 'rows', field: 'status', stages: runStatuses.filter((x) => x.value !== 'cancelled'), title2: 'no', subtitle: 'period_label', link: { screen: 'runDetail' } },
    { id: 'payroll-trend', kind: 'trend', title: 'เงินเดือนจ่ายสุทธิ 6 เดือน', endpoint: '/summary', perm: READ, size: 'md', href: 'runs', rows: 'months', x: 'month', y: 'net', format: 'money' },
  ],
});
