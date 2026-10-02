# สถาปัตยกรรม

```
            web / mobile app
                   │  HTTPS (JWT)
             ┌─────▼──────┐   /api/_catalog → เมนูตามโมดูลที่ติดตั้ง
             │  gateway   │   /api/<module>/* → proxy
             └─┬──┬──┬──┬─┘   /_events/publish → ส่ง event ให้โมดูลที่ subscribe
     ┌─────────┘  │  │  └──────────┐
 identity   master-data  sales  inventory  …   (แต่ละตัว = 1 container + 1 database)
```

## หลักการที่ทำให้ "ขายแยกได้"

1. **โมดูลไม่รู้จักกัน** — ไม่ import โค้ดกัน ไม่อ่าน DB กัน ไม่เรียก API กันตรงๆ
2. **คุยกันด้วย event เท่านั้น** (`packages/contracts`) — ถ้าโมดูลที่ส่ง event ไม่ได้ติดตั้ง event ก็แค่ไม่มา ระบบยังทำงาน
3. **feature module ต้องการแค่ core** (`requires`) ส่วนการเชื่อมกับโมดูลอื่นประกาศใน `enhancedBy`
4. **ข้อมูลอ้างอิงเป็น snapshot** — บรรทัดเอกสารเก็บ `itemId + itemCode + itemName` ณ ตอนบันทึก ไม่ join ข้ามโมดูล
5. `pnpm erp verify` ตรวจกฎเหล่านี้ใน CI ทุกครั้ง

## Multi-tenant

- ทุกตารางธุรกิจมี `tenant_id` + Postgres **Row-Level Security** (`-- @tenant <table>` ใน migration)
- `k.db.tx(tenantId, …)` ตั้ง `app.tenant_id` ใน transaction — query ที่ลืมกรอง tenant ก็ไม่เห็นข้อมูลบริษัทอื่น
- service ต่อ DB ด้วย role `erp_app` (ไม่ใช่ superuser) ไม่งั้น RLS จะไม่ทำงาน — test ก็รันแบบนี้

## Event (transactional outbox)

1. โมดูล A บันทึกข้อมูล + `k.emit(c, …)` ใน transaction เดียวกัน (ตาราง `_outbox`)
2. dispatcher ส่ง event ที่ค้างไป gateway ทุก 1 วินาที (`EVENT_ROUTER_URL`)
3. gateway ส่งต่อให้ทุกโมดูลที่ประกาศ `subscribes` — ถ้ามีตัวไหนล้ม ตอบ 502 → A ส่งซ้ำ
4. โมดูล B บันทึก event id ใน `_inbox` ก่อนประมวลผล (ใน transaction เดียวกัน) → ส่งซ้ำกี่ครั้งก็ทำครั้งเดียว

ผลคือ at-least-once delivery + idempotent receiver ไม่ต้องมี message broker สำหรับ SME (เปลี่ยนเป็น NATS/RabbitMQ ได้ภายหลังโดยแก้แค่ kernel + gateway)

## Auth & permission

- `identity` ออก JWT (HS256, `JWT_SECRET` ใช้ร่วมกันทุกโมดูล) มี `tid` (tenant) และ `perms`
- permission รูปแบบ `<module>.<thing>.<action>` รองรับ `<module>.*` และ `*`
- แต่ละโมดูลประกาศ permission ของตัวเองใน `module.json` → UI ดึงจาก `/api/_catalog` ไปสร้างหน้าตั้งค่าบทบาท

## License

- ใบอนุญาต = JSON ที่เซ็นด้วย Ed25519 (private key อยู่ที่ GO Along เท่านั้น) ระบุลูกค้า + โมดูล + วันหมดอายุ
- service ตรวจตอน start: core ผ่านเสมอ, feature ต้องอยู่ในใบอนุญาต, production ต้องมีใบอนุญาต
- ลูกค้าได้ source code จึงลบการตรวจได้ — license นี้เป็นกรอบสัญญาและกันการใช้ผิดขอบเขตโดยไม่ตั้งใจ ไม่ใช่ DRM คุณค่าที่ขายจริงคืออัปเดต + ซัพพอร์ต

## ข้อจำกัดที่รู้อยู่ (เวอร์ชันนี้)

- เงินใช้ `numeric(18,4)` ใน DB แต่คำนวณเป็น JS number + ปัดทศนิยม — พอสำหรับ SME ถ้าต้องแม่นระดับบัญชีให้เปลี่ยนเป็น decimal library ใน `@erp/thai`
- gateway proxy เฉพาะ JSON (ยังไม่รองรับ upload ไฟล์)
- dispatcher ถือ transaction ระหว่างส่ง HTTP — พอสำหรับปริมาณ SME
- ยังไม่มี web/mobile UI ในชุดนี้ — UI เรียก `/api/_catalog` เพื่อแสดงเมนูตามโมดูลที่ซื้อ
