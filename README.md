# ERP Template Core — ERP แบบแยกโมดูล ขายแยกได้ ต่อยอดด้วย AI ได้

ERP สำหรับโรงงาน/SME ไทย ที่แยกเป็น **microservice ต่อฟังก์ชัน** ลูกค้าเลือกซื้อเฉพาะโมดูลที่ต้องการ ได้ source code ไปพัฒนาต่อเอง (หรือให้ AI ช่วย) และซื้อโมดูลเพิ่มทีหลังได้โดยไม่ต้องรื้อของเดิม

| โมดูล | ชื่อ | ประเภท | ทำอะไร |
| --- | --- | --- | --- |
| `identity` | ผู้ใช้และสิทธิ์ | core | บริษัท (tenant), ผู้ใช้, บทบาท, login (JWT) |
| `master-data` | ข้อมูลหลัก | core | สินค้า/วัตถุดิบ/อะไหล่, ลูกค้า/ผู้ขาย (ตรวจเลขผู้เสียภาษี) |
| `inventory` | คลังสินค้า | feature | รับ-จ่าย-โอน-ปรับปรุง, ยอดคงเหลือ, stock card |
| `purchasing` | จัดซื้อ | feature | PO + VAT, อนุมัติ, รับของบางส่วน/ทั้งหมด |
| `sales` | ขาย | feature | SO, ส่งของ, ใบกำกับภาษี (บาทถ้วน, ปี พ.ศ., PromptPay) |
| `production` | วางแผนการผลิต | feature | BOM หลายชั้น, ใบสั่งผลิต, คำนวณวัตถุดิบ (MRP) |
| `maintenance` | ซ่อมบำรุง (CMMS) | feature | ทะเบียนเครื่อง (QR), แผน PM, แจ้งซ่อม, downtime |
| `costing` | ต้นทุนการผลิต | feature | ต้นทุนเฉลี่ย, cost sheet, ต้นทุนจริงต่อใบสั่งผลิต |
| `automation` | ระบบอัตโนมัติ | feature | บอท "เมื่อ… ถ้า… ให้…" แจ้งในแอป / LINE / webhook, 8 สูตรสำเร็จรูป |

**ทุก feature module ต้องการแค่ core** — ซื้อตัวเดียวก็ใช้งานได้ ถ้าซื้อหลายตัว จะเชื่อมกันอัตโนมัติผ่าน event เช่น รับของจาก PO → สต็อกเพิ่ม + ต้นทุนเฉลี่ยอัปเดต, ปิดใบสั่งผลิต → ตัดวัตถุดิบ + รับสินค้าสำเร็จรูป + บันทึกต้นทุนจริง

## ลองเดโมคำสั่งเดียว

```bash
pnpm install && pnpm db:dev          # Postgres ใน Docker
pnpm --filter @erp/web build         # (ครั้งแรก) ให้เว็บเร็วแบบ production
DEMO_RESET=1 pnpm demo               # รันทุกโมดูล + gateway + เว็บ พร้อมข้อมูลโรงงานตัวอย่าง 6 เดือน
# เปิด http://localhost:3000  บริษัท demo · admin@demo.co.th · demo1234
```

ในเดโม: ผัง 3 มิติ 9 เครื่องจักร, PO/ใบกำกับย้อนหลัง 6 เดือน, ใบสั่งผลิตทุกสถานะ, บอททุกสูตรเปิดอยู่แล้ว (กระดิ่งมีแจ้งเตือนจริง)
ลอง Ctrl+K แล้วพิมพ์ `แจ้งซ่อม PRESS-01 น้ำมันรั่ว` · `สต็อก RM-SPCC` · `ผลิต FG-BRK-100 500`
ผู้ช่วย AI: ใส่ `ANTHROPIC_API_KEY=...` ก่อน `pnpm demo` (ไม่ใส่ก็ใช้ส่วนอื่นได้ครบ)

## หน้าจอ web และ mobile

หน้าจอของแต่ละโมดูลเขียนเป็น "ข้อมูล" อยู่ในโฟลเดอร์ของโมดูลเอง (`services/<module>/src/ui.ts`) แล้ว web (Next.js) กับ mobile (Expo) วาดหน้าจอจากข้อมูลนั้น — **ขายโมดูลไหน หน้าจอโมดูลนั้นก็ติดไปด้วย** ลูกค้าที่ไม่ได้ซื้อจะไม่เห็นเมนูและไม่มีโค้ดหน้าจอนั้นในแพ็กเกจ

- web: ภาพรวมโรงงาน (ผัง 3 มิติ, ตัวเลข, กราฟ, บอทล่าสุด), ⌘K สั่งงานภาษาไทย + ค้นหา + ถาม AI, กระดิ่งแจ้งเตือน, เมนูตามโมดูลที่ติดตั้ง + สิทธิ์, ฟอร์มพร้อมค้นหาสินค้า/คู่ค้า, ปุ่มและแถบขั้นตอนตามสถานะเอกสาร, พิมพ์ใบกำกับภาษี (QR พร้อมเพย์), โหมดมืด, GSAP motion
- mobile: หน้า "งานวันนี้" (ตัวเลข + บอทล่าสุด) และเฉพาะงานหน้าไลน์ (`mobile: true`) เช่น แจ้งซ่อม/ปิดงานซ่อม, รับ-จ่ายสต็อก, อนุมัติ PO, รายงานผลผลิต — สแกน QR เครื่องจักรและบาร์โค้ดสินค้าได้

รายละเอียด: [docs/ui.md](docs/ui.md)

## เริ่มต้น (developer)

```bash
pnpm install
pnpm db:dev        # Postgres ใน Docker
pnpm check         # typecheck + test ทุกโมดูล + e2e + ตรวจกฎสถาปัตยกรรม
pnpm test:ui       # build web แล้วทดสอบผ่าน browser จริง
pnpm --filter @erp/web dev        # http://localhost:3000
pnpm --filter @erp/mobile start   # เปิดด้วย Expo Go บนมือถือ
```

## ขายแยกโมดูล (ฝั่ง GO Along)

```bash
pnpm erp catalog                                   # รายการโมดูล ราคา bundle
pnpm erp quote sales,inventory,purchasing          # ใบเสนอราคา (เลือก bundle ที่ถูกที่สุดให้อัตโนมัติ)
pnpm erp license keygen                            # ครั้งแรกครั้งเดียว (private key อยู่ใน keys/ ห้าม commit)
pnpm erp license issue --customer "ACME" --modules sales,inventory --updates-until 2027-10-31
pnpm erp pack sales,inventory --customer "ACME" --license <token>   # ได้โฟลเดอร์ dist/acme มีแค่โมดูลที่ซื้อ
```

ลูกค้าได้: source code เฉพาะโมดูลที่ซื้อ + kernel/contracts/thai + gateway + เอกสารสำหรับ AI + `deploy/` (docker compose) + smoke test

รายละเอียด: [docs/selling-and-licensing.md](docs/selling-and-licensing.md) · สถาปัตยกรรม: [docs/architecture.md](docs/architecture.md) · event: [docs/events.md](docs/events.md) · ต่อยอดด้วย AI: [docs/extending-with-ai.md](docs/extending-with-ai.md)

## หน้าเว็บขาย (landing page)

```bash
pnpm site --serve      # site/dist + http://localhost:4321 — ราคาอ่านจาก catalog/catalog.json เสมอ
```
แก้ข้อความ/ช่องทางติดต่อใน `site/site.config.json` (`contact.leadEndpoint` = URL รับฟอร์ม เช่น Google Apps Script / Make; ถ้าไม่ใส่จะเปิดอีเมลให้)
โฟลเดอร์ `site/` และ `catalog/` ไม่ถูกแพ็กส่งลูกค้า

## ติดตั้งให้ลูกค้า

```bash
pnpm erp compose maintenance,inventory --out deploy/factory-a
cd deploy/factory-a && cp .env.example .env && docker compose up -d --build
# web: http://localhost:3000  ·  API gateway: http://localhost:8080
```
