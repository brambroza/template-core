# สถาปัตยกรรม

```
     apps/web (Next.js)   apps/mobile (Expo)
       เมนู = โมดูลที่ติดตั้ง ∩ หน้าจอที่ build มา
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
- token ต้องมี `exp` เสมอ, alg ไม่อ่านจาก header (HS256 ตายตัว); service/gateway ไม่ยอม start ถ้า `JWT_SECRET`/`INTERNAL_TOKEN` ยังเป็นค่าตัวอย่าง
  (และใน `NODE_ENV=production` ต้องยาว ≥ 32 ตัวและไม่ซ้ำกัน) · ให้สิทธิ์ได้เฉพาะสิทธิ์ที่ตัวเองมี · login ผิด 10 ครั้ง/15 นาที ต่ออีเมล + IP (และไม่เกิน 50 ต่ออีเมล, 100 ต่อ IP) → 429 (นับใน Postgres ใช้ร่วมกันทุก instance) — IP มาจาก header `x-erp-client-ip` ที่ gateway ใส่เอง (หลัง load balancer ตั้ง `TRUST_PROXY` = address ของ proxy)
  — รายละเอียดและสิ่งที่ยังค้าง: `docs/security/review-0.3.md`
- **ยกเลิก token ได้** (wave 9, SEC-07): token มี `jti` ไม่ซ้ำ; ออกจากระบบ (= ทุกอุปกรณ์), เปลี่ยนรหัสผ่าน, ปิดบัญชี, เปลี่ยนบทบาท และ "บังคับออกจากระบบ"
  ทำให้ identity ส่ง `identity.tokens_revoked` → gateway ส่งให้ **ทุก**โมดูล → kernel ของแต่ละโมดูลเก็บใน `_revoked_tokens` (RLS) และปฏิเสธ token
  ที่ออกก่อนเวลานั้น (401 `session_revoked` "เซสชันถูกยกเลิก กรุณาเข้าสู่ระบบใหม่"); `auth()` ยังเป็น sync เพราะ kernel ถือรายการไว้ในหน่วยความจำ
  (โหลดตอนเริ่ม + เมื่อได้รับ event + โหลดซ้ำทุก 30 วิ) — ดีเลย์: identity ทันที, โมดูลอื่น ~1 วิ, instance อื่นของโมดูลเดียวกันไม่เกิน 30 วิ

## ไฟล์แนบและประวัติการแก้ไข (ความสามารถของ kernel)

ทุกโมดูลได้สองอย่างนี้จาก kernel โดยไม่ต้องเขียนโค้ดในโมดูล — ข้อมูลอยู่ใน **ฐานข้อมูลของโมดูลเอง** (ไม่มีตารางกลาง จึงยังขายแยกได้)
และเป็นข้อมูลของบริษัท: ตาราง `_attachments` / `_audit` มี `tenant_id` + RLS แบบเดียวกับตาราง `-- @tenant` (kernel สร้างใน `migrate()`)

**ไฟล์แนบ** — โมดูลเปิดใช้ด้วย `ServiceDefinition.attachments`:

```ts
attachments: {
  read: 'expense.claim.read',                 // สิทธิ์ดู/เปิดไฟล์ (string หรือ array = มีตัวใดตัวหนึ่งก็พอ)
  write: 'expense.claim.write',               // สิทธิ์แนบ; ผู้แนบลบไฟล์ของตัวเองได้, ลบของคนอื่น = `<module>.attachment.delete`
  entities: {
    claim: { table: 'claims', access: (c, a, id) => loadClaim(c, id, a) },  // access = กฎการมองเห็นแถว (โยน 403/404 = ไม่ให้)
    machine: 'machines',                      // แค่ตรวจว่าเรคคอร์ดมีจริงในบริษัทนี้
  },
}
```

| route | |
| --- | --- |
| `GET /_attachments?ref=<entity>:<id>` | รายการไฟล์ (ไม่มีเนื้อไฟล์) + `can_delete` |
| `POST /_attachments { ref, fileName, contentType?, dataBase64 }` | ≤ 5 MB หลัง decode, ≤ 30 ไฟล์ต่อเรคคอร์ด; jpg/png/webp/heic/pdf/xlsx/docx/csv/txt — ตรวจทั้งนามสกุลและ **magic bytes** (ไม่เชื่อ content type ที่ client ส่ง), ชื่อไฟล์ตัด path/อักขระต้องห้าม |
| `GET /_attachments/:id/content` | ส่งไฟล์ (`content-disposition` ชื่อไทยแบบ RFC 6266, `nosniff`, CSP sandbox) — ใช้ Bearer token หรือ signed link |
| `GET /_attachments/:id/link` | ลิงก์ที่เซ็นด้วย HMAC (`JWT_SECRET`) อายุ 5 นาที สำหรับแอปมือถือเปิดไฟล์ในตัวดูของเครื่อง |
| `DELETE /_attachments/:id` | ผู้แนบ (ที่ยังมีสิทธิ์ write) หรือ `<module>.attachment.delete` |

ทุก perm ใน `attachments` และ `<module>.attachment.delete` ต้องประกาศใน module.json (createService ตรวจ) โมดูลที่ไม่เปิดใช้ไม่มี route เหล่านี้
ไฟล์เก็บเป็น `bytea` — พอสำหรับ SME (ใบเสร็จ รูปถ่าย PDF); ถ้าปริมาณมากให้ย้ายเนื้อไฟล์ไป object storage ใน kernel โดยไม่เปลี่ยน API
gateway รับ body ได้ 8 MB และส่งต่อ `content-disposition` / `cache-control` / `x-content-type-options` / `content-security-policy`

**ประวัติการแก้ไข (audit log)** — ทุก request ที่ไม่ใช่ GET ของผู้ใช้ที่ login (สถานะ < 400) ถูกบันทึกลง `_audit` ของโมดูลนั้น:
เวลา, user id + ชื่อจาก token, method, route template (`/claims/:id/approve`), รหัสเรคคอร์ด (`:id` → param แรก → `id` ใน response ของการสร้าง;
แนบ/ลบไฟล์ = เรคคอร์ดเจ้าของไฟล์), status, body ที่ตัดข้อมูลลับแล้ว (ตัดฟิลด์ที่ชื่อมี password/secret/token, ลงท้าย Base64, ขึ้นต้น logo; ไม่เกิน 2 KB)
บันทึกใน hook `onSend` หลัง transaction ธุรกิจ commit แล้ว (ถ้าบันทึก audit ล้ม จะ log error แต่ไม่ทำให้รายการล้ม) — event handler และ route internal/public ไม่บันทึก
อ่านด้วย `GET /_audit?from=&to=&userId=&ref=&q=&limit=` (วันที่ล้วน = วันตามเวลาไทย, `to` รวมวันนั้น) ต้องมีสิทธิ์ **`<module>.audit.read`**
(หรือ `<module>.*` / `*`) — kernel เติม permission นี้ให้ทุกโมดูลใน `/_manifest` เอง ไม่ต้องประกาศใน module.json

## แพ็กเกจคลาวด์ (Factory OS Cloud)

- บริษัทที่สมัครแพ็กเกจมีแถวใน `identity.tenant_subscriptions` (Starter / Factory / Business ใน `services/identity/src/plans.ts`) — ไม่มีแถว = ไม่จำกัด (ติดตั้งเอง)
- login ใส่รายการโมดูลของแพ็กเกจใน token (`mods`) → kernel ของทุกโมดูลปฏิเสธบริษัทที่แพ็กเกจไม่รวมโมดูลนั้น (403 `module_not_in_plan`)
  และ gateway ซ่อนเมนูของโมดูลนั้นใน `/api/_catalog` (อ่าน claim โดยไม่ตรวจลายเซ็น — ใช้แค่ซ่อนเมนู)
- สมัครเอง: หน้า `/signup` → อีเมลยืนยัน (Resend/SendGrid) → สร้างบริษัท + ทดลอง 14 วัน · ลืมรหัสผ่าน `/forgot-password` → `/reset-password`
  · Turnstile CAPTCHA เมื่อตั้ง `TURNSTILE_SECRET` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` · ลิงก์ในอีเมลใช้ `APP_URL` เท่านั้นใน production
- ทดลอง 14 วัน → ชำระด้วยการโอน แล้วทีม GO Along ยืนยัน (`pnpm erp plan set <code> --status active --paid-through …`) · เลยกำหนด 7 วัน หรือถูกระงับ → login ได้ 402 พร้อมเหตุผล
  token ไม่มีอายุเกินวันที่ใช้ได้ · เปลี่ยนแพ็กเกจ/สถานะ → ยกเลิก token ของทุกคนในบริษัท ให้ login ใหม่พร้อมโมดูลชุดใหม่
- event ยังส่งถึงทุกโมดูลที่ติดตั้ง (โมดูลนอกแพ็กเกจรับ event ของบริษัทนั้นได้ แต่ผู้ใช้เปิดดูไม่ได้)

## License

- ใบอนุญาต = JSON ที่เซ็นด้วย Ed25519 (private key อยู่ที่ GO Along เท่านั้น) ระบุลูกค้า + โมดูล + วันหมดอายุ
- service ตรวจตอน start: core ผ่านเสมอ, feature ต้องอยู่ในใบอนุญาต, production ต้องมีใบอนุญาต
- ลูกค้าได้ source code จึงลบการตรวจได้ — license นี้เป็นกรอบสัญญาและกันการใช้ผิดขอบเขตโดยไม่ตั้งใจ ไม่ใช่ DRM คุณค่าที่ขายจริงคืออัปเดต + ซัพพอร์ต

## ข้อจำกัดที่รู้อยู่ (เวอร์ชันนี้)

- เงินใช้ `numeric(18,4)` ใน DB แต่คำนวณเป็น JS number + ปัดทศนิยม — พอสำหรับ SME ถ้าต้องแม่นระดับบัญชีให้เปลี่ยนเป็น decimal library ใน `@erp/thai`
- อัปโหลดไฟล์ส่งเป็น base64 ใน JSON (ใหญ่ขึ้น ~33%, จำกัด 5 MB ต่อไฟล์) — ยังไม่รองรับ multipart/streaming
- audit log ไม่มี "ค่าก่อนแก้" (บันทึกสิ่งที่ส่งมา ไม่ใช่ diff) และยังไม่มีการลบ/เก็บถาวรอัตโนมัติ
- dispatcher ถือ transaction ระหว่างส่ง HTTP — พอสำหรับปริมาณ SME
- Docker image ใช้ไฟล์เดียวกันทุก service (`pnpm install` ทั้ง repo) — image ใหญ่กว่าที่จำเป็น ปรับเป็น multi-stage/`pnpm deploy` ได้เมื่อขึ้น production จริง
