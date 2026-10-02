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
    message: 'ใบสั่งซื้อ {{poNo}} จาก {{supplierName}} ยอด {{gross}} บาท รออนุมัติ', link: '/m/purchasing/poDetail/{{poId}}' },
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
  { type: 'production.completed', module: 'production', label: 'รายงานผลผลิต', level: 'ok',
    fields: [{ key: 'orderNo', label: 'เลขที่ใบสั่งผลิต' }, { key: 'item.itemCode', label: 'สินค้า' }, { key: 'qty', label: 'จำนวนที่ผลิตได้', numeric: true }],
    message: 'ผลิต {{item.itemCode}} ได้ {{qty}} ชิ้น ({{orderNo}})', link: '/m/production/moDetail/{{orderId}}' },

  /* ---- office / service modules ---- */
  { type: 'approvals.request_submitted', module: 'approvals', label: 'มีคำขออนุมัติรอพิจารณา', level: 'warn',
    fields: [{ key: 'no', label: 'เลขที่คำขอ' }, { key: 'title', label: 'เรื่อง' }, { key: 'typeName', label: 'ประเภทคำขอ' }, { key: 'requesterName', label: 'ผู้ขอ' },
      { key: 'amount', label: 'จำนวนเงิน', numeric: true }, { key: 'nextApproverName', label: 'ผู้อนุมัติขั้นนี้' }, { key: 'step', label: 'ขั้นที่', numeric: true }],
    message: 'คำขอ {{no}} "{{title}}" ({{typeName}}) จาก {{requesterName}} รอ {{nextApproverName}} อนุมัติ (ขั้นที่ {{step}}/{{stepCount}})', link: '/m/approvals/requestDetail/{{requestId}}' },
  { type: 'approvals.request_decided', module: 'approvals', label: 'คำขออนุมัติมีผลแล้ว', level: 'info',
    fields: [{ key: 'no', label: 'เลขที่คำขอ' }, { key: 'title', label: 'เรื่อง' }, { key: 'decision', label: 'ผล (approved / rejected / returned)' }, { key: 'requesterName', label: 'ผู้ขอ' },
      { key: 'byName', label: 'ผู้พิจารณา' }, { key: 'note', label: 'หมายเหตุ' }],
    message: 'คำขอ {{no}} "{{title}}" ของ {{requesterName}} มีผลแล้ว ({{decision}}) โดย {{byName}} หมายเหตุ: {{note}}', link: '/m/approvals/requestDetail/{{requestId}}' },
  { type: 'expense.claim_submitted', module: 'expense', label: 'มีใบเบิกค่าใช้จ่ายรออนุมัติ', level: 'info',
    fields: [{ key: 'no', label: 'เลขที่ใบเบิก' }, { key: 'claimantName', label: 'ผู้เบิก' }, { key: 'total', label: 'ยอดเบิก', numeric: true }, { key: 'overLimit', label: 'เกินวงเงิน (true / false)' }],
    message: 'ใบเบิก {{no}} ของ {{claimantName}} ยอด {{total}} บาท รออนุมัติ', link: '/m/expense/claimDetail/{{claimId}}' },
  { type: 'expense.claim_paid', module: 'expense', label: 'จ่ายเงินตามใบเบิกแล้ว', level: 'ok',
    fields: [{ key: 'no', label: 'เลขที่ใบเบิก' }, { key: 'claimantName', label: 'ผู้เบิก' }, { key: 'total', label: 'ยอดเบิก', numeric: true }],
    message: 'จ่ายเงินตามใบเบิก {{no}} ให้ {{claimantName}} {{total}} บาทแล้ว', link: '/m/expense/claimDetail/{{claimId}}' },
  { type: 'hr.leave_requested', module: 'hr', label: 'มีคนยื่นใบลา', level: 'info',
    fields: [{ key: 'no', label: 'เลขที่ใบลา' }, { key: 'employeeName', label: 'พนักงาน' }, { key: 'typeName', label: 'ประเภทการลา' }, { key: 'from', label: 'ลาตั้งแต่' },
      { key: 'to', label: 'ถึง' }, { key: 'days', label: 'จำนวนวัน', numeric: true }],
    message: '{{employeeName}} ขอ{{typeName}} {{from}} ถึง {{to}} ({{days}} วัน) ใบลา {{no}} รออนุมัติ', link: '/m/hr/leaveDetail/{{leaveId}}' },
  { type: 'hr.leave_decided', module: 'hr', label: 'ใบลามีผลแล้ว', level: 'info',
    fields: [{ key: 'no', label: 'เลขที่ใบลา' }, { key: 'employeeName', label: 'พนักงาน' }, { key: 'typeName', label: 'ประเภทการลา' }, { key: 'decision', label: 'ผล (approved / rejected)' }],
    message: 'ใบลา {{no}} ({{typeName}}) ของ {{employeeName}} มีผลแล้ว ({{decision}})', link: '/m/hr/leaveDetail/{{leaveId}}' },
  { type: 'helpdesk.ticket_created', module: 'helpdesk', label: 'มีเรื่องแจ้งปัญหาใหม่', level: 'warn',
    fields: [{ key: 'no', label: 'เลขที่เรื่อง' }, { key: 'title', label: 'ปัญหา' }, { key: 'priority', label: 'ความเร่งด่วน (low / normal / high / urgent)' },
      { key: 'categoryName', label: 'หมวด' }, { key: 'requesterName', label: 'ผู้แจ้ง' }, { key: 'assigneeName', label: 'ผู้รับผิดชอบ' }],
    message: 'แจ้งปัญหา {{no}}: {{title}} (หมวด {{categoryName}}) ผู้แจ้ง {{requesterName}} ผู้รับผิดชอบ {{assigneeName}}', link: '/m/helpdesk/ticket/{{ticketId}}' },
  { type: 'helpdesk.ticket_resolved', module: 'helpdesk', label: 'แก้ปัญหาเสร็จแล้ว', level: 'ok',
    fields: [{ key: 'no', label: 'เลขที่เรื่อง' }, { key: 'title', label: 'ปัญหา' }, { key: 'requesterName', label: 'ผู้แจ้ง' }, { key: 'resolution', label: 'วิธีแก้' }],
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
    message: '{{requesterName}} จอง {{resourceName}} {{period}} ({{purpose}}) เลขที่ {{no}}', link: '/m/booking/bookingDetail/{{bookingId}}' },
  { type: 'assets.repair_reported', module: 'assets', label: 'มีการแจ้งซ่อมทรัพย์สิน', level: 'warn',
    fields: [{ key: 'code', label: 'รหัสทรัพย์สิน' }, { key: 'name', label: 'ชื่อทรัพย์สิน' }, { key: 'description', label: 'อาการ' }],
    message: 'แจ้งซ่อม {{code}} {{name}}: {{description}}', link: '/m/assets/assetDetail/{{assetId}}' },
];

export const eventInfo = (type: string) => EVENTS.find((e) => e.type === type);

export interface Template {
  id: string;
  name: string;
  description: string;
  eventType: EventType;
  conditions: Condition[];
  actions: ActionSpec[];
}

export interface Condition { field: string; op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'; value: string | number }
export interface ActionSpec { type: 'notify' | 'line' | 'webhook'; target?: string; message?: string }

export const TEMPLATES: Template[] = [
  { id: 'low-stock-alert', name: 'เตือนของใกล้หมด', description: 'แจ้งทุกคนเมื่อสินค้าต่ำกว่าจุดสั่งซื้อ', eventType: 'inventory.low_stock', conditions: [], actions: [{ type: 'notify' }] },
  { id: 'breakdown-alert', name: 'เครื่องเสีย แจ้งช่างทันที', description: 'แจ้งในแอปและส่ง LINE กลุ่มช่างเมื่อมีการแจ้งซ่อม', eventType: 'maintenance.breakdown_reported', conditions: [], actions: [{ type: 'notify' }, { type: 'line', target: '' }] },
  { id: 'big-po-approval', name: 'PO ยอดสูงรออนุมัติ', description: 'แจ้งผู้จัดการเมื่อมีใบสั่งซื้อเกิน 50,000 บาท', eventType: 'purchasing.po_created', conditions: [{ field: 'gross', op: 'gt', value: 50000 }], actions: [{ type: 'notify', message: 'PO ยอดสูง {{poNo}} จาก {{supplierName}} {{gross}} บาท รอคุณอนุมัติ' }] },
  { id: 'goods-arrived', name: 'ของเข้าแล้ว แจ้งฝ่ายผลิต', description: 'แจ้งเมื่อรับวัตถุดิบเข้าคลัง', eventType: 'purchasing.goods_received', conditions: [], actions: [{ type: 'notify' }] },
  { id: 'big-sale', name: 'ปิดการขายก้อนใหญ่', description: 'แจ้งเมื่อยืนยันคำสั่งซื้อเกิน 100,000 บาท', eventType: 'sales.order_confirmed', conditions: [{ field: 'total', op: 'gte', value: 100000 }], actions: [{ type: 'notify', message: '🎉 ปิดการขาย {{customerName}} {{total}} บาท ({{orderNo}})' }] },
  { id: 'invoice-issued', name: 'ออกใบกำกับแล้ว แจ้งบัญชี', description: 'ส่งข้อมูลใบกำกับไปยังระบบบัญชีผ่าน webhook', eventType: 'sales.invoiced', conditions: [], actions: [{ type: 'notify' }, { type: 'webhook', target: '' }] },
  { id: 'output-reported', name: 'สรุปผลผลิต', description: 'แจ้งทุกครั้งที่รายงานผลผลิต', eventType: 'production.completed', conditions: [], actions: [{ type: 'notify' }] },
  { id: 'long-downtime', name: 'เครื่องหยุดนานเกิน 2 ชั่วโมง', description: 'แจ้งเมื่อปิดงานซ่อมที่เครื่องหยุดเกิน 120 นาที', eventType: 'maintenance.work_completed', conditions: [{ field: 'downtimeMinutes', op: 'gt', value: 120 }], actions: [{ type: 'notify', message: '{{machineCode}} หยุด {{downtimeMinutes}} นาที ({{workOrderNo}}) ควรทบทวนแผน PM' }] },

  /* ---- office / service businesses ---- */
  { id: 'approval-to-approver', name: 'มีคำขออนุมัติใหม่ แจ้งผู้อนุมัติ', description: 'แจ้งในแอปและส่ง LINE ทุกครั้งที่คำขอถึงคิวผู้อนุมัติคนถัดไป', eventType: 'approvals.request_submitted', conditions: [],
    actions: [{ type: 'notify' }, { type: 'line', target: '' }] },
  { id: 'approval-approved', name: 'คำขอได้รับการอนุมัติ แจ้งผู้ขอ', description: 'แจ้งเมื่อคำขออนุมัติครบทุกขั้นแล้ว', eventType: 'approvals.request_decided', conditions: [{ field: 'decision', op: 'eq', value: 'approved' }],
    actions: [{ type: 'notify', message: '✅ คำขอ {{no}} "{{title}}" ของ {{requesterName}} ได้รับการอนุมัติแล้ว' }] },
  { id: 'approval-not-approved', name: 'คำขอไม่อนุมัติ/ส่งกลับแก้ไข แจ้งผู้ขอ', description: 'แจ้งผู้ขอพร้อมเหตุผลเมื่อคำขอถูกปฏิเสธหรือส่งกลับให้แก้ไข', eventType: 'approvals.request_decided', conditions: [{ field: 'decision', op: 'ne', value: 'approved' }],
    actions: [{ type: 'notify', message: 'คำขอ {{no}} "{{title}}" ของ {{requesterName}} ไม่ผ่านหรือถูกส่งกลับแก้ไข โดย {{byName}} เหตุผล: {{note}}' }] },
  { id: 'expense-over-limit', name: 'เบิกเกินวงเงิน แจ้งบัญชี', description: 'แจ้งฝ่ายบัญชีเมื่อมีใบเบิกที่เกินวงเงินรายเดือนของหมวดค่าใช้จ่าย', eventType: 'expense.claim_submitted', conditions: [{ field: 'overLimit', op: 'eq', value: 'true' }],
    actions: [{ type: 'notify', message: '⚠️ ใบเบิก {{no}} ของ {{claimantName}} ยอด {{total}} บาท เกินวงเงินรายเดือน ตรวจสอบก่อนอนุมัติ' }] },
  { id: 'leave-to-manager', name: 'มีคนขอลา แจ้งหัวหน้า', description: 'แจ้งในแอปและส่ง LINE หัวหน้าเมื่อพนักงานยื่นใบลา', eventType: 'hr.leave_requested', conditions: [],
    actions: [{ type: 'notify' }, { type: 'line', target: '' }] },
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
];
