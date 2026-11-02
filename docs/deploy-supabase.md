# ติดตั้งแบบแยกส่วน: ฐานข้อมูล Supabase + เว็บ Vercel + backend บน container host

ได้ โดยไม่ต้องแก้โค้ด แต่แยกได้เป็น **3 ที่** ไม่ใช่ 2:

| ส่วน | วางที่ | ทำไม |
| --- | --- | --- |
| ฐานข้อมูล | **Supabase** (PostgreSQL ที่ดูแลให้) | สำรองข้อมูลรายวัน (แพ็กเกจ Pro ขึ้นไป) ไม่ต้องดูแลเซิร์ฟเวอร์ DB |
| เว็บ (apps/web) | **Vercel** | Next.js อยู่แล้ว ได้ HTTPS + โดเมนทันที |
| gateway + โมดูลทุกตัว | **container host**: Railway, Render, Fly.io, Google Cloud Run (CPU always allocated, min 1 instance), DigitalOcean App Platform หรือ VPS + Docker | ต้องรันค้างตลอด (ดูด้านล่าง) |

**ทำไม backend ขึ้น Vercel ไม่ได้:** โมดูลเป็น server ที่ทำงานต่อเนื่อง — ส่ง event ใน outbox ทุก 1 วินาที, โหลดรายการ token ที่ถูกยกเลิกทุก 30 วินาที
และเก็บไว้ในหน่วยความจำ, ระบบอัตโนมัติ (ตั้งเวลา/LINE) — Vercel Functions ทำงานเฉพาะตอนมีคำขอ แล้วหยุด ถ้าย้ายไปจริงต้องเขียน kernel ใหม่หลายส่วน

```
 ผู้ใช้ ─HTTPS─▶ Vercel (apps/web) ─/api/*─▶ gateway ─▶ identity, purchasing, inventory, …   ◀── container host (เครือข่ายภายใน)
 มือถือ ─HTTPS───────────────────────────▶ gateway                          │ แต่ละโมดูล login ด้วย role ของตัวเอง
                                                                            ▼
                                     Supabase: database เดียว · 1 schema + 1 role ต่อโมดูล
```

## 1. ฐานข้อมูลบน Supabase: 1 schema + 1 role ต่อโมดูล

Supabase ให้ database เดียวต่อโปรเจกต์ (ติดตั้งปกติใช้ 1 database ต่อโมดูล) จึงแยกเป็น **schema** แทน และให้แต่ละโมดูลมี **role ของตัวเอง**
ที่ `search_path` ชี้ไป schema ของมัน — migration เดิมสร้างตารางใน schema นั้นเอง และโมดูลอ่านตารางของโมดูลอื่นไม่ได้ (permission denied)
เหมือนกฎ "ห้ามอ่าน DB ของโมดูลอื่น" เดิม · Row-Level Security แยกบริษัทยังทำงานเหมือนเดิม

1. สร้างโปรเจกต์ Supabase เลือก region **Southeast Asia (Singapore)** · แพ็กเกจ **Pro ขึ้นไป** สำหรับข้อมูลจริง
   (Free ไม่มี backup รายวัน และหยุดโปรเจกต์เองถ้าใช้งานน้อยในรอบ 7 วัน)
2. เปิด `deploy/single-database.sql` (สร้างโดย `pnpm erp pack` / `pnpm erp compose`) เปลี่ยนรหัสผ่านทุก `CHANGE-ME-…`
   (`openssl rand -hex 24` คนละค่า) แล้วรันใน **SQL Editor** ครั้งเดียว
3. **อย่า**เพิ่ม schema ของโมดูลใน *Project Settings → Data API → Exposed schemas* — ระบบไม่ใช้ Data API/Auth/Storage ของ Supabase
   ข้อมูลเข้าออกผ่าน gateway เท่านั้น
4. Connection string ของแต่ละโมดูล ใช้ **Session pooler** (IPv4, พอร์ต 5432) และ user = `<role>.<project-ref>`:
   ```
   postgres://erp_purchasing.abcdefghijklmno:<รหัสของ erp_purchasing>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
   (host จริงคัดจาก *Connect* ในหน้าโปรเจกต์) หรือ Direct connection ถ้า container host รองรับ IPv6 — ไม่แนะนำ Transaction pooler (6543)
5. ตั้ง `DB_POOL_MAX=3` ให้ทุกโมดูล (ค่าเริ่ม 10 × จำนวนโมดูล อาจเกินจำนวน connection ของแพ็กเกจ) — ดูจำนวนสูงสุดในหน้า Database ของโปรเจกต์

ซื้อโมดูลเพิ่มทีหลัง: รันเฉพาะ 3 บรรทัดของโมดูลนั้นจาก `single-database.sql` รุ่นใหม่ — migration ของโมดูลสร้างตารางเองตอนเริ่มทำงาน

## 2. gateway + โมดูลบน container host

ใช้ Dockerfile เดิมของ repo (`build arg APP_DIR=services/<id>` หรือ `apps/gateway`) — 1 service ต่อโมดูล ให้คุยกันในเครือข่ายภายในของ host
และเปิดสู่ภายนอก**เฉพาะ gateway** (เช่น `https://api.<บริษัท>.co.th`)

แต่ละโมดูล:
```
DATABASE_URL=<connection string ของ role โมดูลนั้น>     JWT_SECRET=…   INTERNAL_TOKEN=…   ERP_LICENSE=…
EVENT_ROUTER_URL=http://gateway:8080/_events/publish    DB_POOL_MAX=3  NODE_ENV=production
```
gateway: `PORT=8080`, `INTERNAL_TOKEN=…`, `MODULES=identity=http://identity:3000,purchasing=http://purchasing:3000,…`
(ค่า JWT_SECRET / INTERNAL_TOKEN ใช้ชุดเดียวกันทุกตัว สุ่มด้วย `openssl rand -hex 32` — ระบบไม่ยอมเริ่มถ้ายังเป็นค่าตัวอย่าง)

สร้างบริษัทแรก (ครั้งเดียว) จาก shell ของ service identity ตามขั้นตอนที่ 3 ใน `deploy/README.md`

## 3. เว็บบน Vercel

1. New Project → repo ของลูกค้า · **Root Directory** `apps/web`
2. **Build Command** (แทนค่าใน `apps/web/vercel.json` ซึ่งเป็นของเว็บตัวอย่าง): `cd ../.. && pnpm --filter @erp/web build`
3. Environment Variables: `GATEWAY_URL=https://api.<บริษัท>.co.th` · ถ้าใช้ผู้ช่วย AI: `ANTHROPIC_API_KEY`, `COMPANY_NAME`
   — **ห้ามตั้ง** `SHOWCASE` (นั่นคือโหมดเว็บตัวอย่างแบบอ่านอย่างเดียว)
4. Functions region: **Singapore (sin1)** ให้ใกล้ Supabase และ gateway
5. แอปมือถือ: ช่อง "ที่อยู่เซิร์ฟเวอร์" ใส่ URL ของ gateway (ไม่ผ่าน Vercel)

## ข้อจำกัดที่รู้แล้ว

- **ไฟล์แนบผ่านเว็บบน Vercel ได้ไม่เกินประมาณ 3 MB** — Vercel Functions รับ request ได้สูงสุด 4.5 MB และไฟล์ถูกส่งเป็น base64 (ใหญ่ขึ้น ~33%)
  ระบบรับได้ 5 MB ถ้าเว็บรันเองบน container host หรือแอปมือถือที่ต่อ gateway ตรง
- เวลาแฝงเพิ่มเล็กน้อย: ผู้ใช้ → Vercel → gateway → Supabase เป็นคนละผู้ให้บริการ ให้อยู่ region สิงคโปร์ทั้งหมด
- backup: Supabase Pro เก็บ backup รายวัน 7 วัน ถ้าต้องการนานกว่านั้นหรือเก็บนอกระบบ ตั้ง `pg_dump` (หรือ `supabase db dump`) ตามรอบเพิ่ม

## ตรวจว่ารูปแบบนี้ทำงาน

`tests/e2e/single-database.test.ts` บูตระบบใน database เดียว (schema + role ต่อโมดูล) แล้วตรวจ: ใบสั่งซื้อรับของ → สต็อกเพิ่ม (event ไหลปกติ),
ตารางอยู่ใน schema ของโมดูล, โมดูลหนึ่งอ่านตารางของอีกโมดูลไม่ได้, RLS ยังซ่อนข้อมูลบริษัทอื่น
รันทดสอบ e2e ทั้งหมดในรูปแบบนี้: `E2E_SHARED_DB=1 pnpm vitest run tests/e2e`
