# Bug log — release 0.4 (finance: accounting, payroll, contracts, receipts/AR, attachments, audit, delegation, QC-HOLD returns)

Exploratory testing done 2026-10-03 on a fresh installation of 14 modules (identity, master-data, inventory, purchasing, sales, automation,
quality, approvals, expense, hr, helpdesk, accounting, payroll, contracts) — through the gateway API with role tokens built from identity's
role templates, and in Chromium (web :3934) as those roles. Every **Fixed** bug has a regression test (the `QA regressions (bugs-0.4)` blocks
in `services/<module>/test/`, kernel ones in `packages/kernel/test/platform.test.ts`) and, where it is part of a business flow, a UAT case
in `docs/uat/cases.json` (UAT-48 … UAT-64, run by `tests/uat/finance.test.ts`).

Severity: **High** = money / control / privacy can be bypassed or wrong · **Medium** = wrong data or a blocked flow · **Low** = wording, validation, cosmetics.

| ID | Module | Severity | Status | Summary |
| --- | --- | --- | --- | --- |
| ACC-01 | accounting / sales | High | Fixed | A receipt is posted on the day it is keyed, not on its receipt date: AR, cash and WHT land in the wrong month |
| PAY-01 | kernel audit / payroll | High | Fixed | The audit log stores the full bank account number that payroll promises never to keep |
| SAL-01 | sales | Medium | Fixed | A receipt can be dated before the invoice it settles (and in the future) |
| SAL-02 | sales | Medium | Fixed | Receivables / aging "as of" a past date include later invoices and drop invoices paid later |
| SAL-03 | sales | Medium | Fixed | Document dates default to the database's UTC day: an invoice keyed 00:00–07:00 Bangkok is dated yesterday (wrong VAT month on the 1st); invoices can be dated in the future |
| EXP-06 | expense (+ kernel attachments) | Medium | Fixed | After a claim is approved / paid the claimant can still delete or swap its receipt files |
| PAY-02 | payroll | Medium | Fixed | Employees cannot reach their own 50 ทวิ in the app (screen needs payroll.run.read, no self-service list) |
| ID-02 | identity (role templates) | Medium | Fixed | "บัญชีและการเงิน" cannot confirm the MA installment orders it must invoice (403 sales.order.write) |
| ID-04 | identity + approvals, contracts, helpdesk, quality, projects, crm, assets ui | Medium | Fixed | People pickers call `/users` (identity.user.read): supervisors cannot pick a delegate, sales cannot pick a technician, requesters cannot pick approvers |
| ID-03 | identity (role templates) | Low | Fixed | No suggested role can return goods to the supplier (purchasing.po.return) — QC-HOLD material is stuck |
| APV-03 | approvals | Low | Open | A delegation to a user without `approvals.request.approve`, or to an unknown user id, is accepted — the request then waits on someone who cannot act |
| PUR-01 | purchasing / inventory | Low | Open | "ส่งคืนผู้ขาย" defaults to QC-HOLD even when nothing is held: the return drives QC-HOLD negative (recorded only as a stock anomaly) |
| UI-04 | web (action dialogs) | Low | Open | Action dialogs with lines (ส่งคืนผู้ขาย, ปิดงานซ่อม) open with no line although one is required — the user must press "เพิ่มรายการ" first |
| ACC-02 | accounting | Low | Open | Goods receipts carry no receipt date: purchases keyed late post on the keying day (documented gap; PO receive has no date field) |

Totals: 14 bugs — High 2 (2 fixed) · Medium 7 (7 fixed) · Low 5 (1 fixed, 4 open). 10 fixed, 4 open.

Verified OK (no bug): trial balance / balance sheet balance after a realistic month (invoices, receipt with 3% WHT, purchases with VAT,
expense claim with VAT, payroll); posting into a closed period → 409 for JVs and a posting error for events, retry after reopen posts on the
document date; payroll SSO 600 / 750 (cap) / 520 (OT excluded) and annualised WHT with opening YTD; payslips and 50 ทวิ only for oneself;
PM visit generation idempotent (helpdesk gets one PM ticket per visit); installment notify once per installment; staff cannot list / open /
link / delete another employee's claim files; delegation (self / past / overlap refused, "อนุมัติ (แทน …)" recorded, a delegate cannot approve
his own request); QC fail → QC-HOLD (available 0) → return settles the hold, reverses AP / input VAT; company profile on the printed tax invoice
and 50 ทวิ; LINE link code (Thai digits) → personal push only to the linked claimant.

---

## Details

### ACC-01 — receipts posted on the keying date · accounting / sales · High · Fixed
- Steps: invoice INV dated 5 Sep (107,000 incl. VAT); on 3 Oct key the customer's transfer as a receipt dated **30 Sep**, WHT 3%. Trial balance as of 30 Sep.
- Expected: JV dated 30 Sep — AR cleared, bank +104,000, WHT receivable 3,000 in September (the 50 ทวิ to chase belongs to September).
- Actual: JV dated 3 Oct. As of 30 Sep AR still showed 107,000 and cash 0; the WHT report put the 3,000 in October. After September is closed the
  receipt silently moved to October instead of being flagged.
- Cause: `sales.payment_received` carried no date; accounting fell back to the event time.
- Fix: optional `receiptDate` in the contract (`packages/contracts`), sales emits it, `buildFromEvent` posts on it (closed month → posting error).
- Test: `services/accounting/test/service.test.ts` › ACC-01; `services/sales/test/receivables.test.ts` › SAL-01/SAL-03 (event carries the date); UAT-53, UAT-54.

### PAY-01 — full bank account number in the audit log · kernel / payroll · High · Fixed
- Steps: HR creates / edits a pay profile with bank account `123-4-56789-0` (or imports a CSV). Admin opens `GET /api/payroll/_audit`.
- Expected: payroll stores only the last 4 digits (its CLAUDE.md privacy rule) — the history too.
- Actual: the kernel audit hook stored the request body as typed: `"bankAccount":"123-4-56789-0"`, readable by every `payroll.audit.read` holder forever.
- Fix: kernel `redact()` masks keys that look like account / card / national-ID numbers to `••••<last 4>` (also inside imported rows).
  Rows written before the fix still hold full numbers — purge them from `_audit` of the payroll database when upgrading.
- Test: `packages/kernel/test/platform.test.ts` › "keeps only the last 4 digits…"; `services/payroll/test/service.test.ts` › PAY-01; UAT-61.

### SAL-01 — receipt dated before its invoice · sales · Medium · Fixed
- Steps: invoice dated 20 Sep; `POST /receipts { receiptDate: '2026-09-01', lines: [that invoice] }`; also `receiptDate: '2099-01-01'`.
- Expected: 400 — money cannot be received for an invoice not yet issued; no future-dated receipts.
- Actual: 201 for both (accounting then credited AR before it was debited).
- Fix: 400 with `fieldErrors.receiptDate` naming the invoice; future dates refused for receipts and deposits.
- Test: `services/sales/test/receivables.test.ts` › SAL-01/SAL-03; UAT-52.

### SAL-02 — receivables / aging "as of" a past date · sales · Medium · Fixed
- Steps: INV 5 Sep 107,000 (paid 30 Sep), INV 20 Sep 10,700. `GET /receivables/aging?asOf=2026-09-10`.
- Expected: 107,000 current (only the 5 Sep invoice existed and it was unpaid on 10 Sep).
- Actual: 10,700 — today's payment state was applied to a past date and an invoice issued after the date was included. Same for `/receivables` and deposits.
- Fix: invoices issued on/before `asOf`, less receipts dated on/before `asOf`; deposits received on/before `asOf` less applications up to then.
- Test: `services/sales/test/receivables.test.ts` › SAL-02; UAT-56.

### SAL-03 — document dates in UTC / in the future · sales · Medium · Fixed
- Steps: issue an invoice / receipt / order without a date between 00:00 and 07:00 Bangkok (the database runs in UTC); invoice with `issueDate: '2099-01-01'`.
- Expected: the Thai calendar day (the tax point); no future-dated tax invoices.
- Actual: `current_date` of the UTC database = yesterday (on the 1st of a month: previous month's ภ.พ.30); the future invoice was accepted.
- Fix: default dates = Bangkok today in code; future issue / receipt dates → 400. (Two existing tests used future invoice dates; moved to the past.)
- Test: `services/sales/test/receivables.test.ts` › SAL-01/SAL-03.

### EXP-06 — claim evidence editable after payment · expense / kernel attachments · Medium · Fixed
- Steps: staff attaches a receipt to his claim; the head approves, finance pays; staff `DELETE /api/expense/_attachments/:id` and uploads another file.
- Expected: once approved the evidence (input-VAT tax invoice) is frozen for the claimant.
- Actual: 200 / 201 — the receipt behind a paid, VAT-claimed expense could be removed or swapped.
- Fix: kernel `AttachmentEntity.writable` hook (checked on upload and on a delete by the uploader; `can_delete` false while frozen); expense freezes
  claims after `draft/submitted/returned` and advances after `requested` for the owner. Approvers / payers may still add files (transfer slip);
  `expense.attachment.delete` may still delete.
- Test: `services/expense/test/attachments.test.ts` › EXP-06; UAT-60.

### PAY-02 — no self-service 50 ทวิ · payroll · Medium · Fixed
- Steps: employee (payroll.payslip.self) looks for his 50 ทวิ on the phone.
- Expected: CLAUDE.md "Employees read their own payslips and 50 ทวิ on the phone".
- Actual: the API allowed his own certificate, but the only screens (`certificates`, `certificate`) need payroll.run.read and he had no way to learn the id.
- Fix: `GET /my-certificates?year=` + screens `myCertificates` (menu "หนังสือรับรอง 50 ทวิ ของฉัน", mobile) → `myCertificate` (printable, same fields as HR's).
- Test: `services/payroll/test/service.test.ts` › PAY-02; UAT-51 (prints with the company letterhead).

### ID-02 — accounting role cannot confirm MA installment orders · identity · Medium · Fixed
- Steps: contracts → "ส่งให้ฝ่ายขายร่างใบสั่งขาย"; the accountant (template บัญชีและการเงิน) opens the draft SO and presses ยืนยัน.
- Expected: billing staff confirm and invoice it (the draft's own note says so).
- Actual: 403 `sales.order.write` — the template had `sales.invoice.write` but invoices need a confirmed order.
- Fix: `sales.order.write` added to the accounting template. Test: `services/identity/test/identity.test.ts` › ID-02; UAT-49, UAT-58.

### ID-04 — people pickers need identity.user.read · identity + 7 ui.ts · Medium · Fixed
- Steps: supervisor (template หัวหน้างาน) → มอบอำนาจอนุมัติแทน → "ผู้อนุมัติแทน"; sales → new MA contract → technician; staff → request on an unlocked type → approvers.
- Expected: a list of colleagues.
- Actual: empty picker — the lookups called `GET /api/identity/users` (403 without identity.user.read, which only admin/HR/IT/executive have).
- Fix: identity `GET /users/directory?q=` for any signed-in user (active users' id, name, e-mail only); the pickers in approvals, contracts, helpdesk,
  quality, projects, crm and assets use it. HR / payroll / automation keep `/users` (admin screens). Web rebuilt.
- Test: `services/identity/test/identity.test.ts` › ID-04; `tests/ui/descriptors.test.ts`; UAT-62 (delegate picked in the browser).

### ID-03 — no role can return goods to the supplier · identity · Low · Fixed
- `purchasing.po.return` was in no role template, so QC-rejected stock in QC-HOLD could only be returned by an administrator. Added to "จัดซื้อ".
- Test: `services/identity/test/identity.test.ts` › ID-02 (ID-03 assertion); UAT-64.

### APV-03 — delegation to someone who cannot approve · approvals · Low · Open
- `POST /delegations { toUserId: <staff without approvals.request.approve> }` and an unknown uuid → 201. The request is then "waiting" on a delegate
  who gets 403 (the approver keeps his own rights, so it is not stuck). Same root as bugs-0.3 APV-02: approvals cannot read identity; needs an
  identity event with users' permissions, or a check when the delegate first acts.

### PUR-01 — return from an empty QC-HOLD · purchasing / inventory · Low · Open
- PO detail "ส่งคืนผู้ขาย" defaults the warehouse to QC-HOLD. Returning 30 good sheets without a QC rejection made QC-HOLD −30 (forced event issue →
  stock anomaly). Purchasing cannot see stock (independence); suggestion: inventory publishes the hold, or the form defaults to the PO warehouse unless a hold exists.

### UI-04 — action dialogs open with no line · web · Low · Open
- ส่งคืนผู้ขาย / ปิดงานซ่อม dialogs require ≥ 1 line but open with none; users must find "เพิ่มรายการ". Starting with one blank row changes existing
  UAT steps (UAT-19 clicks "เพิ่มรายการ"), so it is left for the UI owner.

### ACC-02 — goods receipts post on the keying day · accounting / purchasing · Low · Open
- `purchasing.goods_received` has no date and PO receive takes none, so goods received on the 30th but keyed on the 1st post next month
  (already listed under Gaps in services/accounting/CLAUDE.md). Needs `receivedDate` on receive + in the event.
