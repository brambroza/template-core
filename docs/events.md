# Event catalogue

นิยาม schema อยู่ใน `packages/contracts/src/index.ts` (zod) — ไฟล์นี้คือแผนที่ว่าใครส่ง ใครรับ

| Event | ส่งโดย | รับโดย | ผล |
| --- | --- | --- | --- |
| `master.item_upserted` | master-data | — | (ให้โมดูลที่ต้องการ cache ชื่อสินค้าใช้) |
| `master.partner_upserted` | master-data | — | |
| `purchasing.goods_received` | purchasing | inventory, costing, quality, automation | สต็อกเข้า, ต้นทุนเฉลี่ยเคลื่อนที่, สร้างใบตรวจรับ QC |
| `sales.order_confirmed` | sales | — | (เช่น จองสต็อก, แจ้ง LINE) |
| `sales.delivered` | sales | inventory | ตัดสต็อกสินค้า |
| `sales.invoiced` | sales | — | (เช่น ลงบัญชีลูกหนี้) |
| `production.completed` | production | inventory, costing, quality, automation | ตัดวัตถุดิบ + รับ FG, ต้นทุนจริงต่อ job, ใบตรวจขั้นสุดท้าย |
| `maintenance.parts_used` | maintenance | inventory | ตัดอะไหล่ |
| `inventory.stock_changed` | inventory | — | (เช่น แจ้งเตือนจุดสั่งซื้อ) |
| `inventory.low_stock` | inventory | automation | เตือนของต่ำกว่าจุดสั่งซื้อ |
| `purchasing.po_created` · `purchasing.po_approved` | purchasing | automation | PO ยอดสูงรออนุมัติ ฯลฯ |
| `maintenance.breakdown_reported` · `maintenance.work_completed` | maintenance | automation | แจ้งช่าง / เครื่องหยุดนาน |
| `approvals.request_submitted` · `approvals.request_decided` | approvals | automation | แจ้งผู้อนุมัติคนถัดไป / แจ้งผลผู้ขอ |
| `expense.claim_submitted` · `expense.claim_paid` | expense | automation | เบิกเกินวงเงิน / จ่ายแล้ว |
| `hr.leave_requested` · `hr.leave_decided` | hr | automation | แจ้งหัวหน้า / แจ้งผลการลา |
| `helpdesk.ticket_created` · `helpdesk.ticket_resolved` | helpdesk | automation | ticket ด่วน / แจ้งผู้แจ้ง |
| `crm.lead_created` · `crm.quotation_accepted` | crm | automation | ลีดใหม่ / ลูกค้าตอบรับใบเสนอราคา |
| `quality.inspection_completed` · `quality.ncr_raised` | quality | automation | QC ไม่ผ่าน / NCR ร้ายแรง |
| `booking.requested` | booking | automation | การจองที่ต้องอนุมัติ |
| `assets.repair_reported` | assets | automation | ทรัพย์สินแจ้งซ่อม |

## กฎการเปลี่ยน contract

- เพิ่ม field แบบ optional = ใช้ได้ทันที (ลูกค้าเก่ายังทำงาน)
- ลบ/เปลี่ยนชื่อ/เปลี่ยนความหมาย field = **สร้าง event ใหม่** เช่น `sales.delivered.v2` แล้วส่งทั้งสองแบบช่วงเปลี่ยนผ่าน
- ชื่อ event = `<module>.<สิ่งที่เกิดขึ้นแล้ว>` (past tense)
- handler ห้าม throw เพราะเหตุผลทางธุรกิจ — เรื่องเกิดขึ้นไปแล้ว ให้บันทึกความผิดปกติแทน (ตัวอย่าง: inventory ใช้ `force: true` ให้สต็อกติดลบได้เมื่อเป็น event)
