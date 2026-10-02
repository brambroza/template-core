# หน้าจอ (web + mobile) จาก screen definition

แต่ละโมดูลประกาศหน้าจอของตัวเองใน `services/<module>/src/ui.ts` เป็นข้อมูลล้วน (ไม่มี React) แล้ว
`apps/web` (Next.js) และ `apps/mobile` (Expo) วาดหน้าจอจากข้อมูลนี้ด้วย renderer กลาง

```
services/sales/src/ui.ts ──┐
services/inventory/src/ui.ts ─┼─> apps/*/src/modules.generated.ts (pnpm erp ui-sync / pnpm erp pack)
…                         ──┘          │
                                       ▼
            เมนู = โมดูลที่ gateway บอกว่าติดตั้ง (/api/_catalog) ∩ หน้าจอที่ build มา ∩ สิทธิ์ผู้ใช้
```

ผลคือ ขายโมดูลไหน หน้าจอโมดูลนั้นติดไปด้วยอัตโนมัติ และ `pnpm erp pack` สร้าง registry ใหม่ให้มีแค่โมดูลที่ลูกค้าซื้อ

## ชนิดหน้าจอ

| kind | ใช้ทำ | คีย์สำคัญ |
| --- | --- | --- |
| `list` | ตารางรายการ + ตัวกรอง | `endpoint`, `columns`, `filters`, `import` (นำเข้า CSV), `create`, `rowLink`, `actions` (ปุ่มบนหน้า), `rowActions` (ปุ่มต่อแถว), `rows` (path ของ array ถ้า response เป็น object เช่น `items`), `display: 'cards'` (แสดงเป็นการ์ด เช่น แกลเลอรีสูตรบอท) |
| `form` | สร้าง/แก้ไข | `method`, `endpoint`, `fields`, `lines` (ตารางรายการ), `load` (ดึงค่าเดิมมาแก้), `after` |
| `detail` | ดูเอกสาร + ปุ่มตามสถานะ | `endpoint`, `heading`, `fields`, `lines`, `actions` (`when` = แสดงเฉพาะบางสถานะ), `printable`, `flow` (แถบขั้นตอนเอกสาร 2D) |

ทุกหน้า `list` (web) มีให้อัตโนมัติ ไม่ต้องประกาศ:
- **ส่งออก CSV** — แถวที่กรองอยู่ หัวคอลัมน์ = `label` ของ `columns`, UTF-8 BOM (Excel ภาษาไทยเปิดได้ตรง), วันที่เป็นข้อความ `dd/mm/พ.ศ.`,
  เงิน/จำนวนเป็นตัวเลขล้วน (ไม่มีจุลภาค), รหัสสถานะเป็นชื่อไทย (`toCsv()` ใน ui-schema)
- **พิมพ์รายการ** — ใช้ print styles เดิม (ซ่อนเมนู/ตัวกรอง/ปุ่ม พิมพ์ตัวกรองที่ใช้อยู่ไว้หัวรายการ)
- **ตัวกรองอยู่ใน URL** — เปลี่ยนตัวกรองแล้ว URL เปลี่ยนตาม (`router.replace`, ไม่เพิ่ม history) จึงบุ๊กมาร์ก/ส่งลิงก์รายการที่กรองแล้วได้ · ใต้ตารางแสดง "แสดง N รายการ"
- จอมือถือ (web ≤ 640px): ตารางกลายเป็นการ์ดต่อแถว (หัวการ์ด = คอลัมน์แรก, ที่เหลือเป็น ป้าย: ค่า), ตัวกรองแรกแสดงอยู่ ที่เหลือพับใต้ปุ่ม "ตัวกรอง"
- ตาราง: เลขเอกสาร/รหัส/วันที่/ตัวเลข/ข้อความสั้นไม่ตัดบรรทัด, คอลัมน์ข้อความยาวได้ความกว้างขั้นต่ำ, ปุ่มต่อแถวติดขอบขวาเมื่อเลื่อนตารางด้านข้าง
- หน้า detail: ปุ่ม `tone: 'primary'` สีเหลืองได้ปุ่มเดียว (ตัวแรกที่ใช้ได้ตามสถานะ) ที่เหลือเป็นปุ่มปกติ · ค่าที่ยาว (> 60 ตัวอักษร) แสดงเต็มแถว
- mobile: ช่องค้นหาในรายการ กรองแถวที่โหลดแล้วด้วยข้อความในทุกคอลัมน์ (`filterRows()`)

`import` (นำเข้า CSV, web) — `{ endpoint, perm?, columns: [{ key, label, required? }], template? }`
ผู้ใช้เลือกไฟล์ → อ่าน CSV ในเบราว์เซอร์ (UTF-8/BOM หรือ windows-874 จาก Excel ไทย, คั่นด้วย `,` `;` หรือ tab, หัวคอลัมน์จับคู่ด้วย `label` หรือ `key`)
→ ส่ง `POST endpoint { rows, dryRun: true }` → ตารางตัวอย่างพร้อมข้อผิดพลาดรายแถว → ยืนยัน → `POST endpoint { rows }` → toast + โหลดใหม่
endpoint ต้องรับค่าเป็นข้อความ (แปลงเอง) และตอบ `{ dryRun, total, created, updated, errors: [{ row, field?, message }] }` (`row` นับจาก 1 ตามลำดับใน `rows`)
ดูตัวอย่างจริงที่ `POST /items/import` ใน services/master-data (upsert ตาม `code`, ทั้งไฟล์ในธุรกรรมเดียว, ไม่เกิน 2000 แถว) · `template` = ชื่อไฟล์แบบฟอร์มเปล่า (หัวคอลัมน์)

Action: `then` = เปิดหน้าอื่นด้วยผลลัพธ์ (`idFrom` ไม่ใส่ก็ได้), `toast` = แสดงค่าจาก response เป็นข้อความมุมจอ (เช่น ผลลองรันกฎ), `confirm`, `fields`/`lines` = ถามข้อมูลก่อน

## ภาพรวมโรงงาน (widgets)

โมดูลประกาศ `widgets` ใน ui.ts แล้วหน้าแรก (web) และหน้า "งานวันนี้" (mobile: kpi + feed) วาดให้เอง ทุกตัวอ่านจาก GET endpoint ของโมดูลนั้น (มักเป็น `/summary`) และรีเฟรชทุก 30 วินาที

| kind | ใช้ทำ | คีย์ |
| --- | --- | --- |
| `kpi` | ตัวเลขใหญ่นับขึ้น (GSAP) | `items: [{ key, label, format, tone }]` |
| `bars` | แท่งแนวนอน + เส้นเกณฑ์ (เช่น จุดสั่งซื้อ) | `rows`, `label`, `value`, `threshold` |
| `pipeline` | เอกสารไหลผ่านขั้นตอน (คล้าย kanban) | `rows`, `field`, `stages`, `title2`, `subtitle`, `link` |
| `trend` | กราฟพื้นที่ตามเวลา | `rows`, `x`, `y`, `format` |
| `floor3d` | ผังโรงงาน 3 มิติ (three.js) สีตามสถานะ | `rows`, `code`, `name`, `status`, `group`, `badge`, `link` |
| `feed` | กิจกรรมล่าสุด (เช่น บอทแจ้งเตือน) | `rows`, `title2`, `body`, `time`, `level`, `link` (ฟิลด์ที่เก็บ path ในแอป) |

`size`: `sm` (2/6) `md` (3/6) `wide` (4/6) `lg` (เต็มแถว)

หน้าแรกจัดการ์ดเป็น **หมวดงาน** (area) เพื่อให้ยังอ่านง่ายเมื่อติดตั้งครบ 18 โมดูล:
- บนสุด "ตอนนี้ในโรงงาน" = `floor3d` + `feed` (ใช้ `size` ที่ประกาศ)
- ต่อด้วยทีละหมวด (การผลิต & คลัง · ขาย & ลูกค้า · สำนักงาน & บุคคล · บริการ & โครงการ · ตั้งค่า) — ในหมวด: `kpi` เรียงเป็นแถวแบ่งความกว้างกัน,
  `pipeline` เต็มแถว, `bars`/`trend` ครึ่งแถว (ตัวสุดท้ายที่เหลือเดี่ยวเต็มแถว) — ระบบจัดขนาดให้เองเพื่อจังหวะเดียวกันทุกหมวด
- ข้อมูลโหลดเมื่อหมวดเลื่อนเข้าใกล้จอ (lazy), หมวดพับได้, ปุ่ม "เลือกการ์ดที่แสดง" ให้ผู้ใช้เลือกเอง (เก็บใน localStorage ต่อบริษัท+ผู้ใช้)
- ค่าเริ่มต้น: แสดงการ์ดที่ผู้ใช้มีสิทธิ์ทั้งหมด ยกเว้นเมื่อมีการ์ดเกิน 12 ใบ จะซ่อน `trend` ไว้ก่อน (เปิดเองได้)

## หมวดงาน (area) — เมนูและหน้าแรก

`ModuleUi.area?: 'operations' | 'commercial' | 'office' | 'service' | 'settings'` — ไม่ใส่ก็ได้ โมดูลของ GO Along มีค่าเริ่มต้นใน
`moduleArea()` (packages/ui-schema) โมดูลใหม่ของลูกค้าที่ไม่ใส่จะอยู่ "การผลิต & คลัง" · เมนู web: หัวข้อหมวดพับได้ (จำต่อผู้ใช้)
ถ้ามีมากกว่า 10 โมดูลและผู้ใช้ยังไม่เคยเลือก จะพับทุกหมวดยกเว้นหมวดที่กำลังใช้งาน · แถบไอคอนซ้ายเลื่อนได้และคั่นตามหมวด
· mobile: หน้าแรกจัดกลุ่มหน้าจอตามหมวดเดียวกัน (`groupByArea()`)

## ⌘K สั่งงานภาษาไทย ค้นหา และผู้ช่วย AI

- `commands` — คำสั่งภาษาไทย เช่น `{ keywords: ['แจ้งซ่อม'], screen: 'woNew', arg: { lookup }, restField: 'title' }`
  พิมพ์ "แจ้งซ่อม PRESS-01 น้ำมันรั่ว" → คำแรกหลัง keyword ค้นผ่าน `arg.lookup` แล้วเติมช่องตาม `assign`, ข้อความที่เหลือไปที่ `restField`
  ฟอร์มได้ค่าผ่าน URL `?f.<field>=…&l.<field>=<ป้ายของ lookup>` · หน้า list ได้เป็นตัวกรอง · `arg.openId` = เปิดหน้า detail ของรายการนั้นเลย
- `search` — ค้นหาเอกสาร/ข้อมูล (`endpoint` ควรรับ `?q=`; ระบบกรองซ้ำฝั่ง client ด้วย `label`)
- `notifications` — แหล่งข้อมูลของกระดิ่ง (`endpoint` คืน `{ unread, items }`, `readEndpoint`, `readAllEndpoint`)
- ผู้ช่วย AI (`apps/web/src/app/assist/route.ts` + `src/lib/assistant.ts`): ใช้ `ANTHROPIC_API_KEY` ของลูกค้า
  (`ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `ASSISTANT_RATE_PER_MIN`, `COMPANY_NAME` ไม่บังคับ) อ่านข้อมูลด้วย token ของผู้ใช้
  ได้เฉพาะ GET endpoint ที่หน้าจอประกาศไว้ และ "บันทึกแทน" ไม่ได้ — ทำได้แค่ส่งปุ่มเปิดฟอร์มที่กรอกไว้ให้ผู้ใช้กดเอง

## Field types

`text` `textarea` `number` `date` `select` `boolean` `email` `password`
`lookup` — ค้นหาจากโมดูลอื่นแล้วเติมหลายช่อง: `assign: { itemId: 'id', itemCode: 'code', itemName: 'name' }`, `scanField: 'code'` = มือถือสแกน QR/บาร์โค้ดได้
`multilookup` — เลือกหลายรายการ (เช่น บทบาท) · `permissions` — เลือกสิทธิ์จาก manifest ของโมดูลที่ติดตั้ง

## Formats (columns / fields)

`text` `money` `qty` `percent` `date` `datetime` (ปี พ.ศ.) `status` (ป้ายสีตามสถานะ) `label` (ชื่อไทยของรหัส) `boolean` `list` `qr`

## กฎ (ตรวจโดย `tests/ui/descriptors.test.ts`)

1. `endpoint` ต้องเป็น path template เดียวกับ route ใน `service.ts` (method ต้องตรง)
2. lookup ไปได้แค่โมดูลตัวเอง หรือโมดูล core (`identity`, `master-data`) — เพื่อให้ขายแยกได้
3. `perm` ทุกตัวต้องประกาศใน `module.json`
4. `import.endpoint` ต้องเป็น POST route ของโมดูลเอง, `import.perm` ต้องประกาศใน module.json, คอลัมน์ import ห้ามซ้ำ/กำกวม (key หรือ label ชนกัน)
5. ลิงก์ไปหน้าจอ (`rowLink`, `create`, `after`, `then`, widget `href`/`link`, command/search `screen`) ต้องมีอยู่จริง
6. หน้าจอที่เปิดด้วย id (`/m/<module>/<screen>/<id>`) จะเอา id ไปเติม `:param` ตัวแรกของ endpoint

## เพิ่มความสามารถใหม่ให้ renderer

ต้องการ field หรือ format ใหม่ (เช่น ลายเซ็น, แนบรูป): เพิ่ม type ใน `packages/ui-schema/src/index.ts`
แล้วทำทั้งใน `apps/web/src/components` และ `apps/mobile/src/components` — อย่าเขียนหน้าจอเฉพาะโมดูลใน apps

Motion: ทุก animation ผ่าน `apps/web/src/lib/motion.ts` (GSAP) และหยุดเองเมื่อผู้ใช้ตั้ง prefers-reduced-motion
ผัง 3 มิติ (`widgets/Floor3D.tsx`) โหลด three.js แบบ lazy เฉพาะเมื่อมี widget `floor3d`

## รันและทดสอบ

```bash
pnpm --filter @erp/web dev                 # GATEWAY_URL=http://localhost:8080 (ค่าเริ่มต้น)
pnpm --filter @erp/mobile start            # EXPO_PUBLIC_GATEWAY_URL=http://<lan-ip>:8080 หรือกรอกในหน้า login
pnpm test:ui                               # build web + ทดสอบผ่าน Chromium (ลูกค้าครบชุด และลูกค้าที่ซื้อแค่ซ่อมบำรุง)
pnpm --filter @erp/mobile bundle:check     # ตรวจว่า bundle Android ได้
```
