/**
 * What rules can react to. Each event lists the fields a condition or a message may use,
 * a Thai label, which module publishes it and where a notification should link to.
 */
import type { EventType } from '@erp/contracts';

export interface EventInfo {
  type: EventType;
  module: string;
  label: string;
  fields: { key: string; label: string; numeric?: boolean }[];
  /** default message, with {{field}} placeholders */
  message: string;
  /** web path for "open" on a notification, with {{field}} placeholders */
  link?: string;
  level: 'info' | 'warn' | 'stop' | 'ok';
  /** fields holding a user id (identity) — a notify action can be addressed to them: `to: 'field:<key>'` */
  userFields?: { key: string; label: string }[];
  /**
   * A decision the recipient can make from LINE: personal LINE pushes of this event become a card with an "อนุมัติ" button
   * (+ "เปิดดู" when PUBLIC_APP_URL is set). `target` = the module that decides (it subscribes to automation.line_decision),
   * `entityField` = the record id in the event, `title` = what is being approved ({{field}} placeholders). Only recipients named
   * by a `deciders` field get the button (the requester told about the same event gets plain text).
   * Documents approved by a permission rather than a named person (PO, expense claim) set `approverPerms`: a personal LINE action
   * `to: 'approvers'` then goes to every linked user whose last-seen permissions hold one of them, except the users in `exclude`
   * fields (whoever raised it — they may not approve their own).
   */
  decide?: { target: 'approvals.request' | 'hr.leave' | 'purchasing.po' | 'expense.claim'; entityField: string; title: string; deciders: string[]; approverPerms?: string[]; exclude?: string[] };
}

export const EVENTS: EventInfo[] = [
  { type: 'inventory.low_stock', module: 'inventory', label: 'สต็อกต่ำกว่าจุดสั่งซื้อ', level: 'warn',
    fields: [{ key: 'itemCode', label: 'รหัสสินค้า' }, { key: 'itemName', label: 'ชื่อสินค้า' }, { key: 'warehouseCode', label: 'คลัง' }, { key: 'onHand', label: 'คงเหลือ', numeric: true }, { key: 'minQty', label: 'จุดสั่งซื้อ', numeric: true }],
    message: '{{itemCode}} {{itemName}} ที่คลัง {{warehouseCode}} เหลือ {{onHand}} ต่ำกว่าจุดสั่งซื้อ {{minQty}}', link: '/m/inventory/stockCard/{{itemId}}' },
  { type: 'maintenance.breakdown_reported', module: 'maintenance', label: 'มีการแจ้งเครื่องเสีย', level: 'stop',
    fields: [{ key: 'machineCode', label: 'รหัสเครื่อง' }, { key: 'machineName', label: 'ชื่อเครื่อง' }, { key: 'title', label: 'อาการ' }, { key: 'workOrderNo', label: 'เลขที่งานซ่อม' }],
    message: 'เครื่อง {{machineCode}} {{machineName}} เสีย: {{title}} ({{workOrderNo}})', link: '/m/maintenance/woDetail/{{workOrderId}}' },
  { type: 'maintenance.work_completed', module: 'maintenance', label: 'ซ่อมเสร็จ', level: 'ok',
    fields: [{ key: 'machineCode', label: 'รหัสเครื่อง' }, { key: 'workOrderNo', label: 'เลขที่งานซ่อม' }, { key: 'kind', label: 'ประเภทงาน' }, { key: 'downtimeMinutes', label: 'เครื่องหยุด (นาที)', numeric: true }],
    message: 'ซ่อม {{machineCode}} เสร็จแล้ว ({{workOrderNo}}) เครื่องหยุด {{downtimeMinutes}} นาที', link: '/m/maintenance/woDetail/{{workOrderId}}' },
  { type: 'purchasing.po_created', module: 'purchasing', label: 'สร้างใบสั่งซื้อใหม่', level: 'info',
    fields: [{ key: 'poNo', label: 'เลขที่ PO' }, { key: 'supplierName', label: 'ผู้ขาย' }, { key: 'gross', label: 'ยอดรวม', numeric: true }],
    userFields: [{ key: 'createdById', label: 'ผู้สร้างใบสั่งซื้อ' }],
    message: 'ใบสั่งซื้อ {{poNo}} จาก {{supplierName}} ยอด {{gross}} บาท รออนุมัติ', link: '/m/purchasing/poDetail/{{poId}}',
    decide: { target: 'purchasing.po', entityField: 'poId', title: 'ใบสั่งซื้อ {{poNo}} {{supplierName}} {{gross}} บาท', deciders: [],
      approverPerms: ['purchasing.po.approve', 'purchasing.po.approve-high'], exclude: ['createdById'] } },
  { type: 'purchasing.po_approved', module: 'purchasing', label: 'อนุมัติใบสั่งซื้อแล้ว', level: 'info',
    fields: [{ key: 'poNo', label: 'เลขที่ PO' }, { key: 'supplierName', label: 'ผู้ขาย' }, { key: 'gross', label: 'ยอดรวม', numeric: true }],
    message: 'อนุมัติ {{poNo}} ({{supplierName}}) ยอด {{gross}} บาทแล้ว', link: '/m/purchasing/poDetail/{{poId}}' },
  { type: 'purchasing.goods_received', module: 'purchasing', label: 'รับของเข้าคลัง', level: 'ok',
    fields: [{ key: 'poNo', label: 'เลขที่ PO' }, { key: 'supplierName', label: 'ผู้ขาย' }, { key: 'warehouseCode', label: 'คลัง' }],
    message: 'รับของตาม {{poNo}} จาก {{supplierName}} เข้าคลัง {{warehouseCode}} แล้ว', link: '/m/purchasing/poDetail/{{poId}}' },
  { type: 'sales.order_confirmed', module: 'sales', label: 'ยืนยันใบสั่งขาย', level: 'info',
    fields: [{ key: 'orderNo', label: 'เลขที่ SO' }, { key: 'customerName', label: 'ลูกค้า' }, { key: 'total', label: 'ยอดรวม', numeric: true }],
    message: 'ยืนยันคำสั่งซื้อ {{orderNo}} ของ {{customerName}} ยอด {{total}} บาท', link: '/m/sales/soDetail/{{orderId}}' },
  { type: 'sales.delivered', module: 'sales', label: 'ส่งของให้ลูกค้าแล้ว', level: 'ok',
    fields: [{ key: 'orderNo', label: 'เลขที่ SO' }, { key: 'warehouseCode', label: 'คลัง' }],
    message: 'ส่งของตาม {{orderNo}} แล้ว', link: '/m/sales/soDetail/{{orderId}}' },
  { type: 'sales.invoiced', module: 'sales', label: 'ออกใบกำกับภาษี', level: 'ok',
    fields: [{ key: 'invoiceNo', label: 'เลขที่ใบกำกับ' }, { key: 'gross', label: 'ยอดรวม', numeric: true }],
    message: 'ออกใบกำกับ {{invoiceNo}} ยอด {{gross}} บาท', link: '/m/sales/invoice/{{invoiceId}}' },
  { type: 'sales.payment_received', module: 'sales', label: 'รับชำระเงินจากลูกค้า', level: 'ok',
    fields: [{ key: 'receiptNo', label: 'เลขที่ใบเสร็จ' }, { key: 'customerName', label: 'ลูกค้า' }, { key: 'received', label: 'รับจริง', numeric: true }, { key: 'whtAmount', label: 'ภาษีหัก ณ ที่จ่าย', numeric: true }, { key: 'kind', label: 'ประเภท (payment/deposit)' }],
    message: 'รับเงินจาก {{customerName}} {{received}} บาท ({{receiptNo}})', link: '/m/sales/receipt/{{receiptId}}' },
  { type: 'production.completed', module: 'production', label: 'รายงานผลผลิต', level: 'ok',
    fields: [{ key: 'orderNo', label: 'เลขที่ใบสั่งผลิต' }, { key: 'item.itemCode', label: 'สินค้า' }, { key: 'qty', label: 'จำนวนที่ผลิตได้', numeric: true }],
    message: 'ผลิต {{item.itemCode}} ได้ {{qty}} ชิ้น ({{orderNo}})', link: '/m/production/moDetail/{{orderId}}' },

  /* ---- office / service modules ---- */
  { type: 'approvals.request_submitted', module: 'approvals', label: 'มีคำขออนุมัติรอพิจารณา', level: 'warn',
    fields: [{ key: 'no', label: 'เลขที่คำขอ' }, { key: 'title', label: 'เรื่อง' }, { key: 'typeName', label: 'ประเภทคำขอ' }, { key: 'requesterName', label: 'ผู้ขอ' },
      { key: 'amount', label: 'จำนวนเงิน', numeric: true }, { key: 'nextApproverName', label: 'ผู้อนุมัติขั้นนี้' }, { key: 'step', label: 'ขั้นที่', numeric: true }],
    userFields: [{ key: 'nextApproverId', label: 'ผู้อนุมัติขั้นนี้' }, { key: 'delegateId', label: 'ผู้อนุมัติแทน (ช่วงผู้อนุมัติไม่อยู่)' }, { key: 'requesterId', label: 'ผู้ขอ' }],
    message: 'คำขอ {{no}} "{{title}}" ({{typeName}}) จาก {{requesterName}} รอ {{nextApproverName}} อนุมัติ (ขั้นที่ {{step}}/{{stepCount}})', link: '/m/approvals/requestDetail/{{requestId}}',
    decide: { target: 'approvals.request', entityField: 'requestId', title: 'คำขอ {{no}} "{{title}}"', deciders: ['nextApproverId', 'delegateId'] } },
  { type: 'approvals.request_decided', module: 'approvals', label: 'คำขออนุมัติมีผลแล้ว', level: 'info',
    fields: [{ key: 'no', label: 'เลขที่คำขอ' }, { key: 'title', label: 'เรื่อง' }, { key: 'decision', label: 'ผล (approved / rejected / returned)' }, { key: 'requesterName', label: 'ผู้ขอ' },
      { key: 'byName', label: 'ผู้พิจารณา' }, { key: 'note', label: 'หมายเหตุ' }],
    userFields: [{ key: 'requesterId', label: 'ผู้ขอ' }],
    message: 'คำขอ {{no}} "{{title}}" ของ {{requesterName}} มีผลแล้ว ({{decision}}) โดย {{byName}} หมายเหตุ: {{note}}', link: '/m/approvals/requestDetail/{{requestId}}' },
  { type: 'expense.claim_submitted', module: 'expense', label: 'มีใบเบิกค่าใช้จ่ายรออนุมัติ', level: 'info',
    fields: [{ key: 'no', label: 'เลขที่ใบเบิก' }, { key: 'claimantName', label: 'ผู้เบิก' }, { key: 'total', label: 'ยอดเบิก', numeric: true }, { key: 'overLimit', label: 'เกินวงเงิน (true / false)' }],
    userFields: [{ key: 'claimantId', label: 'ผู้เบิก' }],
    message: 'ใบเบิก {{no}} ของ {{claimantName}} ยอด {{total}} บาท รออนุมัติ', link: '/m/expense/claimDetail/{{claimId}}',
    decide: { target: 'expense.claim', entityField: 'claimId', title: 'ใบเบิก {{no}} ของ {{claimantName}} {{total}} บาท', deciders: [],
      approverPerms: ['expense.claim.approve'], exclude: ['claimantId'] } },
  { type: 'expense.claim_paid', module: 'expense', label: 'จ่ายเงินตามใบเบิกแล้ว', level: 'ok',
    fields: [{ key: 'no', label: 'เลขที่ใบเบิก' }, { key: 'claimantName', label: 'ผู้เบิก' }, { key: 'total', label: 'ยอดเบิก', numeric: true }],
    userFields: [{ key: 'claimantId', label: 'ผู้เบิก' }],
    message: 'จ่ายเงินตามใบเบิก {{no}} ให้ {{claimantName}} {{total}} บาทแล้ว', link: '/m/expense/claimDetail/{{claimId}}' },
  { type: 'hr.leave_requested', module: 'hr', label: 'มีคนยื่นใบลา', level: 'info',
    fields: [{ key: 'no', label: 'เลขที่ใบลา' }, { key: 'employeeName', label: 'พนักงาน' }, { key: 'typeName', label: 'ประเภทการลา' }, { key: 'from', label: 'ลาตั้งแต่' },
      { key: 'to', label: 'ถึง' }, { key: 'days', label: 'จำนวนวัน', numeric: true }, { key: 'approverName', label: 'หัวหน้าผู้อนุมัติ' }],
    userFields: [{ key: 'approverUserId', label: 'หัวหน้าผู้อนุมัติ (ตามผังองค์กร)' }, { key: 'employeeUserId', label: 'พนักงานผู้ลา' }],
    message: '{{employeeName}} ขอ{{typeName}} {{from}} ถึง {{to}} ({{days}} วัน) ใบลา {{no}} รออนุมัติ', link: '/m/hr/leaveDetail/{{leaveId}}',
    decide: { target: 'hr.leave', entityField: 'leaveId', title: 'ใบลา {{no}} ของ {{employeeName}}', deciders: ['approverUserId'] } },
  { type: 'hr.leave_decided', module: 'hr', label: 'ใบลามีผลแล้ว', level: 'info',
    fields: [{ key: 'no', label: 'เลขที่ใบลา' }, { key: 'employeeName', label: 'พนักงาน' }, { key: 'typeName', label: 'ประเภทการลา' }, { key: 'decision', label: 'ผล (approved / rejected)' },
      { key: 'byName', label: 'ผู้พิจารณา' }, { key: 'note', label: 'หมายเหตุ' }],
    userFields: [{ key: 'employeeUserId', label: 'พนักงานผู้ลา' }],
    message: 'ใบลา {{no}} ({{typeName}}) ของ {{employeeName}} มีผลแล้ว ({{decision}})', link: '/m/hr/leaveDetail/{{leaveId}}' },
  { type: 'helpdesk.ticket_created', module: 'helpdesk', label: 'มีเรื่องแจ้งปัญหาใหม่', level: 'warn',
    fields: [{ key: 'no', label: 'เลขที่เรื่อง' }, { key: 'title', label: 'ปัญหา' }, { key: 'priority', label: 'ความเร่งด่วน (low / normal / high / urgent)' },
      { key: 'categoryName', label: 'หมวด' }, { key: 'requesterName', label: 'ผู้แจ้ง' }, { key: 'assigneeName', label: 'ผู้รับผิดชอบ' }],
    message: 'แจ้งปัญหา {{no}}: {{title}} (หมวด {{categoryName}}) ผู้แจ้ง {{requesterName}} ผู้รับผิดชอบ {{assigneeName}}', link: '/m/helpdesk/ticket/{{ticketId}}' },
  { type: 'helpdesk.ticket_resolved', module: 'helpdesk', label: 'แก้ปัญหาเสร็จแล้ว', level: 'ok',
    fields: [{ key: 'no', label: 'เลขที่เรื่อง' }, { key: 'title', label: 'ปัญหา' }, { key: 'requesterName', label: 'ผู้แจ้ง' }, { key: 'resolution', label: 'วิธีแก้' }],
    userFields: [{ key: 'requesterUserId', label: 'ผู้แจ้ง' }],
    message: 'เรื่อง {{no}} "{{title}}" ของ {{requesterName}} แก้ไขแล้ว: {{resolution}}', link: '/m/helpdesk/ticket/{{ticketId}}' },
  { type: 'crm.lead_created', module: 'crm', label: 'มีลีดใหม่', level: 'info',
    fields: [{ key: 'no', label: 'เลขที่ลีด' }, { key: 'company', label: 'บริษัท' }, { key: 'contactName', label: 'ผู้ติดต่อ' }, { key: 'source', label: 'ช่องทาง (website / line / phone / expo / referral / other)' }],
    message: 'ลีดใหม่ {{no}}: {{company}} ผู้ติดต่อ {{contactName}} (ช่องทาง {{source}})', link: '/m/crm/lead/{{leadId}}' },
  { type: 'crm.quotation_accepted', module: 'crm', label: 'ลูกค้าตอบรับใบเสนอราคา', level: 'ok',
    fields: [{ key: 'no', label: 'เลขที่ใบเสนอราคา' }, { key: 'customerName', label: 'ลูกค้า' }, { key: 'total', label: 'ยอดรวม', numeric: true }],
    message: '{{customerName}} ตอบรับใบเสนอราคา {{no}} ยอด {{total}} บาท', link: '/m/crm/quote/{{quotationId}}' },
  { type: 'quality.inspection_completed', module: 'quality', label: 'ตรวจคุณภาพเสร็จ', level: 'info',
    fields: [{ key: 'no', label: 'เลขที่งานตรวจ' }, { key: 'stage', label: 'ขั้นตอน (incoming / in_process / final)' }, { key: 'itemCode', label: 'รหัสสินค้า' }, { key: 'itemName', label: 'ชื่อสินค้า' },
      { key: 'lotNo', label: 'ล็อต' }, { key: 'result', label: 'ผลตรวจ (pass / fail / conditional)' }, { key: 'rejectedQty', label: 'จำนวนไม่รับ', numeric: true }],
    message: 'ตรวจคุณภาพ {{no}} {{itemCode}} {{itemName}} ล็อต {{lotNo}} ผล {{result}} ไม่รับ {{rejectedQty}}', link: '/m/quality/inspDetail/{{inspectionId}}' },
  { type: 'quality.ncr_raised', module: 'quality', label: 'ออก NCR (ของไม่เป็นไปตามข้อกำหนด)', level: 'stop',
    fields: [{ key: 'no', label: 'เลขที่ NCR' }, { key: 'severity', label: 'ความรุนแรง (minor / major / critical)' }, { key: 'itemCode', label: 'รหัสสินค้า' }, { key: 'description', label: 'รายละเอียด' }],
    message: 'NCR {{no}} ({{severity}}) {{itemCode}}: {{description}}', link: '/m/quality/ncrDetail/{{ncrId}}' },
  { type: 'booking.requested', module: 'booking', label: 'มีการจองห้อง/รถ/อุปกรณ์', level: 'info',
    fields: [{ key: 'no', label: 'เลขที่การจอง' }, { key: 'resourceName', label: 'ห้อง/รถ/อุปกรณ์' }, { key: 'period', label: 'ช่วงเวลา' }, { key: 'requesterName', label: 'ผู้จอง' },
      { key: 'purpose', label: 'วัตถุประสงค์' }, { key: 'needsApproval', label: 'ต้องอนุมัติ (true / false)' }],
    userFields: [{ key: 'requesterId', label: 'ผู้จอง' }],
    message: '{{requesterName}} จอง {{resourceName}} {{period}} ({{purpose}}) เลขที่ {{no}}', link: '/m/booking/bookingDetail/{{bookingId}}' },
  { type: 'assets.repair_reported', module: 'assets', label: 'มีการแจ้งซ่อมทรัพย์สิน', level: 'warn',
    fields: [{ key: 'code', label: 'รหัสทรัพย์สิน' }, { key: 'name', label: 'ชื่อทรัพย์สิน' }, { key: 'description', label: 'อาการ' }],
    message: 'แจ้งซ่อม {{code}} {{name}}: {{description}}', link: '/m/assets/assetDetail/{{assetId}}' },

  /* ---- wave 5: service contracts, payroll, HR master data ---- */
  { type: 'contracts.visit_due', module: 'contracts', label: 'มีนัดเข้า PM ตามสัญญา MA', level: 'info',
    fields: [{ key: 'no', label: 'เลขที่นัด PM' }, { key: 'contractNo', label: 'เลขที่สัญญา' }, { key: 'customerName', label: 'ลูกค้า' }, { key: 'scheduledDate', label: 'วันนัด' },
      { key: 'technicianName', label: 'ช่างผู้รับผิดชอบ' }, { key: 'itemsText', label: 'อุปกรณ์' }, { key: 'coverage', label: 'ความคุ้มครอง (8x5 / 24x7)' }],
    userFields: [{ key: 'technicianId', label: 'ช่างผู้รับผิดชอบ' }],
    message: 'นัด PM {{no}} {{customerName}} (สัญญา {{contractNo}}) วันที่ {{scheduledDate}} ช่าง {{technicianName}} อุปกรณ์: {{itemsText}}', link: '/m/contracts/visit/{{visitId}}' },
  { type: 'contracts.contract_expiring', module: 'contracts', label: 'สัญญา MA ใกล้หมดอายุ', level: 'warn',
    fields: [{ key: 'no', label: 'เลขที่สัญญา' }, { key: 'customerName', label: 'ลูกค้า' }, { key: 'title', label: 'เรื่อง' }, { key: 'endDate', label: 'วันสิ้นสุด' },
      { key: 'daysLeft', label: 'เหลือ (วัน)', numeric: true }, { key: 'value', label: 'มูลค่าสัญญา', numeric: true }],
    message: 'สัญญา {{no}} {{customerName}} ({{title}}) จะหมดวันที่ {{endDate}} อีก {{daysLeft}} วัน มูลค่า {{value}} บาท', link: '/m/contracts/contract/{{contractId}}' },
  { type: 'payroll.run_paid', module: 'payroll', label: 'จ่ายเงินเดือนแล้ว', level: 'ok',
    fields: [{ key: 'no', label: 'เลขที่รอบเงินเดือน' }, { key: 'period', label: 'งวด (YYYY-MM)' }, { key: 'paidDate', label: 'วันที่จ่าย' }, { key: 'headcount', label: 'จำนวนพนักงาน', numeric: true }],
    message: 'จ่ายเงินเดือน {{no}} งวด {{period}} แล้ว {{headcount}} คน ยอดสุทธิ {{totals.net}} บาท (จ่ายวันที่ {{paidDate}})', link: '/m/payroll/runDetail/{{runId}}' },
  { type: 'hr.employee_upserted', module: 'hr', label: 'เพิ่ม/แก้ไขข้อมูลพนักงาน', level: 'info',
    fields: [{ key: 'code', label: 'รหัสพนักงาน' }, { key: 'name', label: 'ชื่อ' }, { key: 'departmentName', label: 'แผนก' }, { key: 'positionName', label: 'ตำแหน่ง' },
      { key: 'status', label: 'สถานะ (active / probation / resigned)' }, { key: 'startDate', label: 'วันเริ่มงาน' }, { key: 'resignedDate', label: 'วันทำงานวันสุดท้าย' }],
    userFields: [{ key: 'userId', label: 'พนักงาน (ผู้ใช้ในระบบ)' }],
    message: 'ข้อมูลพนักงาน {{code}} {{name}} ({{departmentName}} / {{positionName}}) สถานะ {{status}}', link: '/m/hr/employeeDetail/{{employeeId}}' },
];

export const eventInfo = (type: string) => EVENTS.find((e) => e.type === type);

/** Thai module names for the template gallery (the raw ids are English). */
export const MODULE_TH: Record<string, string> = {
  inventory: 'คลังสินค้า', purchasing: 'จัดซื้อ', sales: 'ขาย', production: 'ผลิต', maintenance: 'ซ่อมบำรุง', approvals: 'อนุมัติออนไลน์',
  expense: 'เบิกค่าใช้จ่าย', hr: 'บุคคลและลงเวลา', helpdesk: 'แจ้งปัญหา', crm: 'ลูกค้าสัมพันธ์', quality: 'ควบคุมคุณภาพ', booking: 'จองห้อง/รถ', assets: 'ทรัพย์สิน',
  contracts: 'สัญญาบริการ MA', payroll: 'เงินเดือน',
};

export interface Template {
  id: string;
  name: string;
  description: string;
  eventType: EventType;
  conditions: Condition[];
  actions: ActionSpec[];
}

export interface Condition { field: string; op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'; value: string | number }
export interface ActionSpec {
  type: 'notify' | 'line' | 'webhook';
  target?: string;
  message?: string;
  /**
   * notify — who gets the in-app alert: 'all' (default; everyone with automation.notify.read),
   * 'field:<userField>[,<userField>]' (user ids carried by the event, e.g. nextApproverId), or 'user:<uuid>'.
   * line — personal LINE instead of a group `target`: 'field:…' or 'user:…' → each person's linked LINE (see src/line.ts).
   */
  to?: string;
}

export const TEMPLATES: Template[] = [
  { id: 'low-stock-alert', name: 'เตือนของใกล้หมด', description: 'แจ้งทุกคนเมื่อสินค้าต่ำกว่าจุดสั่งซื้อ', eventType: 'inventory.low_stock', conditions: [], actions: [{ type: 'notify' }] },
  { id: 'breakdown-alert', name: 'เครื่องเสีย แจ้งช่างทันที', description: 'แจ้งในแอปและส่ง LINE กลุ่มช่างเมื่อมีการแจ้งซ่อม', eventType: 'maintenance.breakdown_reported', conditions: [], actions: [{ type: 'notify' }, { type: 'line', target: '' }] },
  { id: 'big-po-approval', name: 'PO ยอดสูงรออนุมัติ', description: 'แจ้งผู้จัดการเมื่อมีใบสั่งซื้อเกิน 50,000 บาท — ในแอป และการ์ดอนุมัติทาง LINE ถึงผู้มีสิทธิ์อนุมัติที่ผูก LINE ไว้', eventType: 'purchasing.po_created', conditions: [{ field: 'gross', op: 'gt', value: 50000 }],
    actions: [{ type: 'notify', message: 'PO ยอดสูง {{poNo}} จาก {{supplierName}} {{gross}} บาท รอคุณอนุมัติ' }, { type: 'line', to: 'approvers', message: 'PO ยอดสูง {{poNo}} จาก {{supplierName}} {{gross}} บาท รออนุมัติ' }] },
  { id: 'po-approval-line', name: 'ใบสั่งซื้อรออนุมัติ — อนุมัติทาง LINE', description: 'ส่งการ์ดมีปุ่มอนุมัติทาง LINE ถึงผู้มีสิทธิ์อนุมัติใบสั่งซื้อที่ผูก LINE ไว้ ทุกครั้งที่มีใบสั่งซื้อใหม่ (ไม่ส่งถึงคนสร้าง)', eventType: 'purchasing.po_created', conditions: [],
    actions: [{ type: 'line', to: 'approvers' }] },
  { id: 'claim-approval-line', name: 'ใบเบิกรออนุมัติ — อนุมัติทาง LINE', description: 'ส่งการ์ดมีปุ่มอนุมัติทาง LINE ถึงผู้มีสิทธิ์อนุมัติใบเบิกที่ผูก LINE ไว้ (ไม่ส่งถึงผู้เบิก)', eventType: 'expense.claim_submitted', conditions: [],
    actions: [{ type: 'line', to: 'approvers' }] },
  { id: 'goods-arrived', name: 'ของเข้าแล้ว แจ้งฝ่ายผลิต', description: 'แจ้งเมื่อรับวัตถุดิบเข้าคลัง', eventType: 'purchasing.goods_received', conditions: [], actions: [{ type: 'notify' }] },
  { id: 'big-sale', name: 'ปิดการขายก้อนใหญ่', description: 'แจ้งเมื่อยืนยันคำสั่งซื้อเกิน 100,000 บาท', eventType: 'sales.order_confirmed', conditions: [{ field: 'total', op: 'gte', value: 100000 }], actions: [{ type: 'notify', message: '🎉 ปิดการขาย {{customerName}} {{total}} บาท ({{orderNo}})' }] },
  { id: 'invoice-issued', name: 'ออกใบกำกับแล้ว แจ้งบัญชี', description: 'ส่งข้อมูลใบกำกับไปยังระบบบัญชีผ่าน webhook', eventType: 'sales.invoiced', conditions: [], actions: [{ type: 'notify' }, { type: 'webhook', target: '' }] },
  { id: 'output-reported', name: 'สรุปผลผลิต', description: 'แจ้งทุกครั้งที่รายงานผลผลิต', eventType: 'production.completed', conditions: [], actions: [{ type: 'notify' }] },
  { id: 'long-downtime', name: 'เครื่องหยุดนานเกิน 2 ชั่วโมง', description: 'แจ้งเมื่อปิดงานซ่อมที่เครื่องหยุดเกิน 120 นาที', eventType: 'maintenance.work_completed', conditions: [{ field: 'downtimeMinutes', op: 'gt', value: 120 }], actions: [{ type: 'notify', message: '{{machineCode}} หยุด {{downtimeMinutes}} นาที ({{workOrderNo}}) ควรทบทวนแผน PM' }] },

  /* ---- office / service businesses ---- */
  { id: 'approval-to-approver', name: 'มีคำขออนุมัติใหม่ แจ้งผู้อนุมัติ', description: 'แจ้งในแอปและส่ง LINE ทุกครั้งที่คำขอถึงคิวผู้อนุมัติคนถัดไป — ในแอป และ LINE ส่วนตัวของคนที่ผูก LINE ไว้', eventType: 'approvals.request_submitted', conditions: [],
    actions: [{ type: 'notify', to: 'field:nextApproverId,delegateId', message: 'คำขอ {{no}} "{{title}}" ({{typeName}}) จาก {{requesterName}} รอคุณอนุมัติ (ขั้นที่ {{step}}/{{stepCount}})' }, { type: 'line', target: '' },
      { type: 'line', to: 'field:nextApproverId,delegateId', message: 'คำขอ {{no}} "{{title}}" ({{typeName}}) จาก {{requesterName}} รอคุณอนุมัติ (ขั้นที่ {{step}}/{{stepCount}})' }] },
  { id: 'approval-approved', name: 'คำขอได้รับการอนุมัติ แจ้งผู้ขอ', description: 'แจ้งเมื่อคำขออนุมัติครบทุกขั้นแล้ว — ในแอป และ LINE ส่วนตัวของคนที่ผูก LINE ไว้', eventType: 'approvals.request_decided', conditions: [{ field: 'decision', op: 'eq', value: 'approved' }],
    actions: [{ type: 'notify', to: 'field:requesterId', message: '✅ คำขอ {{no}} "{{title}}" ของคุณได้รับการอนุมัติแล้ว (โดย {{byName}})' },
      { type: 'line', to: 'field:requesterId', message: '✅ คำขอ {{no}} "{{title}}" ของคุณได้รับการอนุมัติแล้ว (โดย {{byName}})' }] },
  { id: 'approval-not-approved', name: 'คำขอไม่อนุมัติ/ส่งกลับแก้ไข แจ้งผู้ขอ', description: 'แจ้งผู้ขอพร้อมเหตุผลเมื่อคำขอถูกปฏิเสธหรือส่งกลับให้แก้ไข — ในแอป และ LINE ส่วนตัวของคนที่ผูก LINE ไว้', eventType: 'approvals.request_decided', conditions: [{ field: 'decision', op: 'ne', value: 'approved' }],
    actions: [{ type: 'notify', to: 'field:requesterId', message: 'คำขอ {{no}} "{{title}}" ของคุณไม่ผ่านหรือถูกส่งกลับแก้ไข โดย {{byName}} เหตุผล: {{note}}' },
      { type: 'line', to: 'field:requesterId', message: 'คำขอ {{no}} "{{title}}" ของคุณ: {{decision:th}} โดย {{byName}} เหตุผล: {{note}}' }] },
  { id: 'expense-over-limit', name: 'เบิกเกินวงเงิน แจ้งบัญชี', description: 'แจ้งฝ่ายบัญชีเมื่อมีใบเบิกที่เกินวงเงินรายเดือนของหมวดค่าใช้จ่าย', eventType: 'expense.claim_submitted', conditions: [{ field: 'overLimit', op: 'eq', value: 'true' }],
    actions: [{ type: 'notify', message: '⚠️ ใบเบิก {{no}} ของ {{claimantName}} ยอด {{total}} บาท เกินวงเงินรายเดือน ตรวจสอบก่อนอนุมัติ' }] },
  { id: 'leave-to-manager', name: 'มีคนขอลา แจ้งหัวหน้า', description: 'แจ้งหัวหน้าตามผังองค์กร (ในแอป) และส่ง LINE เมื่อพนักงานยื่นใบลา — ในแอป และ LINE ส่วนตัวของคนที่ผูก LINE ไว้', eventType: 'hr.leave_requested', conditions: [],
    actions: [{ type: 'notify', to: 'field:approverUserId', message: '{{employeeName}} ขอ{{typeName}} {{from}} ถึง {{to}} ({{days}} วัน) ใบลา {{no}} รอคุณอนุมัติ' }, { type: 'line', target: '' },
      { type: 'line', to: 'field:approverUserId', message: '{{employeeName}} ขอ{{typeName}} {{from}} ถึง {{to}} ({{days}} วัน) ใบลา {{no}} รอคุณอนุมัติ' }] },
  { id: 'leave-decided-to-employee', name: 'ใบลามีผลแล้ว แจ้งพนักงาน', description: 'แจ้งพนักงานผู้ลาเมื่อหัวหน้าหรือฝ่ายบุคคลอนุมัติ/ไม่อนุมัติใบลา — ในแอป และ LINE ส่วนตัวของคนที่ผูก LINE ไว้', eventType: 'hr.leave_decided', conditions: [],
    actions: [{ type: 'notify', to: 'field:employeeUserId', message: 'ใบลา {{no}} ({{typeName}}) ของคุณ: {{decision:th}} โดย {{byName}} หมายเหตุ: {{note}}' },
      { type: 'line', to: 'field:employeeUserId', message: 'ใบลา {{no}} ({{typeName}}) ของคุณ: {{decision:th}} โดย {{byName}} หมายเหตุ: {{note}}' }] },
  { id: 'expense-paid-to-claimant', name: 'จ่ายเงินใบเบิกแล้ว แจ้งผู้เบิก', description: 'แจ้งผู้เบิกเมื่อฝ่ายบัญชีจ่ายเงินตามใบเบิกแล้ว — ในแอป และ LINE ส่วนตัวของคนที่ผูก LINE ไว้', eventType: 'expense.claim_paid', conditions: [],
    actions: [{ type: 'notify', to: 'field:claimantId', message: '💸 ใบเบิก {{no}} ของคุณ ยอด {{total}} บาท จ่ายเงินแล้ว' },
      { type: 'line', to: 'field:claimantId', message: '💸 ใบเบิก {{no}} ของคุณ ยอด {{total}} บาท จ่ายเงินแล้ว' }] },
  { id: 'ticket-resolved-to-requester', name: 'แก้ปัญหาเสร็จ แจ้งผู้แจ้ง', description: 'แจ้งผู้แจ้งปัญหาเมื่อทีมแก้ไขเรื่องเสร็จแล้ว — ในแอป และ LINE ส่วนตัวของคนที่ผูก LINE ไว้', eventType: 'helpdesk.ticket_resolved', conditions: [],
    actions: [{ type: 'notify', to: 'field:requesterUserId', message: '✅ เรื่อง {{no}} "{{title}}" ที่คุณแจ้งแก้ไขแล้ว: {{resolution}}' },
      { type: 'line', to: 'field:requesterUserId', message: '✅ เรื่อง {{no}} "{{title}}" ที่คุณแจ้งแก้ไขแล้ว: {{resolution}}' }] },
  { id: 'urgent-ticket', name: 'ตั๋วด่วนมาก แจ้งทีม IT', description: 'ส่ง LINE กลุ่มทีม IT ทันทีเมื่อมีเรื่องแจ้งปัญหาระดับด่วนมาก', eventType: 'helpdesk.ticket_created', conditions: [{ field: 'priority', op: 'eq', value: 'urgent' }],
    actions: [{ type: 'notify', message: '🚨 ด่วนมาก {{no}}: {{title}} ผู้แจ้ง {{requesterName}} (หมวด {{categoryName}})' }, { type: 'line', target: '' }] },
  { id: 'new-lead', name: 'ลีดใหม่ แจ้งเซลส์', description: 'แจ้งทีมขายทันทีที่มีลีดเข้ามา จะได้โทรกลับเร็ว', eventType: 'crm.lead_created', conditions: [],
    actions: [{ type: 'notify' }, { type: 'line', target: '' }] },
  { id: 'quote-accepted', name: 'ลูกค้าตอบรับใบเสนอราคา', description: 'แจ้งทุกคนเมื่อลูกค้าตอบรับใบเสนอราคา', eventType: 'crm.quotation_accepted', conditions: [],
    actions: [{ type: 'notify', message: '🎉 {{customerName}} ตอบรับใบเสนอราคา {{no}} ยอด {{total}} บาท' }] },
  { id: 'qc-fail', name: 'QC ไม่ผ่าน แจ้งผู้จัดการคุณภาพ', description: 'แจ้งในแอปและส่ง LINE เมื่อผลตรวจคุณภาพไม่ผ่าน', eventType: 'quality.inspection_completed', conditions: [{ field: 'result', op: 'eq', value: 'fail' }],
    actions: [{ type: 'notify', message: '❌ QC ไม่ผ่าน {{no}} {{itemCode}} {{itemName}} ล็อต {{lotNo}} ไม่รับ {{rejectedQty}} กักของและพิจารณาออก NCR' }, { type: 'line', target: '' }] },
  { id: 'ncr-critical', name: 'NCR ร้ายแรง', description: 'แจ้งผู้บริหารเมื่อมี NCR ระดับวิกฤต', eventType: 'quality.ncr_raised', conditions: [{ field: 'severity', op: 'eq', value: 'critical' }],
    actions: [{ type: 'notify', message: '🛑 NCR วิกฤต {{no}} {{itemCode}}: {{description}}' }, { type: 'line', target: '' }] },
  { id: 'booking-needs-approval', name: 'มีการจองห้อง/รถที่ต้องอนุมัติ', description: 'แจ้งผู้อนุมัติเมื่อมีการจองห้องหรือรถที่ตั้งค่าให้ต้องอนุมัติ', eventType: 'booking.requested', conditions: [{ field: 'needsApproval', op: 'eq', value: 'true' }],
    actions: [{ type: 'notify', message: '{{requesterName}} ขอจอง {{resourceName}} {{period}} ({{purpose}}) รออนุมัติ เลขที่ {{no}}' }] },

  /* ---- wave 5 ---- */
  { id: 'pm-visit-to-technician', name: 'มีนัด PM แจ้งช่าง', description: 'แจ้งช่างที่ได้รับมอบหมายเมื่อระบบสร้างนัดเข้า PM ตามสัญญา MA — ในแอป และ LINE ส่วนตัวของคนที่ผูก LINE ไว้', eventType: 'contracts.visit_due', conditions: [],
    actions: [{ type: 'notify', to: 'field:technicianId', message: '🛠️ นัด PM {{no}} {{customerName}} วันที่ {{scheduledDate}} (สัญญา {{contractNo}}) อุปกรณ์: {{itemsText}}' },
      { type: 'line', to: 'field:technicianId', message: '🛠️ นัด PM {{no}} {{customerName}} วันที่ {{scheduledDate}} (สัญญา {{contractNo}}) อุปกรณ์: {{itemsText}}' }] },
  { id: 'contract-expiring-to-sales', name: 'สัญญา MA ใกล้หมด แจ้งเซลส์', description: 'แจ้งทีมขายในแอปและ LINE กลุ่มเมื่อสัญญา MA จะหมดอายุ จะได้เสนอต่อสัญญาทัน', eventType: 'contracts.contract_expiring', conditions: [],
    actions: [{ type: 'notify', message: '⏳ สัญญา {{no}} ของ {{customerName}} ({{title}}) หมดวันที่ {{endDate}} อีก {{daysLeft}} วัน มูลค่า {{value}} บาท — เสนอต่อสัญญา' }, { type: 'line', target: '' }] },
  { id: 'payment-received', name: 'ลูกค้าชำระเงินแล้ว แจ้งเซลส์/บัญชี', description: 'แจ้งเซลส์และฝ่ายบัญชีทุกครั้งที่ออกใบเสร็จรับเงินหรือรับมัดจำ', eventType: 'sales.payment_received', conditions: [],
    actions: [{ type: 'notify', message: '💰 {{customerName}} ชำระเงินแล้ว {{received}} บาท (ใบเสร็จ {{receiptNo}}) ภาษีหัก ณ ที่จ่าย {{whtAmount}} บาท' }] },
  { id: 'payroll-paid', name: 'จ่ายเงินเดือนแล้ว', description: 'แจ้งฝ่ายการเงิน/บัญชีเมื่อบันทึกจ่ายเงินเดือนแล้ว (ยอดรวมทั้งบริษัท — ไม่มีข้อมูลรายคน)', eventType: 'payroll.run_paid', conditions: [],
    actions: [{ type: 'notify', message: '✅ จ่ายเงินเดือน {{no}} งวด {{period}} แล้ว {{headcount}} คน ยอดสุทธิ {{totals.net}} บาท — นำส่ง ภ.ง.ด.1 ภายในวันที่ 7 และเงินสมทบประกันสังคมภายในวันที่ 15 ของเดือนถัดไป' }] },
];
