# ERP Template Core — ERP แบบแยกโมดูล ขายแยกได้ ต่อยอดด้วย AI ได้

ERP สำหรับโรงงาน/SME ไทย ที่แยกเป็น **microservice ต่อฟังก์ชัน** ลูกค้าเลือกซื้อเฉพาะโมดูลที่ต้องการ ได้ source code ไปพัฒนาต่อเอง (หรือให้ AI ช่วย) และซื้อโมดูลเพิ่มทีหลังได้โดยไม่ต้องรื้อของเดิม

| โมดูล | ชื่อ | ประเภท | ทำอะไร |
| --- | --- | --- | --- |
| `identity` | ผู้ใช้และสิทธิ์ | core | บริษัท (tenant), ผู้ใช้, บทบาท + แม่แบบบทบาทตามแผนก, login (JWT), ข้อมูลบริษัท/หัวกระดาษตามมาตรา 86/4 |
| `master-data` | ข้อมูลหลัก | core | สินค้า/วัตถุดิบ/อะไหล่, ลูกค้า/ผู้ขาย (ตรวจเลขผู้เสียภาษี), นำเข้า CSV |
| `inventory` | คลังสินค้า | feature | รับ-จ่าย-โอน-ปรับปรุง, ยอดคงเหลือ, stock card, คลังกักกัน QC-HOLD, ตรวจสต็อกติดลบ |
| `purchasing` | จัดซื้อ | feature | PO + VAT, อนุมัติ, รับของบางส่วน/ทั้งหมด, ส่งคืนผู้ขาย |
| `sales` | ขาย | feature | SO, ส่งของ, ใบกำกับภาษี (บาทถ้วน, พ.ศ., PromptPay), ใบรับเงิน + หัก ณ ที่จ่าย, มัดจำ, อายุลูกหนี้ |
| `production` | วางแผนการผลิต | feature | BOM หลายชั้น, ใบสั่งผลิต, คำนวณวัตถุดิบ (MRP) |
| `maintenance` | ซ่อมบำรุงเครื่องจักร | feature | ทะเบียนเครื่อง (QR), แผน PM, แจ้งซ่อม, downtime, อะไหล่ตัดสต็อก |
| `costing` | ต้นทุนการผลิต | feature | ต้นทุนเฉลี่ย, cost sheet, ต้นทุนจริงต่อใบสั่งผลิต |
| `quality` | ควบคุมคุณภาพ | feature | แผนตรวจรับ/ระหว่างผลิต/ก่อนส่ง, NCR + 5-Why + CAPA, คุณภาพผู้ขาย |
| `automation` | ระบบอัตโนมัติ | feature | บอท "เมื่อ… ถ้า… ให้…" แจ้งในแอปถึงตัวบุคคล / LINE ส่วนตัวหรือกลุ่ม / webhook, 26 สูตรสำเร็จรูป |
| `approvals` | อนุมัติออนไลน์ | feature | คำขออนุมัติ/e-Memo สายอนุมัติหลายขั้น, ตีกลับ, มอบอำนาจอนุมัติแทน |
| `expense` | เบิกค่าใช้จ่าย | feature | ใบเบิกพร้อมรูปใบเสร็จและ VAT, วงเงินต่อคน, เงินทดรองและเคลียร์ |
| `hr` | บุคคลและลงเวลา | feature | ทะเบียนพนักงาน/แผนก/หัวหน้า, ใบลาไปหาหัวหน้าตามผังองค์กร, ลงเวลา GPS |
| `payroll` | เงินเดือน | feature | เงินเดือน/ค่าจ้างรายวัน, OT, ประกันสังคม, กองทุนฯ, ภ.ง.ด.1, สลิปและ 50 ทวิ บนมือถือ |
| `accounting` | บัญชี | feature | ผังบัญชี SME ไทย, JV, ลงบัญชีอัตโนมัติจากขาย/ซื้อ/เบิก/เงินเดือน, ปิดงวด, งบการเงิน, ภ.พ.30 |
| `booking` | จองห้องและรถ | feature | ห้องประชุม รถ อุปกรณ์ส่วนกลาง ไม่ชนกัน, อนุมัติการจอง, เลขไมล์ |
| `assets` | ทะเบียนทรัพย์สิน | feature | ทรัพย์สินพร้อม QR, ผู้ถือ/สถานที่, ค่าเสื่อมเส้นตรง, ตรวจนับด้วยการสแกน |
| `crm` | ลูกค้าสัมพันธ์และใบเสนอราคา | feature | ลีด → โอกาสขาย → ใบเสนอราคา (ฉบับแก้ไข) → ร่างใบสั่งขาย |
| `helpdesk` | แจ้งปัญหาและบริการ | feature | ticket จากเว็บ/โทร/LINE/อีเมล, SLA ตามเวลาทำการ, ฐานความรู้ |
| `projects` | โครงการ งาน และ timesheet | feature | งบโครงการ, งวดงาน, บอร์ดงาน, timesheet รายสัปดาห์เทียบงบ |
| `contracts` | สัญญาบริการ MA | feature | สัญญา MA + อุปกรณ์/Serial + SLA, นัด PM ตามรอบ, ตรวจเช็คบนมือถือ, งวดวางบิล, ต่ออายุ |
| `estimating` | ประเมินราคางานพิมพ์ | feature | ตารางต้นทุนกระดาษ/เครื่องพิมพ์/งานหลังพิมพ์ (นำเข้า Excel), สูตรคำนวณแก้เองได้, ใบประเมินราคาหลายยอดพิมพ์ → ร่างใบเสนอราคา |

**ทุก feature module ต้องการแค่ core** — ซื้อตัวเดียวก็ใช้งานได้ ถ้าซื้อหลายตัว จะเชื่อมกันอัตโนมัติผ่าน event เช่น รับของจาก PO → สต็อกเพิ่ม + ต้นทุนเฉลี่ยอัปเดต, ปิดใบสั่งผลิต → ตัดวัตถุดิบ + รับสินค้าสำเร็จรูป + บันทึกต้นทุนจริง

## ลองเดโมคำสั่งเดียว

```bash
pnpm install && pnpm db:dev          # Postgres ใน Docker
pnpm --filter @erp/web build         # (ครั้งแรก) ให้เว็บเร็วแบบ production
DEMO_RESET=1 pnpm demo               # รันทุกโมดูล + gateway + เว็บ พร้อมข้อมูลโรงงานตัวอย่าง 6 เดือน
# เปิด http://localhost:3000  admin@demo.co.th · demo1234 (ไม่ต้องใส่รหัสบริษัท)
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

ทุกโมดูลมี connection pool ของตัวเอง (ค่าเริ่มต้น 10) — ถ้ารันหลายโมดูลบนฐานข้อมูลเดียว ให้ตั้ง `DB_POOL_MAX` ให้ผลรวมไม่เกิน `max_connections` ของ Postgres (ค่าเริ่มต้น 100) เช่น 18 โมดูล × 4 = 72; ถ้าฐานข้อมูลเต็ม API จะตอบ 503 ให้ลองใหม่


```bash
pnpm erp compose maintenance,inventory --out deploy/factory-a
cd deploy/factory-a && cp .env.example .env && docker compose up -d --build
# web: http://localhost:3000  ·  API gateway: http://localhost:8080
```

### ตั้งค่า LINE OA (โมดูล automation — แจ้งเตือนส่วนตัวทาง LINE)

1. สร้าง LINE Official Account ของบริษัท แล้วเปิด Messaging API (LINE Developers → channel ของ OA นั้น) — แนะนำ OA สำหรับพนักงานแยกจาก OA ลูกค้า
2. ตั้ง env ของ service `automation`: `LINE_CHANNEL_SECRET` (Basic settings → Channel secret), `LINE_CHANNEL_ACCESS_TOKEN` (Messaging API → long-lived token),
   `PUBLIC_BASE_URL` = ที่อยู่ **https สาธารณะของ API gateway** (เช่น `https://erp-api.บริษัท.co.th`), ไม่บังคับ: `LINE_OA_ID` (เช่น `@123abcd` → QR เพิ่มเพื่อน),
   `PUBLIC_APP_URL` (ที่อยู่เว็บ ERP → ลิงก์ "เปิดดู" ในข้อความ LINE)
3. ในระบบ: ระบบอัตโนมัติ → **ตั้งค่า LINE OA** → คัดลอก Webhook URL ไปวางที่ LINE Developers → Messaging API → Webhook URL → กด Verify → เปิด **Use webhook**
   (ปิด Auto-reply messages ใน LINE OA Manager เพื่อไม่ให้ตอบซ้ำ)
4. พนักงานแต่ละคน: เพิ่มเพื่อน OA → เมนู **ผูก LINE ของฉัน** → "ขอรหัสผูกบัญชี" → พิมพ์ `ผูกบัญชี 123456` ในแชต OA (ภายใน 10 นาที)
5. เปิดสูตรสำเร็จรูปที่ส่งถึงตัวบุคคล (คำขออนุมัติ ผลอนุมัติ ใบลา ใบเบิก เรื่องแจ้งปัญหา) — ส่งทั้งในแอปและ LINE ส่วนตัวของคนที่ผูกไว้
   · ส่งเข้ากลุ่ม: เชิญบอทเข้ากลุ่ม LINE แล้วพิมพ์ `ไอดีกลุ่ม` เอารหัสไปใส่ช่อง LINE group ID ของกฎ

Webhook ต้องชี้ไปที่ gateway โดยตรง (gateway ส่ง body ไปแบบไบต์ต่อไบต์พร้อม `x-line-signature`; automation ตรวจลายเซ็นทุกครั้ง)



by goalong.co.th 
https://goalong.co.th