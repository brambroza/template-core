# ต่อยอดระบบด้วย AI (สำหรับทีมลูกค้า)

ระบบนี้ออกแบบให้ AI coding tool (Claude Code, Cursor, Codex ฯลฯ) อ่านแล้วทำงานตาม pattern เดิมได้ทันที

## สิ่งที่ AI ใช้

- `CLAUDE.md` (root) — แผนที่ระบบ + กฎเหล็ก + pattern ของ route
- `services/<module>/CLAUDE.md` — ข้อมูล, API, event, ไอเดียต่อยอดของแต่ละโมดูล
- `services/<module>/src/ui.ts` + [docs/ui.md](ui.md) — หน้าจอเป็นข้อมูล AI เพิ่มหน้าจอได้โดยไม่ต้องเขียน React
- `.claude/commands/` — คำสั่งสำเร็จรูป: `/new-module`, `/add-feature`, `/add-event`, `/check`, `/upgrade`
- test ทุกโมดูล — เป็นรั้วกันไม่ให้ AI ทำของเดิมพัง (`pnpm check`)

## ตัวอย่างคำสั่งที่สั่ง AI ได้เลย

- "เพิ่มโมดูล ควบคุมคุณภาพ (quality) บันทึกผลตรวจ QC ต่อ lot แล้วถ้าไม่ผ่านให้ส่ง event" → `/new-module`
- "เพิ่มใบเสนอราคาในโมดูล sales ที่แปลงเป็น SO ได้" → `/add-feature sales ...`
- "เมื่อเครื่องเสีย ให้แจ้ง LINE กลุ่มช่าง" → `/add-feature maintenance ...`
- "เพิ่ม field สีและขนาดในสินค้า" → migration ใหม่ใน master-data + `ITEM_COLS`

## กติกาที่ต้องรักษา

1. แก้ `packages/*` เท่ากับแก้ของทุกโมดูล — ถ้าจำเป็นให้เพิ่ม helper ใหม่ อย่าเปลี่ยนพฤติกรรมเดิม (อัปเดตจาก GO Along จะทับ)
2. ห้ามให้โมดูลหนึ่ง import หรือ query DB ของอีกโมดูล — ใช้ event
3. migration ห้ามแก้ไฟล์เก่า เพิ่มไฟล์ใหม่เสมอ
4. รัน `pnpm check` ให้ผ่านก่อน commit ทุกครั้ง
