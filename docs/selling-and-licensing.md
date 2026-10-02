# ขาย แยกโมดูล และออกใบอนุญาต

## 1. ราคา

แก้ที่ `catalog/catalog.json` อย่างเดียว (ไม่ถูก pack ไปให้ลูกค้า)

- `platform` — core (identity + master-data + gateway + kernel) ทุกการติดตั้งต้องซื้อ 1 ครั้ง
- `modules` — ราคาต่อโมดูล
- `bundles` — ชุดรวมราคาพิเศษ `pnpm erp quote` จะเลือกชุดที่ถูกที่สุดให้อัตโนมัติ
- `updatePlanPct` — ค่าอัปเดต + ซัพพอร์ตรายปี (% ของราคา)

> ราคาในไฟล์เป็นตัวเลขตั้งต้นสำหรับทดสอบตลาด ต้องปรับตามการคุยกับลูกค้าจริง

## 2. ขั้นตอนต่อลูกค้า 1 ราย

```bash
pnpm erp quote maintenance,inventory                       # เสนอราคา
pnpm erp license issue --customer "บริษัท เอ จำกัด" --modules maintenance,inventory --updates-until 2027-10-31
pnpm erp pack maintenance,inventory --customer "บริษัท เอ จำกัด" --license <token>
# ส่ง dist/<slug>/ ให้ลูกค้า (เช่น push เข้า private repo ของลูกค้า)
```

## 3. ลูกค้าซื้อเพิ่มทีหลัง

1. ออก license ใหม่ที่รวมโมดูลเดิม + ใหม่
2. ส่งโฟลเดอร์ `services/<โมดูลใหม่>` (หรือ pack ใหม่แล้วให้ลูกค้า copy เฉพาะโฟลเดอร์นั้น)
3. ลูกค้าเพิ่ม service ใน `deploy/docker-compose.yml` (หรือรัน `pnpm erp compose` ใหม่) → gateway ค้นพบเอง event เริ่มไหลอัตโนมัติ

ไม่ต้อง migrate ข้อมูลเดิม เพราะแต่ละโมดูลมี database ของตัวเอง

## 4. อัปเดตเวอร์ชัน

- `packages/*` และ `apps/gateway` = แทนที่ทั้งโฟลเดอร์ได้ (ลูกค้าไม่ควรแก้)
- `services/<module>` = ลูกค้าอาจแก้แล้ว → ส่งเป็น migration ใหม่ + diff/changelog ให้ AI ของลูกค้า apply (ดู `.claude/commands/upgrade.md`)

## 5. Key ของใบอนุญาต

- `pnpm erp license keygen` สร้าง `keys/license-private.pem` (**เก็บเป็นความลับ สำรองไว้ ห้าม commit**) และ `packages/kernel/license-public.pem` (commit ได้)
- ถ้า private key หาย ต้องสร้างใหม่ → ใบอนุญาตเก่าทั้งหมดใช้ไม่ได้ ต้องออกใหม่และส่ง public key ใหม่ให้ลูกค้า
- dev/test ใช้ `ERP_LICENSE=dev` ได้ ยกเว้น `NODE_ENV=production`
