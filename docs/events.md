# Event catalogue

นิยาม schema อยู่ใน `packages/contracts/src/index.ts` (zod) — ไฟล์นี้คือแผนที่ว่าใครส่ง ใครรับ

| Event | ส่งโดย | รับโดย | ผล |
| --- | --- | --- | --- |
| `master.item_upserted` | master-data | — | (ให้โมดูลที่ต้องการ cache ชื่อสินค้าใช้) |
| `master.partner_upserted` | master-data | — | |
| `purchasing.goods_received` | purchasing | inventory, costing | สต็อกเข้า, ต้นทุนเฉลี่ยเคลื่อนที่ |
| `sales.order_confirmed` | sales | — | (เช่น จองสต็อก, แจ้ง LINE) |
| `sales.delivered` | sales | inventory | ตัดสต็อกสินค้า |
| `sales.invoiced` | sales | — | (เช่น ลงบัญชีลูกหนี้) |
| `production.completed` | production | inventory, costing | ตัดวัตถุดิบ + รับ FG, ต้นทุนจริงต่อ job |
| `maintenance.parts_used` | maintenance | inventory | ตัดอะไหล่ |
| `inventory.stock_changed` | inventory | — | (เช่น แจ้งเตือนจุดสั่งซื้อ) |

## กฎการเปลี่ยน contract

- เพิ่ม field แบบ optional = ใช้ได้ทันที (ลูกค้าเก่ายังทำงาน)
- ลบ/เปลี่ยนชื่อ/เปลี่ยนความหมาย field = **สร้าง event ใหม่** เช่น `sales.delivered.v2` แล้วส่งทั้งสองแบบช่วงเปลี่ยนผ่าน
- ชื่อ event = `<module>.<สิ่งที่เกิดขึ้นแล้ว>` (past tense)
- handler ห้าม throw เพราะเหตุผลทางธุรกิจ — เรื่องเกิดขึ้นไปแล้ว ให้บันทึกความผิดปกติแทน (ตัวอย่าง: inventory ใช้ `force: true` ให้สต็อกติดลบได้เมื่อเป็น event)
