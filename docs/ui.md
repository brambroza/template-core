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
| `list` | ตารางรายการ + ตัวกรอง | `endpoint`, `columns`, `filters`, `create`, `rowLink`, `actions` (ปุ่มบนหน้า), `rowActions` (ปุ่มต่อแถว) |
| `form` | สร้าง/แก้ไข | `method`, `endpoint`, `fields`, `lines` (ตารางรายการ), `load` (ดึงค่าเดิมมาแก้), `after` |
| `detail` | ดูเอกสาร + ปุ่มตามสถานะ | `endpoint`, `heading`, `fields`, `lines`, `actions` (`when` = แสดงเฉพาะบางสถานะ), `printable` |

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
4. ลิงก์ไปหน้าจอ (`rowLink`, `create`, `after`, `then`) ต้องมีอยู่จริง
5. หน้าจอที่เปิดด้วย id (`/m/<module>/<screen>/<id>`) จะเอา id ไปเติม `:param` ตัวแรกของ endpoint

## เพิ่มความสามารถใหม่ให้ renderer

ต้องการ field หรือ format ใหม่ (เช่น ลายเซ็น, แนบรูป): เพิ่ม type ใน `packages/ui-schema/src/index.ts`
แล้วทำทั้งใน `apps/web/src/components` และ `apps/mobile/src/components` — อย่าเขียนหน้าจอเฉพาะโมดูลใน apps

## รันและทดสอบ

```bash
pnpm --filter @erp/web dev                 # GATEWAY_URL=http://localhost:8080 (ค่าเริ่มต้น)
pnpm --filter @erp/mobile start            # EXPO_PUBLIC_GATEWAY_URL=http://<lan-ip>:8080 หรือกรอกในหน้า login
pnpm test:ui                               # build web + ทดสอบผ่าน Chromium (ลูกค้าครบชุด และลูกค้าที่ซื้อแค่ซ่อมบำรุง)
pnpm --filter @erp/mobile bundle:check     # ตรวจว่า bundle Android ได้
```
