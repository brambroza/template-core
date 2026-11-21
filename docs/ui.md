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
| `detail` | ดูเอกสาร + ปุ่มตามสถานะ | `endpoint`, `heading`, `fields`, `lines`, `actions` (`when` = แสดงเฉพาะบางสถานะ), `print` / `printable` (พิมพ์เป็นเอกสารบริษัท — ดูหัวข้อ "เอกสารพิมพ์"), `flow` (แถบขั้นตอนเอกสาร 2D) |

ทุกหน้า `list` (web) มีให้อัตโนมัติ ไม่ต้องประกาศ:
- **ส่งออก CSV** — แถวที่กรองอยู่ หัวคอลัมน์ = `label` ของ `columns`, UTF-8 BOM (Excel ภาษาไทยเปิดได้ตรง), วันที่เป็นข้อความ `dd/mm/พ.ศ.`,
  เงิน/จำนวนเป็นตัวเลขล้วน (ไม่มีจุลภาค), รหัสสถานะเป็นชื่อไทย (`toCsv()` ใน ui-schema)
- **พิมพ์รายการ** — ใช้ print styles เดิม (ซ่อนเมนู/ตัวกรอง/ปุ่ม พิมพ์ตัวกรองที่ใช้อยู่ไว้หัวรายการ)
- **ตัวกรองอยู่ใน URL** — เปลี่ยนตัวกรองแล้ว URL เปลี่ยนตาม (`router.replace`, ไม่เพิ่ม history) จึงบุ๊กมาร์ก/ส่งลิงก์รายการที่กรองแล้วได้ · ใต้ตารางแสดง "แสดง N รายการ"
- จอมือถือ (web ≤ 640px): ตารางกลายเป็นการ์ดต่อแถว (หัวการ์ด = คอลัมน์แรก, ที่เหลือเป็น ป้าย: ค่า), ตัวกรองแรกแสดงอยู่ ที่เหลือพับใต้ปุ่ม "ตัวกรอง"
- ตาราง: เลขเอกสาร/รหัส/วันที่/ตัวเลข/ข้อความสั้นไม่ตัดบรรทัด, คอลัมน์ข้อความยาวได้ความกว้างขั้นต่ำ, ปุ่มต่อแถวติดขอบขวาเมื่อเลื่อนตารางด้านข้าง
- หน้า detail: ปุ่ม `tone: 'primary'` สีเหลืองได้ปุ่มเดียว (ตัวแรกที่ใช้ได้ตามสถานะ) ที่เหลือเป็นปุ่มปกติ · ค่าที่ยาว (> 60 ตัวอักษร) แสดงเต็มแถว
- mobile: ช่องค้นหาในรายการ กรองแถวที่โหลดแล้วด้วยข้อความในทุกคอลัมน์ (`filterRows()`)

### เอกสารพิมพ์ (`print`)

หน้า `detail` ที่มี `print` (หรือ `printable: true` = `print: {}`) ได้ปุ่ม **พิมพ์ / บันทึกเป็น PDF** (หน้าต่างพิมพ์ของเบราว์เซอร์ → ปลายทาง "บันทึกเป็น PDF")
และพิมพ์เป็นเอกสารบริษัทขนาด A4:

```ts
print: {
  title: 'ใบกำกับภาษี / ใบเสร็จรับเงิน',          // หัวเอกสารบนกระดาษ (ไม่ใส่ = title ของหน้า)
  legal: 'tax-invoice',                           // 'tax-invoice' | 'receipt' | 'none' (ค่าเริ่มต้น)
  copyLabel: true,                                // ให้เลือก ต้นฉบับ / สำเนา ก่อนพิมพ์ และพิมพ์ป้ายนั้นบนเอกสาร
  signatures: ['ผู้รับเงิน', { label: 'ผู้มีอำนาจลงนาม', name: 'approved_by_name' }],  // name = path ในเรคคอร์ด พิมพ์ชื่อใต้เส้น
  signers: { path: 'steps', label: 'ผู้อนุมัติ', name: 'approver_name' },              // ช่องลายเซ็นเพิ่มหนึ่งช่องต่อแถว (เช่น สายอนุมัติ)
  footer: 'payment',                              // หมายเหตุท้ายเอกสารของบริษัท: 'payment' | true | false (ดูด้านล่าง)
}
// ช่อง/คอลัมน์/ตารางที่ไม่พิมพ์: { key: 'outstanding', label: 'ค้างชำระ', format: 'money', print: false }
```

- **หัวกระดาษ** — โลโก้ ชื่อนิติบุคคล (ไทย/อังกฤษ) ที่อยู่ เลขประจำตัวผู้เสียภาษี สำนักงานใหญ่/สาขา โทร/อีเมล/เว็บ จาก `GET /api/identity/company`
  (ตั้งค่าที่ ผู้ใช้และสิทธิ์ → ข้อมูลบริษัท, สิทธิ์ `identity.company.write`; เว็บแคชไว้ 2 นาทีต่อ session) ด้านขวา = ชื่อเอกสาร เลขที่ และป้าย ต้นฉบับ/สำเนา
- เนื้อหา = `fields` และ `lines` เดิม (ตารางพิมพ์หัวตารางซ้ำทุกหน้า แถวไม่ขาดกลางหน้า, สถานะพิมพ์เป็นตัวอักษรไม่มีสีพื้น)
- `legal: 'tax-invoice' | 'receipt'` — พิมพ์กล่อง **ลูกค้า/ผู้ซื้อ** (ชื่อ ที่อยู่ เลขผู้เสียภาษี สาขา) จาก `customer.name/address/taxId/branch`
  หรือ `customer_name/…` (`buyerInfo()`), ช่องเดียวกันใน `fields` จะไม่พิมพ์ซ้ำ; ถ้าข้อมูลบริษัทยังไม่มีเลขผู้เสียภาษี/ที่อยู่ หน้าจอแสดงคำเตือน (ไม่พิมพ์ลงกระดาษ) — ใบกำกับภาษีต้องมีตามมาตรา 86/4
- **ช่องลายเซ็น** — เส้นเซ็น, ( ชื่อ ), ตำแหน่ง, วันที่ …/…/… ; ไม่ใส่ `signatures` = ใช้ "ช่องลายเซ็นเริ่มต้น" ของบริษัท
- **ท้ายเอกสาร (`footer`)** — "หมายเหตุท้ายเอกสาร" ของบริษัท (มักเป็นเงื่อนไขการชำระเงิน "ชำระภายใน 30 วัน…") พิมพ์เฉพาะเอกสารที่ขอ:
  `'payment'` = กล่อง "เงื่อนไขการชำระเงิน" · `true` = หมายเหตุธรรมดา · `false` = ไม่พิมพ์.
  ค่าเริ่มต้น: `legal: 'tax-invoice'` → `'payment'`, อย่างอื่น → ไม่พิมพ์ (ใบสั่งซื้อ ใบเสร็จ ใบเบิก สลิป 50 ทวิ QC/NCR ใบขออนุมัติ ไม่มี "โปรดชำระเงิน")
  ใบเสนอราคาใส่ `footer: 'payment'` เอง · เลขหน้า "หน้า x / y" ทุกหน้าจาก `@page` (globals.css)
- **ไม่พิมพ์ (`print: false`)** — ใส่ใน `fields`, คอลัมน์ของ `lines` หรือทั้งตาราง `lines` ให้แสดงเฉพาะบนจอ (เจ้าของ/หมายเหตุภายใน คลังรับเข้า
  ยอดค้างชำระ ตารางรับชำระแล้ว) — เอกสารที่ส่งออกไปแล้วต้องไม่เปลี่ยนตามเวลา. ช่อง `format: 'status'` **ไม่พิมพ์โดยอัตโนมัติ**
  (ป้าย "ร่าง"/"ชำระครบ" เปลี่ยนหลังกระดาษออกไป) — ใส่ `print: true` ถ้าต้องการพิมพ์ · ข้อความแจ้งเตือน (toast) ไม่ติดหน้าพิมพ์
- **ผู้ซื้อในใบกำกับภาษี** — มีเลขผู้เสียภาษีนิติบุคคล (ขึ้นต้น 0) แต่ไม่มีสาขา → พิมพ์ "สำนักงานใหญ่" และเตือนบนจอ;
  ชื่อลูกค้าขึ้นต้น บริษัท/ห้างหุ้นส่วน/บจก./หจก. แต่ไม่มีเลขผู้เสียภาษี → เตือนบนจอ "ลูกค้าไม่มีเลขผู้เสียภาษี — ใบกำกับภาษีแบบเต็มต้องระบุ" (ไม่พิมพ์)
- helpers ใน ui-schema: `printSpec()`, `signatureBoxes()`, `buyerInfo()`, `branchText()`, `formatTaxId()`, `companyProblems()`, `printsOnPaper()`, `buyerProblems()`, `buyerBranchText()`, `looksLikeCompany()`, `isJuristicTaxId()`

`import` (นำเข้า CSV, web) — `{ endpoint, perm?, columns: [{ key, label, required? }], template? }`
ผู้ใช้เลือกไฟล์ → อ่าน CSV ในเบราว์เซอร์ (UTF-8/BOM หรือ windows-874 จาก Excel ไทย, คั่นด้วย `,` `;` หรือ tab, หัวคอลัมน์จับคู่ด้วย `label` หรือ `key`)
→ ส่ง `POST endpoint { rows, dryRun: true }` → ตารางตัวอย่างพร้อมข้อผิดพลาดรายแถว → ยืนยัน → `POST endpoint { rows }` → toast + โหลดใหม่
endpoint ต้องรับค่าเป็นข้อความ (แปลงเอง) และตอบ `{ dryRun, total, created, updated, errors: [{ row, field?, message }] }` (`row` นับจาก 1 ตามลำดับใน `rows`)
ดูตัวอย่างจริงที่ `POST /items/import` ใน services/master-data (upsert ตาม `code`, ทั้งไฟล์ในธุรกรรมเดียว, ไม่เกิน 2000 แถว) · `template` = ชื่อไฟล์แบบฟอร์มเปล่า (หัวคอลัมน์)

### ไฟล์แนบ (`attachments`) และประวัติการแก้ไข

หน้า `detail` ใส่ `attachments: { entity: 'claim', label?: 'ใบเสร็จ / หลักฐาน', perm? }` แล้วได้แผง **ไฟล์แนบ** ใต้รายการ:
- web: รายการไฟล์พร้อมไอคอน/รูปย่อ (jpg/png/webp), ปุ่ม "แนบไฟล์" (เลือกได้หลายไฟล์) หรือ **ลากไฟล์มาวาง**, เปิดในแท็บใหม่ (รูป/PDF), ดาวน์โหลด, ลบ (เฉพาะไฟล์ที่ `can_delete`)
  ตรวจขนาด (≤ 5 MB) และนามสกุลก่อนส่ง เซิร์ฟเวอร์ตรวจซ้ำรวมถึงเนื้อไฟล์
- mobile: รายการไฟล์พร้อมรูปย่อ แตะ = เปิดในตัวดูของเครื่องผ่านลิงก์ชั่วคราว (`/_attachments/:id/link`) —
  ปุ่ม **ถ่ายรูป** / **เลือกรูป** (หลายรูป) / **แนบไฟล์** (PDF, Excel, Word, CSV) ส่งเป็น base64 ไป `POST /_attachments` (ตรวจ 5 MB ก่อนส่ง) —
  ใช้ `expo-image-picker`, `expo-document-picker`, `expo-file-system` ซึ่งติดตั้งใน apps/mobile แล้ว (apps/mobile/src/components/Attachments.tsx)
- `entity` ต้องเป็นชื่อที่โมดูลเปิดใช้ใน `ServiceDefinition.attachments.entities` และ endpoint ของหน้าต้องมี `:param` (id ของเรคคอร์ด) —
  `tests/ui/descriptors.test.ts` ตรวจให้; สิทธิ์จริงอยู่ที่ฝั่ง server (ดู docs/architecture.md "ไฟล์แนบและประวัติการแก้ไข")

ทุกหน้า `detail` ที่เปิดด้วย id (web) มีส่วน **ประวัติการแก้ไข** (พับไว้, โหลดเมื่อเปิด) แสดงใคร ทำอะไร เมื่อไร กับเรคคอร์ดนี้
จาก `GET /_audit?ref=<id>` ของโมดูล — เห็นเฉพาะผู้มีสิทธิ์ `<module>.audit.read` (`auditPerm()` ใน ui-schema; `*` และ `<module>.*` รวมอยู่แล้ว)
หน้า list ทั่วไปของ log ใช้ `endpoint: '/_audit'` ได้ทุกโมดูล (ตัวอย่าง: identity `audit` — ผู้ใช้และสิทธิ์ → ประวัติการแก้ไข, ฟิลด์ `action`, `summary_text`)

### รายงานการเงิน (`report`) และยอดรวม

หน้า `list` ที่เป็นรายงาน (งบทดลอง งบกำไรขาดทุน แยกประเภท รายงานภาษี) ใส่ `report` แล้ว web วาดเป็น "งบ" แทนตารางงานทั่วไป:

```ts
profitLoss: {
  kind: 'list', endpoint: '/reports/profit-loss', rows: 'rows',
  columns: [
    { key: 'code', label: 'รหัส', phone: false },                 // จอมือถือไม่แสดงคอลัมน์นี้
    { key: 'name', label: 'รายการ', indent: true },              // ย่อหน้าตามระดับของแถว
    { key: 'month', label: 'เดือนนี้', format: 'accounting' },     // (1,250.00) ติดลบ, – = ศูนย์
  ],
  report: {
    subtitle: 'สำหรับเดือน {month|month}',                         // อ่านจาก response: |date |month |year (พ.ศ.) |money
    heading: ['section'], subtotal: ['total'], total: ['result'], // ชนิดแถวจากฟิลด์ kind (เปลี่ยนด้วย rowKind)
    muted: ['opening'], levels: { account: 1 },                   // หรือ indentFrom: 'level' (ฟิลด์ตัวเลขระดับบัญชี)
    check: { path: 'totals.balanced', ok: 'งบสมดุล', fail: 'ต่างกัน {totals.difference|money} บาท' },
  },
}
```

- แถว `heading` ตัวหนาไม่มีตัวเลข · `subtotal` ตัวหนามีเส้นบนตัวเลข · `total` ตัวหนา เส้นบน + เส้นคู่ใต้ตัวเลข · `muted` ตัวเอียงสีจาง (ยอดยกมา)
- พิมพ์ (ปุ่มพิมพ์รายการ) = หัวกระดาษบริษัท + ชื่อรายงาน + `subtitle` ด้านขวา ตารางแบบงบ ไม่พิมพ์ตัวกรอง/ปุ่ม
- จอมือถือ: รายงานยังเป็นตาราง (ไม่แปลงเป็นการ์ด) เลื่อนข้างได้ — ใส่ `phone: false` กับคอลัมน์รอง · mobile app แสดงเป็นรายการธรรมดา (ไม่อ่าน `report`)
- แถวที่ไม่มีค่าของ `rowLink.idFrom` (ยอดยกมา แถวรวม) ไม่เป็นลิงก์ · ช่องว่างในรายงานเว้นว่าง ไม่ขึ้น "—"

คีย์ของ Column ที่ใช้ได้ทั้ง list และ `lines` ของ detail:
- `total: true` — แถว "รวม" ท้ายตาราง (บวกเฉพาะแถวธรรมดา ไม่บวกแถว heading/subtotal/total ของรายงานซ้ำ), พิมพ์ด้วย
- `hideRepeats: true` — เว้นว่างเมื่อค่าเท่าแถวบน (รหัสบัญชีในบัญชีแยกประเภท)
- `format: 'accounting'` — ตัวเลขแบบนักบัญชี ติดลบแสดงสีแดงบนจอ (กระดาษเป็นสีดำ) · CSV ส่งออกเป็นตัวเลขล้วน

คีย์ของ `fields` ในหน้า detail:
- `section: 'รายได้'` — เริ่มกลุ่มข้อมูลมีหัวข้อ (ถึง section ถัดไป) ทั้งบนจอและกระดาษ
- `emphasis: true` — ตัวเลขหลักของเอกสาร (จ่ายสุทธิ มูลค่าสัญญา) ตัวใหญ่ พื้นเหลืองอ่อน
- `hideZero: true` — ไม่แสดงเมื่อเป็น 0 (OT, โบนัส)
- `lines[].half: true` — สองส่วนติดกันวางคู่ซ้าย-ขวา (รายได้ | รายการหัก ของสลิป) · ส่วนที่ไม่มีรายการแสดงบรรทัดเดียว "ไม่มีรายการ" และไม่พิมพ์

อื่น ๆ ที่ renderer ทำให้เอง: ตัวกรองวันที่คู่ `from`/`to` (หรือ `xxxFrom`/`xxxTo`) รวมเป็นช่องเดียว "ตั้งแต่ – ถึง" พร้อมปุ่ม เดือนนี้/เดือนก่อน/ไตรมาสนี้/ปีนี้ (`filterGroups()`, `datePresets()`) ·
ช่องวันที่ในตัวกรองมีป้ายชื่อเล็กเหนือค่า · select ในตัวกรองแสดงค่า `default` · คอลัมน์ ใช่/ไม่ใช่ ในตารางแสดง "✓ ใช่" / "–" (ช่องข้อมูล detail ยังเป็นข้อความเต็ม) ·
`format: 'list'` เป็นชิป (ตารางแสดง 6 ตัว + "+n") · ค่าที่เป็น URL ในหน้า detail มีปุ่มคัดลอก · ช่อง textarea ที่เก็บรูปเป็น data URL (ค่า `data:image/…` หรือ help ที่พูดถึง data:image) เป็นตัวเลือกไฟล์รูปพร้อมตัวอย่าง ·
หน้า list มีปุ่มเหลืองได้ปุ่มเดียว (ปุ่มสร้าง ถ้ามี) · หัวเรื่อง detail ที่ยาวเกิน 40 ตัวอักษรใช้ขนาดเล็กลง

Action: `then` = เปิดหน้าอื่นด้วยผลลัพธ์ (`idFrom` ไม่ใส่ก็ได้), `toast` = แสดงค่าจาก response เป็นข้อความมุมจอ (เช่น ผลลองรันกฎ), `confirm`, `fields`/`lines` = ถามข้อมูลก่อน

## ภาพรวมวันนี้ (widgets)

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
- บนสุด "ตอนนี้" = `floor3d` + `feed` (ใช้ `size` ที่ประกาศ)
- ต่อด้วยทีละหมวด (การผลิต & คลัง · ขาย & ลูกค้า · สำนักงาน & บุคคล · บริการ & โครงการ · ตั้งค่า) — ในหมวด: `kpi` เรียงเป็นแถวแบ่งความกว้างกัน,
  `pipeline` เต็มแถว, `bars`/`trend` ครึ่งแถว (ตัวสุดท้ายที่เหลือเดี่ยวเต็มแถว) — ระบบจัดขนาดให้เองเพื่อจังหวะเดียวกันทุกหมวด
- ข้อมูลโหลดเมื่อหมวดเลื่อนเข้าใกล้จอ (lazy), หมวดพับได้, ปุ่ม "เลือกการ์ดที่แสดง" ให้ผู้ใช้เลือกเอง (เก็บใน localStorage ต่อบริษัท+ผู้ใช้)
- ค่าเริ่มต้น: แสดงการ์ดที่ผู้ใช้มีสิทธิ์ทั้งหมด ยกเว้นเมื่อมีการ์ดเกิน 12 ใบ จะซ่อน `trend` ไว้ก่อน (เปิดเองได้)

## ต้องตัดสินใจวันนี้ (todo)

`ModuleUi.todo: TodoSpec[]` — งานที่รอผู้ใช้คนนี้ตัดสินใจ อ่านจาก list screen ของโมดูลเอง (`screen`, `query` เช่น `{ status: 'draft' }`) แล้ว
หน้าแรกรวมทุกโมดูลไว้บนสุด เรียง: เกินกำหนด → ด่วน (`urgent`) → ครบกำหนดวันนี้ → รอนานสุด · ปุ่มบนการ์ด = `actions` (ไม่ใส่ = `rowActions` ของ screen,
`when`/`perm` ยังใช้ต่อแถว) · คีย์แถว: `title`, `subtitle` (หลายฟิลด์ต่อด้วย " · "), `amount`, `since` ("รอ 3 วัน"), `due` ("เกินกำหนด 2 วัน") ·
กลุ่มแสดงเมื่อผู้ใช้มี `perm` (ไม่ใส่ = perm ของปุ่มแรก) · เรคคอร์ดเดียวกันจากสองกลุ่มแสดงครั้งเดียว · กดแล้วการ์ดหายทันทีและโหลดใหม่ ·
helper ใน ui-schema: `buildTodo`, `waitingText`, `dueText` (test `packages/ui-schema/test/todo.test.ts`) · `brokenLinks` ตรวจว่า `screen` เป็น list ที่มีปุ่มหรือ rowLink
มีแล้ว: approvals (คำขอ), purchasing (PO ร่าง), expense (ใบเบิก, เงินทดรอง), hr (ใบลาลูกทีม/ฝ่ายบุคคล), booking (การจอง), maintenance (งานซ่อมรอรับ)

## ผลกระทบเมื่อกดยืนยัน (impact)

`Action.impact: true` — dialog ของปุ่มแสดงว่าระบบจะทำอะไรต่อในโมดูลอื่นก่อนกดยืนยัน (สต็อก ต้นทุนเฉลี่ย สมุดรายวัน งานตรวจ QC …):
web เรียก endpoint เดิมด้วย `?_dryRun=1` (route ต้องประกาศ `config: { dryRun: true }`, kernel `impact.ts`: ทำจริงแล้ว rollback, เก็บ event ที่จะส่ง)
แล้ว `POST /api/_impact { events }` — gateway ถามทุกโมดูลที่ subscribe event นั้น (`ServiceDefinition.impact`) ด้วย token ของผู้ใช้
· ถ้าทำรายการไม่ได้ (409/400) แผงแสดงเหตุผลทันทีก่อนกด · คำนวณใหม่ 0.5 วินาทีหลังแก้ช่อง · ไม่แสดงในโหมด showcase
มีแล้ว: purchasing "รับของที่ค้างทั้งหมด" → inventory, costing, accounting, quality · production "รายงานผลผลิต" → inventory (วัตถุดิบออก/สินค้าเข้า), costing (ต้นทุนงาน + ของที่ยังไม่มีต้นทุน), quality (ตรวจขั้นสุดท้าย) · sales "บันทึกส่งของ" → inventory (ติดลบ = แดง, ถึงจุดสั่งซื้อ = ส้ม)
· มือถือ (Expo) แสดงแผงเดียวกันใน dialog ของปุ่ม (`components/ImpactPreview.tsx`); หน้าแรกของแอปมี "ต้องตัดสินใจวันนี้" เหมือนเว็บ (`components/DecisionInbox.tsx`, helper `todoSources`/`todoActions` ใน ui-schema)

## หมวดงาน (area) — เมนูและหน้าแรก

`ModuleUi.area?: 'operations' | 'commercial' | 'office' | 'service' | 'settings'` — ไม่ใส่ก็ได้ โมดูลของ GO Along มีค่าเริ่มต้นใน
`moduleArea()` (packages/ui-schema) โมดูลใหม่ของลูกค้าที่ไม่ใส่จะอยู่ "การผลิต & คลัง" · เมนู web: หัวข้อหมวดพับได้ (จำต่อผู้ใช้)
ถ้ามีมากกว่า 10 โมดูลและผู้ใช้ยังไม่เคยเลือก จะพับทุกหมวดยกเว้นหมวดที่กำลังใช้งาน · แถบไอคอนซ้ายเลื่อนได้และคั่นตามหมวด
· mobile: หน้าแรกจัดกลุ่มหน้าจอตามหมวดเดียวกัน (`groupByArea()`)

## ⌘K สั่งงานภาษาไทย ค้นหา และผู้ช่วย AI

- `commands` — คำสั่งภาษาไทย เช่น `{ keywords: ['แจ้งซ่อม'], screen: 'woNew', arg: { lookup }, restField: 'title' }`
  keyword ต้องไม่ซ้ำกับคำสั่งอื่นในทุกโมดูล (ระบบเลือก keyword ที่ยาวที่สุด คำที่ซ้ำกันจึงกำกวม) — `tests/ui/commands.test.ts` ตรวจให้ และตรวจว่า `example` เปิดคำสั่งของตัวเอง
  พิมพ์ "แจ้งซ่อม PRESS-01 น้ำมันรั่ว" → คำแรกหลัง keyword ค้นผ่าน `arg.lookup` แล้วเติมช่องตาม `assign`, ข้อความที่เหลือไปที่ `restField`
  ฟอร์มได้ค่าผ่าน URL `?f.<field>=…&l.<field>=<ป้ายของ lookup>` · หน้า list ได้เป็นตัวกรอง · `arg.openId` = เปิดหน้า detail ของรายการนั้นเลย
- `search` — ค้นหาเอกสาร/ข้อมูล (`endpoint` ควรรับ `?q=`; ระบบกรองซ้ำฝั่ง client ด้วย `label`)
- `notifications` — แหล่งข้อมูลของกระดิ่ง (`endpoint` คืน `{ unread, items }`, `readEndpoint`, `readAllEndpoint`)
- ผู้ช่วย AI (`apps/web/src/app/assist/route.ts` + `src/lib/assistant.ts`): ใช้ `ANTHROPIC_API_KEY` ของลูกค้า
  (`ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`, `ASSISTANT_RATE_PER_MIN`, `COMPANY_NAME` ไม่บังคับ) อ่านข้อมูลด้วย token ของผู้ใช้
  ได้เฉพาะ GET endpoint ที่หน้าจอประกาศไว้ และ "บันทึกแทน" ไม่ได้ — ทำได้แค่ส่งปุ่มเปิดฟอร์มที่กรอกไว้ให้ผู้ใช้กดเอง

## Field types

`text` `textarea` `number` `date` `month` `select` `boolean` `email` `password`
`date` / `month` — ค่ายังเป็น ISO (`2026-10-03` / `2026-10`) แต่ผู้ใช้เห็นและพิมพ์เป็น พ.ศ.: web = ช่องพิมพ์ + ปฏิทินอาทิตย์ขึ้นก่อน (`components/ThaiDate.tsx`, ปุ่มวันนี้, ลูกศร/PageUp/PageDown, Alt+↓ เปิด) · มือถือ = ช่องพิมพ์ + ปุ่ม เมื่อวาน/วันนี้/พรุ่งนี้ · รับ `03/10/2569`, `3/10/69`, `3 ต.ค. 2569`, `2026-10-03`, `03102569` (`parseDateInput` / `parseMonthInput` ใน ui-schema)
`lookup` — ค้นหาจากโมดูลอื่นแล้วเติมหลายช่อง: `assign: { itemId: 'id', itemCode: 'code', itemName: 'name' }`, `scanField: 'code'` = มือถือสแกน QR/บาร์โค้ดได้
`multilookup` — เลือกหลายรายการ (เช่น บทบาท) · `permissions` — เลือกสิทธิ์จาก manifest ของโมดูลที่ติดตั้ง
`image` — รูปเก็บเป็น data URL ในช่องข้อความ (โลโก้บริษัท): web แสดงรูปตัวอย่าง + ปุ่มเลือกไฟล์/ลบรูป (PNG/JPEG/SVG/WebP ≤ 300 KB) · มือถือให้ตั้งค่าจากหน้าเว็บ
  (textarea เดิมที่ค่าเป็น `data:image/…` หรือ help พูดถึง data:image ยังได้ตัวเลือกไฟล์เหมือนเดิม)

## Formats (columns / fields)

`text` `money` `accounting` (งบ: (1,250.00) / –) `qty` `percent` `date` `datetime` (ปี พ.ศ.) `month` `status` (ป้ายสีตามสถานะ) `label` (ชื่อไทยของรหัส) `boolean` `list` `qr`

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
