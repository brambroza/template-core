/**
 * Suggested Thai roles so a new installation does not start with an empty roles list.
 * Identity cannot read other modules, so this is a static list of permission keys; `POST /roles/from-template`
 * keeps only the keys whose module is installed (the client sends the installed module ids from /api/_catalog).
 * `tests/ui/role-templates.test.ts` checks every key against the real module.json files of this repo.
 * Customers add their own templates here (or create roles by hand) — nothing else depends on this list.
 */
export interface RoleTemplate {
  id: string;
  name: string;
  description: string;
  permissions: string[];
}

/** Self-service every employee needs: ask for approval, claim expenses, leave + check-in, book rooms/cars, report IT/asset/machine problems, get notified. */
const SELF_SERVICE = [
  'approvals.request.read', 'approvals.request.write',
  'expense.claim.read', 'expense.claim.write',
  'hr.leave.request', 'hr.attendance.self',
  'booking.resource.read', 'booking.book.create',
  'helpdesk.ticket.create', 'helpdesk.kb.read',
  'assets.asset.read', 'assets.repair.report',
  'maintenance.machine.read', 'maintenance.wo.report',
  'automation.notify.read', 'payroll.payslip.self',
];

const t = (id: string, name: string, description: string, extra: string[], base = SELF_SERVICE): RoleTemplate =>
  ({ id, name, description, permissions: [...new Set([...base, ...extra])].sort() });

export const ROLE_TEMPLATES: RoleTemplate[] = [
  t('executive', 'ผู้บริหาร', 'เห็นภาพรวมและตัวเลขทุกฝ่าย อนุมัติคำขอ ใบเบิก ใบลา และใบสั่งซื้อ (ไม่แก้ไขข้อมูลหน้างาน)', [
    'approvals.request.approve', 'assets.finance.read', 'automation.rule.read', 'booking.book.approve', 'costing.cost.read',
    'crm.lead.read', 'crm.quote.read', 'expense.claim.approve', 'helpdesk.ticket.read', 'hr.employee.read', 'hr.attendance.read', 'hr.leave.approve',
    'identity.user.read', 'inventory.stock.read', 'master.item.read', 'master.partner.read', 'production.bom.read', 'production.order.read',
    // wave 8: the executive is the top of the approval limits — POs above the standard limit and expense claims over the monthly limit
    'projects.project.read', 'projects.timesheet.approve', 'purchasing.po.read', 'purchasing.po.approve', 'purchasing.po.approve-high', 'expense.claim.approve-over-limit',
    'quality.plan.read', 'quality.inspection.read', 'quality.ncr.read', 'sales.order.read', 'sales.receivable.read',
    'accounting.report.read', 'accounting.journal.read', 'payroll.run.read', 'payroll.run.approve', 'contracts.contract.read', 'contracts.billing.read',
  ]),
  t('staff', 'พนักงานทั่วไป', 'บริการตนเอง: ขออนุมัติ เบิกค่าใช้จ่าย ลา ลงเวลา จองห้อง/รถ แจ้งปัญหา แจ้งซ่อม และรับการแจ้งเตือน — ไม่เห็นข้อมูลของคนอื่นและตัวเลขการเงิน', []),
  t('supervisor', 'หัวหน้างาน', 'บริการตนเอง + อนุมัติคำขอ ใบเบิก ใบลา การจอง และดูเวลาทำงาน/งานของทีม', [
    'approvals.request.approve', 'expense.claim.approve', 'hr.employee.read', 'hr.attendance.read', 'hr.leave.approve', 'booking.book.approve',
    'projects.project.read', 'inventory.stock.read', 'production.order.read', 'quality.inspection.read',
  ]),
  t('hr', 'ฝ่ายบุคคล', 'ทะเบียนพนักงาน แผนก ตำแหน่ง วันหยุด ประเภทการลา อนุมัติใบลา และจัดการเวลาทำงาน', [
    'hr.employee.read', 'hr.employee.write', 'hr.setup.write', 'hr.leave.approve', 'hr.attendance.read', 'hr.attendance.manage',
    'approvals.request.approve', 'identity.user.read',
    'payroll.profile.read', 'payroll.profile.write', 'payroll.run.read', 'payroll.run.write', 'payroll.setup.write',
  ]),
  t('accounting', 'บัญชีและการเงิน', 'อนุมัติและจ่ายใบเบิก/เงินทดรอง ทรัพย์สินและค่าเสื่อม ใบกำกับภาษี ใบเสร็จ ลูกหนี้ และต้นทุน', [
    'expense.claim.approve', 'expense.claim.pay', 'expense.category.write',
    'assets.asset.write', 'assets.asset.dispose', 'assets.audit.run', 'assets.finance.read',
    // sales.order.write: billing staff confirm the MA installment orders Sales drafts from contracts before invoicing them (bugs-0.4 ID-02)
    'costing.cost.read', 'costing.cost.write', 'sales.order.read', 'sales.order.write', 'sales.invoice.write', 'sales.receipt.write', 'sales.receivable.read',
    'purchasing.po.read', 'master.item.read', 'master.partner.read', 'inventory.stock.read', 'approvals.request.approve',
    'accounting.journal.read', 'accounting.journal.write', 'accounting.journal.post', 'accounting.account.write', 'accounting.period.close', 'accounting.report.read',
    'payroll.run.read', 'payroll.run.pay', 'contracts.contract.read', 'contracts.billing.read', 'contracts.billing.write',
  ]),
  t('purchasing', 'จัดซื้อ', 'ใบสั่งซื้อ ผู้ขาย รับสินค้าตามใบสั่งซื้อ ส่งคืนผู้ขาย และพิจารณาใบขอซื้อที่ส่งมาถึง (ไม่อนุมัติใบสั่งซื้อของตัวเอง)', [
    // po.return: QC-rejected material in QC-HOLD goes back to the supplier (bugs-0.4 ID-03 — no suggested role could do it)
    // no purchasing.po.approve: the buyer raises POs, a manager/executive approves them (segregation of duties, wave 8)
    // approvals.request.approve: purchase requests (PR) route จัดซื้อ → MD; the approvals module only lets the person on the chain decide
    'purchasing.po.read', 'purchasing.po.write', 'purchasing.po.receive', 'purchasing.po.return', 'master.item.read', 'master.partner.read', 'master.partner.write',
    'inventory.stock.read', 'quality.inspection.read', 'approvals.request.approve',
  ]),
  t('sales', 'ฝ่ายขาย', 'ลีด โอกาสขาย ใบเสนอราคา ใบสั่งขาย ลูกค้า และติดตามลูกหนี้', [
    'crm.lead.read', 'crm.lead.write', 'crm.activity.write', 'crm.quote.read', 'crm.quote.write', 'crm.quote.decide',
    'contracts.contract.read', 'contracts.contract.write', 'contracts.contract.activate', 'contracts.visit.read', 'contracts.visit.plan',
    'sales.order.read', 'sales.order.write', 'sales.receivable.read', 'master.item.read', 'master.partner.read', 'master.partner.write', 'inventory.stock.read',
  ]),
  t('warehouse', 'คลังสินค้า', 'รับ-จ่าย-โอนสต็อก รับของตามใบสั่งซื้อ และส่งของตามใบสั่งขาย', [
    'inventory.stock.read', 'inventory.move.write', 'purchasing.po.read', 'purchasing.po.receive', 'sales.order.read', 'sales.order.deliver',
    'master.item.read', 'production.order.read',
  ]),
  t('technician', 'ช่างซ่อมบำรุง', 'รับงานซ่อม ปิดงานซ่อม ดูประวัติเครื่องจักร ดูสต็อกอะไหล่ ออกงานบริการตามสัญญา MA รับงานแจ้งซ่อม และลงชั่วโมงงานโครงการ', [
    'maintenance.machine.read', 'maintenance.wo.report', 'maintenance.wo.work', 'inventory.stock.read', 'master.item.read',
    // round-2 N3: service companies send the same technicians on MA visits and building/equipment tickets, and they log project hours
    'master.partner.read', 'contracts.contract.read', 'contracts.visit.read', 'contracts.visit.work', 'helpdesk.ticket.read', 'helpdesk.ticket.work',
    'projects.project.read', 'projects.timesheet.log',
  ]),
  t('qc', 'QC ควบคุมคุณภาพ', 'แผนการตรวจ บันทึกผลตรวจ ออก/ปิด NCR ปล่อยของจากคลังกักกันตามผลตัดสิน และรับเรื่องร้องเรียนลูกค้า', [
    'quality.plan.read', 'quality.inspection.read', 'quality.inspection.record', 'quality.ncr.read', 'quality.ncr.write',
    'inventory.stock.read', 'inventory.hold.release', 'master.item.read', 'master.partner.read', 'production.order.read', 'purchasing.po.read',
    // wave 8: the QC head verifies corrective actions and closes NCRs; customer complaints (after-sales tickets) land with QC
    'quality.ncr.close', 'helpdesk.ticket.read', 'helpdesk.ticket.work',
  ]),
  t('it', 'ไอที / helpdesk', 'รับเรื่องแจ้งปัญหา แก้ไข เขียนฐานความรู้ ตั้งค่า SLA และดูแลทะเบียนทรัพย์สินไอที', [
    'helpdesk.ticket.read', 'helpdesk.ticket.work', 'helpdesk.kb.write', 'helpdesk.setup.write',
    'assets.asset.write', 'assets.audit.run', 'identity.user.read',
    'contracts.contract.read', 'contracts.visit.read', 'contracts.visit.work',
    // round-2 N3: "บันทึกเรื่องจากลูกค้า" needs the customer list; IT staff also log hours on IT projects
    'master.partner.read', 'projects.project.read', 'projects.timesheet.log',
  ]),
  t('planner', 'วางแผนการผลิต', 'สูตรการผลิต (BOM) ใบสั่งผลิต ปล่อย/ปิดงานผลิต ดูสต็อก เครื่องจักร ผล QC และต้นทุน', [
    // wave 8: the factory demo's planner used a hand-made production.* role; this is the suggested equivalent
    'production.bom.read', 'production.bom.write', 'production.order.read', 'production.order.write', 'master.item.read', 'inventory.stock.read',
    'maintenance.machine.read', 'quality.inspection.read', 'costing.cost.read', 'sales.order.read', 'purchasing.po.read',
  ]),
  t('pm', 'ผู้จัดการโครงการ', 'สร้างและดูแลโครงการ งาน งวดงาน ลงชั่วโมง และอนุมัติชั่วโมงทำงานของทีม', [
    'projects.project.read', 'projects.project.write', 'projects.task.write', 'projects.timesheet.log', 'projects.timesheet.approve',
    'crm.lead.read', 'master.partner.read', 'approvals.request.approve',
  ]),
];

/**
 * Does `perm` belong to one of the installed modules? Permission prefixes are module ids,
 * except where the id is longer (`master.item.read` belongs to `master-data`).
 */
export function permInstalled(perm: string, modules: string[]): boolean {
  const prefix = perm.split('.')[0];
  return modules.some((m) => m === prefix || m.startsWith(`${prefix}-`));
}

/** The template's permissions split into those the installation has and those it doesn't (`modules` undefined = keep all). */
export function applyTemplate(tpl: RoleTemplate, modules?: string[]): { permissions: string[]; skipped: string[] } {
  if (!modules) return { permissions: tpl.permissions, skipped: [] };
  return {
    permissions: tpl.permissions.filter((p) => permInstalled(p, modules)),
    skipped: tpl.permissions.filter((p) => !permInstalled(p, modules)),
  };
}
