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

**ทุก feature module ต้องการแค่ core** — ซื้อตัวเดียวก็ใช้งานได้ ถ้าซื้อหลายตัว จะเชื่อมกันอัตโนมัติผ่าน event เช่น รับของจาก PO → สต็อกเพิ่ม + ต้นทุนเฉลี่ยอัปเดต, ปิดใบสั่งผลิต → ตัดวัตถุดิบ + รับสินค้าสำเร็จรูป + บันทึกต้นทุนจริง

## เริ่มต้น (developer)

```bash
pnpm install
pnpm db:dev        # Postgres ใน Docker
pnpm check         # typecheck + test ทุกโมดูล + e2e + ตรวจกฎสถาปัตยกรรม
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

## ติดตั้งให้ลูกค้า

```bash
pnpm erp compose maintenance,inventory --out deploy/factory-a
cd deploy/factory-a && cp .env.example .env && docker compose up -d --build
```
