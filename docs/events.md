# Event catalogue

นิยาม schema อยู่ใน `packages/contracts/src/index.ts` (zod) — ไฟล์นี้คือแผนที่ว่าใครส่ง ใครรับ

| Event | ส่งโดย | รับโดย | ผล |
| --- | --- | --- | --- |
| `master.item_upserted` | master-data | — | (ให้โมดูลที่ต้องการ cache ชื่อสินค้าใช้) |
| `master.partner_upserted` | master-data | — | |
| `purchasing.goods_received` | purchasing | inventory, costing, quality, automation | สต็อกเข้า, ต้นทุนเฉลี่ยเคลื่อนที่, สร้างใบตรวจรับ QC |
| `sales.order_confirmed` | sales | automation | (เช่น จองสต็อก, แจ้ง LINE) — `lines` มีเฉพาะบรรทัดสินค้าสต็อก (ว่างได้ถ้าเป็นใบสั่งขายค่าบริการล้วน) |
| `sales.delivered` | sales | inventory | ตัดสต็อกสินค้า (เฉพาะบรรทัดที่มี `itemId`; ใบสั่งขายค่าบริการล้วนไม่ส่ง event นี้) |
| `sales.invoiced` | sales | automation | (เช่น ลงบัญชีลูกหนี้) — optional `customerId`, `customerName`, `dueDate` (วันครบกำหนดชำระ) |
| `sales.payment_received` | sales | — (automation ใส่ในแคตตาล็อกได้) | ใบเสร็จ `RC-…` ออกแล้ว: `kind` `payment` (ชำระใบกำกับ — `invoices[]` พร้อมยอดค้างหลังรับชำระ) หรือ `deposit` (รับมัดจำ) · `total`, `whtAmount`, `depositApplied`, `received` |
| `production.completed` | production | inventory, costing, quality, automation | ตัดวัตถุดิบ + รับ FG, ต้นทุนจริงต่อ job, ใบตรวจขั้นสุดท้าย |
| `maintenance.parts_used` | maintenance | inventory | ตัดอะไหล่ |
| `inventory.stock_changed` | inventory | — | (เช่น แจ้งเตือนจุดสั่งซื้อ) |
| `inventory.low_stock` | inventory | automation | เตือนของต่ำกว่าจุดสั่งซื้อ |
| `purchasing.po_created` · `purchasing.po_approved` | purchasing | automation | PO ยอดสูงรออนุมัติ ฯลฯ |
| `maintenance.breakdown_reported` · `maintenance.work_completed` | maintenance | automation | แจ้งช่าง / เครื่องหยุดนาน |
| `approvals.request_submitted` · `approvals.request_decided` | approvals | automation | แจ้งผู้อนุมัติคนถัดไป / แจ้งผลผู้ขอ — แจ้งรายบุคคลด้วย `nextApproverId`, optional `delegateId`/`delegateName` (ผู้รับมอบอำนาจที่มีผลวันนี้), `requesterId` |
| `expense.claim_submitted` · `expense.claim_paid` | expense | automation | เบิกเกินวงเงิน / จ่ายแล้ว (แจ้งผู้เบิก) — optional `claimantId` |
| `hr.leave_requested` · `hr.leave_decided` | hr | automation | แจ้งหัวหน้าตามผังองค์กร / แจ้งผลการลาถึงพนักงาน — optional `employeeUserId`, `approverUserId`/`approverName` (null = ฝ่ายบุคคล), `byName`, `note` |
| `helpdesk.ticket_created` · `helpdesk.ticket_resolved` | helpdesk | automation | ticket ด่วน / แจ้งผู้แจ้ง — optional `requesterUserId` บน `ticket_resolved` (ให้ helpdesk ส่งเมื่อผู้แจ้งเป็นผู้ใช้ในระบบ) |
| `crm.lead_created` · `crm.quotation_accepted` | crm | automation, sales | ลีดใหม่ / ลูกค้าตอบรับใบเสนอราคา → sales สร้างใบสั่งขายร่าง (บรรทัด ส่วนลด VAT เดิม, `ref` = เลขใบเสนอราคา, ครั้งเดียวต่อใบเสนอราคา) — ใช้ field optional `partnerId`, `customerTaxId`, `customerBranch`, `customerAddress`, `vatMode`, `lines[]` (`itemId`/`itemCode`/`itemName` หรือ `description`, `qty`, `unitPrice`, `discountPct`) |
| `quality.inspection_completed` | quality | automation, inventory | QC ไม่ผ่าน (แจ้งเตือน) · inventory ย้ายจำนวนที่ปฏิเสธเข้าคลังกักกัน `QC-HOLD` (หรือปล่อยส่วนที่ผ่านออกจาก hold) — ใช้ field optional `itemId`, `warehouseCode`, `qty`, `acceptedQty`, `sourceRef` |
| `quality.ncr_raised` | quality | automation | NCR ร้ายแรง |
| `quality.inspection_created` | quality | inventory | (ตั้งค่า `receiveIntoHoldWhenInspected`) ของรับเข้าที่รอตรวจ QC ถูกย้ายเข้า `QC-HOLD` จนกว่าจะตรวจเสร็จ |
| `purchasing.goods_returned` | purchasing | inventory | ใบส่งคืนผู้ขาย (RT-…) → ตัดสต็อกจากคลังที่ส่งคืน (มัก `QC-HOLD`) และปิดรายการกักกันของสินค้านั้น |
| `booking.requested` | booking | automation | การจองที่ต้องอนุมัติ — optional `requesterId` |
| `assets.repair_reported` | assets | automation | ทรัพย์สินแจ้งซ่อม |

ฟิลด์ที่เป็น user id (identity) ใช้ระบุผู้รับการแจ้งเตือนในแอปของ automation ได้ (`to: 'field:<ชื่อฟิลด์>'`) — ประกาศไว้ใน `userFields` ของแต่ละ event ใน `services/automation/src/catalog.ts`

## กฎการเปลี่ยน contract

- เพิ่ม field แบบ optional = ใช้ได้ทันที (ลูกค้าเก่ายังทำงาน)
- ลบ/เปลี่ยนชื่อ/เปลี่ยนความหมาย field = **สร้าง event ใหม่** เช่น `sales.delivered.v2` แล้วส่งทั้งสองแบบช่วงเปลี่ยนผ่าน
- ชื่อ event = `<module>.<สิ่งที่เกิดขึ้นแล้ว>` (past tense)
- handler ห้าม throw เพราะเหตุผลทางธุรกิจ — เรื่องเกิดขึ้นไปแล้ว ให้บันทึกความผิดปกติแทน (ตัวอย่าง: inventory ใช้ `force: true` ให้สต็อกติดลบได้เมื่อเป็น event)
