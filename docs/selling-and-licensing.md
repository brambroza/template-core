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

ติดตั้งบนเซิร์ฟเวอร์ของลูกค้าด้วย Docker (`deploy/README.md`) หรือแยกส่วน: ฐานข้อมูล Supabase + เว็บ Vercel + backend บน container host
([deploy-supabase.md](deploy-supabase.md))

## 3. ลูกค้าซื้อเพิ่มทีหลัง

1. ออก license ใหม่ที่รวมโมดูลเดิม + ใหม่
2. ส่งโฟลเดอร์ `services/<โมดูลใหม่>` (หรือ pack ใหม่แล้วให้ลูกค้า copy เฉพาะโฟลเดอร์นั้น)
3. ลูกค้าเพิ่ม service ใน `deploy/docker-compose.yml` (หรือรัน `pnpm erp compose` ใหม่) → gateway ค้นพบเอง event เริ่มไหลอัตโนมัติ

ไม่ต้อง migrate ข้อมูลเดิม เพราะแต่ละโมดูลมี database ของตัวเอง

## 4. อัปเดตเวอร์ชัน

- `pnpm erp pack` เขียน `.erp/vendor-lock.json` (sha256 ของทุกไฟล์ที่ส่งมอบ) — ใช้พิสูจน์ว่าฐานยังเป็นของที่เราทดสอบ (`pnpm erp doctor`)
  และเป็นเส้นแบ่งการซัพพอร์ต: ไฟล์ที่ลูกค้าแก้เองแสดงในรายงาน doctor
- ลูกค้าต่อยอดใน `services/<module>/ext/` และโมดูลของตัวเอง (ดู [extending-with-ai.md](extending-with-ai.md)) — ไม่อยู่ใน lock ไม่ถูกอัปเดตทับ
- ส่งรุ่นใหม่ = `pnpm erp pack <โมดูลเดิม> --customer "<ชื่อเดิม>" --out <release>` แล้วลูกค้ารัน `pnpm erp upgrade <release> --apply`
  (แทนที่ไฟล์ที่ไม่ได้แก้ทั้งหมด, ไฟล์ที่ลูกค้าแก้และเราก็แก้ → เก็บของลูกค้าไว้ + วางของเราที่ `.erp/upgrade/` ให้ AI ของลูกค้ารวม — `.claude/commands/upgrade.md`)
- ซื้อโมดูลเพิ่ม: pack รุ่นใหม่ที่รวมโมดูลนั้น + license ใหม่ → `upgrade --apply` ก็เพิ่มโมดูลให้ (และรัน `pnpm erp compose` ใหม่สำหรับ deploy)

## 5. Key ของใบอนุญาต

วิธีสร้างและเก็บแบบละเอียด (ทำครั้งเดียวต่อบริษัท): [license-keys.md](license-keys.md)


- `pnpm erp license keygen` สร้าง `keys/license-private.pem` (**เก็บเป็นความลับ สำรองไว้ ห้าม commit**) และ `packages/kernel/license-public.pem` (commit ได้)
- ถ้า private key หาย ต้องสร้างใหม่ → ใบอนุญาตเก่าทั้งหมดใช้ไม่ได้ ต้องออกใหม่และส่ง public key ใหม่ให้ลูกค้า
- dev/test ใช้ `ERP_LICENSE=dev` ได้ ยกเว้น `NODE_ENV=production`
