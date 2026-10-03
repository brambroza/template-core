# กุญแจใบอนุญาต (license keys) — วิธีสร้างและเก็บอย่างปลอดภัย

> เอกสารภายใน GO Along · ทำครั้งเดียวต่อบริษัท ไม่ใช่ต่อลูกค้า

## ภาพรวม

| ไฟล์ | ใครถือ | ความลับ | ใช้ทำอะไร |
|---|---|---|---|
| `license-private.pem` | เจ้าของ (+ ผู้ถือสำรอง 1 คน) | **ลับสูงสุด** | เซ็นใบอนุญาตให้ลูกค้าทุกราย |
| `packages/kernel/license-public.pem` | อยู่ใน repo และในโค้ดที่ส่งลูกค้า | เปิดเผยได้ | ตรวจว่าใบอนุญาตเป็นของจริง (สร้างใบใหม่ไม่ได้) |
| ใบอนุญาต (token) | ลูกค้าแต่ละราย | ส่งให้ลูกค้ารายนั้นเท่านั้น | ระบุลูกค้า โมดูล วันหมดอายุ วันสิ้นสุดอัปเดต |

ใครได้กุญแจลับไป จะออกใบอนุญาตปลอมในนาม GO Along ได้ ถ้ากุญแจหาย ใบอนุญาตที่ออกไปแล้วยังใช้ได้ แต่จะออกใบใหม่ให้ใครไม่ได้อีก ต้องสร้างคู่ใหม่และออกใบใหม่ให้ลูกค้าทุกราย

## ก่อนเริ่ม

- ทำบน **คอมพิวเตอร์ส่วนตัวของเจ้าของ** ที่เปิดการเข้ารหัสดิสก์แล้ว (macOS: FileVault · Windows: BitLocker · Linux: LUKS)
- **ห้ามทำ** บนเซิร์ฟเวอร์ VPS, เครื่องที่ใช้ร่วมกัน, CI/GitHub Actions, Vercel หรือ session AI บน cloud
- `git pull` ให้ได้โค้ดล่าสุด แล้วรัน `pnpm install`
- เตรียมที่เก็บสำรอง 2 แห่ง:
  1. password manager ขององค์กร เช่น 1Password หรือ Bitwarden ใน vault ที่เข้าได้แค่เจ้าของกับผู้ถือสำรอง
  2. USB ที่เข้ารหัส เช่น VeraCrypt, BitLocker To Go หรือ APFS แบบเข้ารหัส เก็บไว้ในตู้เซฟ

## ขั้นตอน

### 1. สร้างโฟลเดอร์เก็บกุญแจนอก repo

macOS / Linux:
```bash
mkdir -p ~/.goalong/license-keys
chmod 700 ~/.goalong/license-keys
```

Windows (PowerShell):
```powershell
New-Item -ItemType Directory -Force "$HOME\.goalong\license-keys" | Out-Null
icacls "$HOME\.goalong\license-keys" /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F"
```

เก็บไว้นอก repo เพื่อไม่ให้เผลอ commit, zip หรือ pack ติดไปกับโค้ด (ในตัว repo โฟลเดอร์ `keys/` ก็ถูก gitignore ไว้แล้วเป็นชั้นที่สอง)

### 2. สร้างกุญแจ

macOS / Linux:
```bash
cd template-core
pnpm erp license keygen --key ~/.goalong/license-keys/license-private.pem
```

Windows:
```powershell
pnpm erp license keygen --key "$HOME\.goalong\license-keys\license-private.pem"
```

- กุญแจลับถูกเขียนด้วยสิทธิ์ 600 (เจ้าของอ่าน/เขียนได้คนเดียว)
- กุญแจสาธารณะถูกเขียนที่ `packages/kernel/license-public.pem`
- คำสั่งนี้ไม่ทับกุญแจเดิม ถ้ามีอยู่แล้วต้องใส่ `--force` ซึ่ง **อย่าใช้** เว้นแต่ตั้งใจเปลี่ยนกุญแจ (ดูหัวข้อ "ถ้ากุญแจรั่วหรือหาย")

### 3. ตรวจว่าถูกที่

```bash
ls -l ~/.goalong/license-keys/        # ต้องเห็น -rw-------
git status                            # ต้องเห็นแค่ packages/kernel/license-public.pem
```

ถ้าเห็นไฟล์ `license-private.pem` ใน `git status` ให้หยุดทันที ห้าม commit

### 4. จดลายนิ้วมือของกุญแจสาธารณะ

```bash
# macOS
openssl pkey -pubin -in packages/kernel/license-public.pem -outform DER | shasum -a 256
# Linux
openssl pkey -pubin -in packages/kernel/license-public.pem -outform DER | sha256sum
```

บันทึกค่านี้ไว้ใน password manager คู่กับกุญแจ ใช้ตรวจภายหลังว่าไฟล์ public ใน repo หรือในเครื่องลูกค้าไม่ถูกสลับ

### 5. สำรอง 2 ที่ แล้วทดสอบว่ากู้คืนได้

1. แนบ `license-private.pem` เป็นไฟล์ใน password manager (vault ที่จำกัดสิทธิ์) และใส่ลายนิ้วมือไว้ในโน้ต
2. คัดลอกลง USB ที่เข้ารหัส แล้วเก็บในตู้เซฟ
3. **ทดสอบกู้คืน:** ดาวน์โหลดไฟล์จาก password manager ไปไว้ในโฟลเดอร์ชั่วคราว แล้วใช้มันออกใบทดสอบตามขั้นที่ 6 ผ่านแล้วลบไฟล์ชั่วคราวทิ้ง

**ห้ามส่งกุญแจลับ** ทางอีเมล, LINE, Slack, Google Drive/Dropbox แบบไม่เข้ารหัส และห้ามวางในแชต AI ใดๆ (รวมถึง Claude) และห้ามเก็บไว้บนเซิร์ฟเวอร์ของลูกค้าหรือของเรา

### 6. ทดสอบออกใบอนุญาต

```bash
export ERP_LICENSE_PRIVATE_KEY_FILE=~/.goalong/license-keys/license-private.pem
pnpm erp license issue --customer "ทดสอบ" --modules maintenance --expires 2026-12-31
pnpm erp license inspect <token-ที่ได้>
```

`inspect` ต้องแสดงชื่อลูกค้า โมดูล และวันหมดอายุถูกต้อง (Windows: `$env:ERP_LICENSE_PRIVATE_KEY_FILE="$HOME\.goalong\license-keys\license-private.pem"`)

### 7. Commit กุญแจสาธารณะ

```bash
git add packages/kernel/license-public.pem
git commit -m "License public key"
git push
```

ไฟล์ public ต้องอยู่ใน repo เพราะ `pnpm erp pack` คัดลอกไปให้ลูกค้าทุกราย และระบบใช้มันตรวจใบอนุญาตตอนเริ่มทำงาน

## ใช้งานประจำ (ออกใบอนุญาตให้ลูกค้า)

```bash
export ERP_LICENSE_PRIVATE_KEY_FILE=~/.goalong/license-keys/license-private.pem
pnpm erp license issue --customer "บริษัท เอ จำกัด" --modules maintenance,inventory --updates-until 2027-10-31
# แบบเช่า/pilot ใส่ --expires YYYY-MM-DD ด้วย
```

- จดทะเบียนใบอนุญาตทุกใบ (ใน CRM หรือ Sheet ภายใน): licenseId, ลูกค้า, โมดูล, วันออก, วันหมดอายุ, วันสิ้นสุดอัปเดต, เลขที่สัญญา
- ส่ง token ให้ลูกค้ารายนั้นผ่านช่องทางที่ตกลงกัน (หรือใส่ใน pack ด้วย `--license`) token ไม่ใช่ความลับระดับเดียวกับกุญแจ แต่ไม่ควรเผยแพร่สาธารณะ
- ลูกค้าซื้อโมดูลเพิ่ม → ออกใบใหม่ที่รวมโมดูลเดิมกับโมดูลใหม่ (กุญแจไม่เปลี่ยน)

## ใครเข้าถึงได้

- เจ้าของ 1 คน + ผู้ถือสำรอง 1 คน (เช่น กรรมการอีกท่าน) เท่านั้น
- ทบทวนรายชื่อผู้เข้าถึงปีละครั้ง และทุกครั้งที่มีคนออกจากบริษัท
- ห้ามนำกุญแจไปใส่ใน CI หรือเครื่องพนักงาน ถ้าต้องให้พนักงานออกใบอนุญาตแทน ควรทำเครื่องมือออกใบภายในที่ไม่เปิดเผยกุญแจก่อน

## ถ้ากุญแจรั่วหรือหาย

1. สร้างคู่ใหม่ในโฟลเดอร์ใหม่ เช่น `~/.goalong/license-keys-2/` ด้วย `pnpm erp license keygen --key <ไฟล์ใหม่> --force` (`--force` จะเขียนทับไฟล์ public ใน repo)
2. Commit กุญแจสาธารณะใหม่ จดลายนิ้วมือใหม่ แล้วสำรองตามขั้นที่ 5
3. ออกใบอนุญาตใหม่ให้ลูกค้าทุกราย ตามทะเบียนใบอนุญาต
4. ส่งไฟล์ `license-public.pem` ใหม่กับใบใหม่ให้ลูกค้าแต่ละราย (ลูกค้าแทนที่ไฟล์ใน `packages/kernel/` แล้วเปลี่ยน `ERP_LICENSE`)
5. กรณีรั่ว: แจ้งลูกค้าว่าใบเก่าจะใช้ไม่ได้หลังเปลี่ยนไฟล์ public และบันทึกเหตุการณ์ไว้

หมายเหตุ: ลูกค้าได้ source code ไปด้วย ใบอนุญาตจึงเป็นตัวกำหนดขอบเขตการใช้ตามสัญญา ไม่ใช่ระบบกันก๊อป (ดู `packages/kernel/src/license.ts`) สิ่งที่คุ้มครองจริงคือสัญญาอนุญาตให้ใช้สิทธิ์
