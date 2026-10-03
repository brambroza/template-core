# เผยแพร่หน้าแลนดิ้ง + ระบบตัวอย่าง (Showcase) บน Vercel

เว็บสาธารณะหนึ่งโปรเจกต์บน Vercel:

| URL | คืออะไร |
| --- | --- |
| `/` | หน้าแลนดิ้ง (site/ → `pnpm site`) ปุ่ม “ลองใช้ระบบจริง” ชี้ไป `demoUrl` ใน `site/site.config.json` (= `/login`) |
| `/login` | เลือกบทบาท “เข้าชมในฐานะ …” (ผู้ดูแลระบบ ฝ่ายขาย ฝ่ายบัญชี ช่างซ่อมบำรุง ฝ่ายบุคคล คลังสินค้า) — ไม่มีรหัสผ่าน |
| `/app` | ภาพรวมวันนี้ (แดชบอร์ด) — ในโหมดปกติอยู่ที่ `/` เหมือนเดิม |
| `/m/<module>/<screen>/…` | หน้าจอจริงทุกโมดูล ตัวเดียวกับที่ส่งมอบลูกค้า (apps/web) |

ไม่มี gateway ไม่มีฐานข้อมูล: เมื่อตั้ง `SHOWCASE=1` เส้นทาง `/api/*` ของ apps/web ตอบจากไฟล์ที่บันทึกไว้
`apps/web/showcase/snapshot.json` แทนการส่งต่อไป gateway — ข้อมูลเป็นบริษัทสมมติจาก `pnpm demo`

## ตั้งค่าโปรเจกต์บน Vercel (ทำครั้งเดียว)

1. **Add New → Project** แล้วเลือก repo นี้
2. **Root Directory:** `apps/web` (ปล่อย “Include files outside the root directory in the Build Step” เปิดไว้ — ค่าเริ่มต้น)
3. **Framework Preset:** Next.js — คำสั่ง install/build อ่านจาก `apps/web/vercel.json` อยู่แล้ว ไม่ต้องกรอกเอง:
   - Install Command: `pnpm install` (ติดตั้งทั้ง workspace)
   - Build Command: `cd ../.. && pnpm showcase:build`
   - Output Directory: `.next`
4. **Environment Variables** (Production และ Preview):
   - `SHOWCASE` = `1` ← จำเป็น
   - ไม่ต้องใส่ `GATEWAY_URL`, `JWT_SECRET`, `ANTHROPIC_API_KEY` หรือคีย์ใด ๆ — โหมดนี้ไม่เรียก gateway และไม่เรียก AI (ถึงจะใส่ไว้ก็ถูกปิด)
5. **Node.js Version:** 22.x · ใช้ pnpm 10 (มาจาก `packageManager` ใน package.json ราก)
6. Deploy แล้วเปิด `/` → กด “ลองใช้ระบบจริง”

> `vercel.json` อยู่ที่ `apps/web/` ไม่ใช่รากของ repo เพราะ Vercel อ่าน vercel.json จาก Root Directory
> และต้องเห็น `next` ใน package.json ของโฟลเดอร์นั้นจึงจะใช้ Next.js builder ได้

## ทำอะไรบ้างตอน build (`pnpm showcase:build`)

1. `pnpm site` → `site/dist` (ราคา/โมดูลจาก catalog เหมือนเดิม)
2. คัดลอก `site/dist` → `apps/web/public/landing` (ไม่เข้า git)
3. `next build` ใน apps/web ด้วย `SHOWCASE=1` → `next.config.ts` จะ
   - rewrite `/` → `/landing/index.html` และ `/assets/*`, `/vendor/*` → `/landing/…` (รูปและ GSAP ของหน้าแลนดิ้ง)
   - ฝัง `NEXT_PUBLIC_SHOWCASE=1` ให้ฝั่งเบราว์เซอร์ (แถบ “โหมดตัวอย่าง”, หน้าเลือกบทบาท, แดชบอร์ดที่ `/app`)
   - แนบ `showcase/snapshot.json` ไปกับฟังก์ชัน `/api` (`outputFileTracingIncludes`)

บนเครื่องตัวเอง build จะลง `apps/web/.next-showcase` (ไม่ทับ `.next` ของ build ปกติ/เดโมที่รันอยู่) — บน Vercel ลง `.next` ตามปกติ

## ลองบนเครื่องก่อน deploy

```
pnpm showcase:build
PORT=3950 pnpm showcase:start     # เปิด http://localhost:3950 — ไม่ต้องมี gateway
```

## อัปเดตข้อมูลตัวอย่าง

```
pnpm demo                          # เปิดเดโม (gateway :8080) — DEMO_RESET=1 เพื่อเริ่มข้อมูลใหม่
pnpm erp showcase-capture          # เดินทุกหน้าจอ บันทึก → apps/web/showcase/snapshot.json (~3.9 MB)
```

ตัวเลือก: `--gateway http://127.0.0.1:8080` `--tenant demo` `--password demo1234` `--rows 5` (จำนวนเอกสารที่เปิดดูได้ต่อรายการ) `--out <ไฟล์>`

- เครื่องมือเดินหน้าจอจากคำอธิบายหน้าจอของทุกโมดูล (`services/*/src/ui.ts`) เอง: เมนู รายการ การ์ดแดชบอร์ด กระดิ่งแจ้งเตือน
  ช่องค้นหา (lookup) คำสั่ง ⌘K แล้วเปิดเอกสาร 5 รายการแรกของทุกรายการ (รายละเอียด ใบพิมพ์ ไฟล์แนบ ประวัติการแก้ไข)
  เพิ่มโมดูลใหม่ → capture ใหม่ ไม่ต้องแก้โค้ด
- บทบาทอื่นเก็บเฉพาะคำตอบที่ต่างจากผู้ดูแลระบบ (กล่องอนุมัติของตัวเอง สลิปของตัวเอง ฯลฯ)
- ความปลอดภัย: token จริงถูกแทนด้วย `showcase-demo-token.<บทบาท>` ฟิลด์ token/secret/password/apiKey ถูกปิดเป็น `••••••`
  และจะไม่เขียนไฟล์เลยถ้ายังพบ JWT, อีเมล/เบอร์ติดต่อใน `site.config.json` หรือค่า `JWT_SECRET` ในไฟล์
- วันที่ในข้อมูลถูกเลื่อนตามจำนวนวันตั้งแต่ capture ตอนเสิร์ฟ (เช่น บอทเตือน “18 นาทีที่แล้ว” ยังดูสด กำหนดส่งยังอยู่ข้างหน้า)
  ส่วนงวดเดือน (`2026-09`) และเลขเอกสารไม่เลื่อน — แนะนำ capture ใหม่ทุก 1–2 เดือน (ใช้เวลาประมาณ 10 วินาที) ปิดการเลื่อนได้ด้วย `SHOWCASE_SHIFT_DATES=0`

## โหมดตัวอย่างทำงานอย่างไร

- **อ่าน (GET):** หาคำตอบที่ตรงทั้ง path+query ก่อน ถ้าไม่มีใช้รายการเต็มของ path นั้นแล้วกรองในหน่วยความจำ:
  `q` = แถวที่มีข้อความตรงในฟิลด์ใดก็ได้ · พารามิเตอร์อื่นที่ตรงกับชื่อฟิลด์ของแถว = กรองค่าเท่ากัน · `limit` = ตัดจำนวน
  ไม่มีเลย → 404 “ไม่มีข้อมูลนี้ในโหมดตัวอย่าง”
- **เขียน (POST/PUT/PATCH/DELETE):** ตอบ 403 `showcase_read_only` — หน้าเว็บแสดง toast “โหมดตัวอย่าง — ไม่บันทึกข้อมูล” ไม่ขึ้นข้อความแดง ไม่ออกจากระบบ
- **เข้าสู่ระบบ:** ปุ่มบทบาท → session ที่บันทึกไว้ (token ปลอม ใช้ได้เฉพาะเว็บนี้) · ออกจากระบบ = ลบ session ในเบราว์เซอร์แล้วกลับหน้าแลนดิ้ง
- **AI:** ผู้ช่วย ⌘K, สรุปให้หน่อย, ค้นหาด้วย AI, สแกนใบเสร็จ ตอบว่า “ไม่ได้เปิดในโหมดตัวอย่าง” ไม่เรียก API ใด ๆ
- **หัวความปลอดภัย** (X-Frame-Options: DENY, CSP frame-ancestors/form-action 'self') ใช้กับหน้าแลนดิ้งด้วย — แลนดิ้งอยู่ origin เดียวกัน
  ฟอร์มติดต่อส่งด้วย JavaScript (`mailto:` หรือ `fetch` ไป `contact.leadEndpoint`) จึงไม่ติด `form-action` และ CSP ไม่ได้จำกัด `connect-src`
  — ถ้าวันหนึ่งเพิ่ม `connect-src`/`default-src` ต้องใส่โดเมนของ leadEndpoint ด้วย

## ข้อจำกัดที่รู้แล้ว

- กดเปิดได้เฉพาะเอกสารที่ถูกบันทึกไว้ (5 รายการแรกของแต่ละรายการ + เครื่องจักรทุกเครื่องบนผัง 3 มิติ) รายการอื่นจะขึ้น “ไม่มีข้อมูลนี้ในโหมดตัวอย่าง”
- ตัวกรองที่ไม่ได้บันทึกไว้กรองแบบง่าย (ช่วงวันที่ เช่น `from`/`to` ไม่กรอง)
- ดาวน์โหลดไฟล์แนบ/CSV จากเซิร์ฟเวอร์ไม่มี (ปุ่ม “ส่งออก CSV” ของรายการทำในเบราว์เซอร์ จึงใช้ได้)
- build ปกติของลูกค้า (`SHOWCASE` ไม่ตั้ง) ไม่เปลี่ยน: `/api` ส่งต่อ gateway, แดชบอร์ดอยู่ที่ `/`, ไม่มีการอ่าน snapshot
