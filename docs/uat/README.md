# UAT pack

| ไฟล์ | คืออะไร |
| --- | --- |
| `cases.json` | กรณีทดสอบ UAT (แก้ที่นี่ที่เดียว) |
| `../../tests/uat/uat.test.ts` | รันกรณีโรงงาน (UAT-01…27) กับระบบจริงผ่าน browser แล้วเก็บภาพหน้าจอ |
| `../../tests/uat/business.test.ts` | รันกรณีสำนักงาน/บริการ (UAT-28…47: อนุมัติ เบิก ลา จอง CRM แจ้งปัญหา โครงการ ทรัพย์สิน QC บอท) ทั้ง 18 โมดูล ตามบทบาทผู้ใช้ |
| `bugs-0.3.md` | บันทึกข้อบกพร่องจากการทดสอบรุ่น 0.3 (สถานะแก้ไข/เปิดอยู่) |
| `screens/`, `shots.json`, `run.json` | ภาพหน้าจอและผลรันอัตโนมัติล่าสุด (ทั้งสองไฟล์ทดสอบรวมรายการภาพเข้า `shots.json` แบบอ่าน-รวม-เขียน) |
| `system.json`, `browser.json` | ผลทดสอบระบบทั้งหมด (unit, integration, e2e, browser) |
| `template.html` → `uat-pack.html` | หน้า UAT สำหรับผู้ทดสอบ (บันทึกผ่าน/ไม่ผ่าน และอนุมัติ) |

สร้างใหม่ทั้งชุดเมื่อออกรุ่นใหม่:

```bash
pnpm uat:pack     # test:report + uat + erp uat-report
```

แล้วเผยแพร่ `uat-pack.html` พร้อมโฟลเดอร์ `screens/` เป็นหน้าเว็บให้ผู้ทดสอบ (artifact) — ผลที่ผู้ทดสอบกดจะเก็บใน collection `results` และการอนุมัติใน `signoff/v<version>`
