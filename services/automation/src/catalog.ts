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
];
