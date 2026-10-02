# UAT pack

| ไฟล์ | คืออะไร |
| --- | --- |
| `cases.json` | กรณีทดสอบ UAT (แก้ที่นี่ที่เดียว) |
| `../../tests/uat/uat.test.ts` | รันทุกกรณีกับระบบจริงผ่าน browser แล้วเก็บภาพหน้าจอ |
| `screens/`, `shots.json`, `run.json` | ภาพหน้าจอและผลรันอัตโนมัติล่าสุด |
| `system.json`, `browser.json` | ผลทดสอบระบบทั้งหมด (unit, integration, e2e, browser) |
| `template.html` → `uat-pack.html` | หน้า UAT สำหรับผู้ทดสอบ (บันทึกผ่าน/ไม่ผ่าน และอนุมัติ) |

สร้างใหม่ทั้งชุดเมื่อออกรุ่นใหม่:

```bash
pnpm uat:pack     # test:report + uat + erp uat-report
```

แล้วเผยแพร่ `uat-pack.html` พร้อมโฟลเดอร์ `screens/` เป็นหน้าเว็บให้ผู้ทดสอบ (artifact) — ผลที่ผู้ทดสอบกดจะเก็บใน collection `results` และการอนุมัติใน `signoff/v<version>`
