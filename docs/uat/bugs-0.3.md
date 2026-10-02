# Bug log — release 0.3 (office & service modules)

Exploratory testing on the live demo (tenant `demo`, web :3940, gateway :8080), done 2026-10-02 as the role users
(admin@, hr@, acc@, it@, qc@, sales@, plan@, store@) in the browser and through direct API calls with their tokens.
Every **Fixed** bug has a regression test in `services/<module>/test/` (see the `QA regressions` describe block) and, where it is
part of a business flow, a UAT case in `docs/uat/cases.json` (UAT-28 … UAT-47, run by `tests/uat/business.test.ts`).

Severity: **High** = money / control can be bypassed or wrong · **Medium** = wrong data or a blocked flow · **Low** = wording, validation, cosmetics.

| ID | Module | Severity | Status | Summary |
| --- | --- | --- | --- | --- |
| APV-01 | approvals | High | Fixed | A requester who puts himself on the approver chain can approve his own request |
| EXP-01 | expense | High | Fixed | An approver approves (and then pays) his own claim / advance |
| EXP-02 | expense | High | Fixed | Clearing an advance against an already-paid claim computes the wrong refund |
| CRM-01 | crm | High | Fixed | Superseded quotation can still be accepted after its revision was accepted (double win, duplicate event) |
| EXP-03 | expense | Medium | Fixed | A claim totalling 0 baht can be submitted |
| EXP-04 | expense | Medium | Fixed | VAT larger than the amount is accepted |
| HR-01 | hr | Medium | Fixed | Leave dated before the employee's start date is accepted |
| HR-03 | hr | Medium | Fixed | Admin time record on "2026-02-30" silently becomes 2 March |
| BK-01 | booking | Medium | Fixed | Vehicle odometer can go backwards and corrupts every following trip |
| CRM-02 | crm | Medium | Fixed | A quotation past its validity date can be accepted |
| PJ-01 | projects | Medium | Fixed | An approver approves his own timesheet week |
| AST-01 | assets | Medium | Fixed | Disposal can be dated in the future (gain/loss on a future book value) |
| QC-01 | quality | Medium | Fixed | Measured value judged unrounded: shows "2.0500" in a 1.95–2.05 spec but fails |
| HD-01 | helpdesk | Medium | Fixed | A technician closing a ticket can give his own work a satisfaction score |
| KRN-01 | kernel (all) | Medium | Fixed (wave 4) | Impossible calendar dates (2026-02-31) return 500 "Internal error" |
| UI-01 | web (lists on phone) | Medium | Open | Wide list tables overflow on a 390 px phone: row buttons (อนุมัติ) and the right edge of dialogs are off-screen |
| UI-02 | web / quality | Medium | Open | Phone: "ปิดงานตรวจ" dialog on the results page cannot be submitted (button covered) |
| AUT-01 | automation | Medium | Fixed (wave 4) | Notifications are tenant-wide (no recipient): leave reasons / reject reasons visible to every holder of `automation.notify.read` |
| SEC-01 | assets / expense ui | Medium | Fixed (wave 4) | Every employee (assets.asset.read / expense.claim.read) sees finance menus: depreciation report with company book values, "รอจ่ายเงิน", categories, request types |
| EXP-05 | expense | Low | Fixed | Expense lines dated in the future are accepted |
| HR-02 | hr | Low | Fixed | An approver can reject his own leave (approve was already blocked) |
| PJ-02 | projects | Low | Fixed | Hours can be logged for future dates (e.g. 2027-05-03) |
| PJ-03 | projects | Low | Fixed | End date before start date answers "Value not allowed / projects_check" (raw constraint, English) |
| CRM-03 | crm | Low | Fixed | "ยืนราคาถึง" before the quotation date is accepted |
| APV-02 | approvals | Low | Open | Approver user ids are not checked: an unknown id leaves the request stuck (only an admin can move it) |
| AST-02 | assets | Low | Open | Purchase date in the future is accepted |
| MSG-01 | approvals, expense, crm, helpdesk, projects, assets | Low | Open |
| ID-01 | identity ui | Low | Fixed | Every signed-in employee gets the admin "ผู้ใช้และสิทธิ์" menu group (wave-4 company-profile screen had no perm) |
| SEC-02 | approvals / expense / assets ui | Low | Open | Staff still see read-only setup menus: ประเภทคำขอและสายอนุมัติ, หมวดค่าใช้จ่าย, หมวดทรัพย์สิน |
| UI-03 | booking ui | Low | Open | "จองแทนผู้อื่น (ชื่อ)" is shown to every employee but silently ignored unless they have `booking.book.approve` | Many 409/400 messages are English ("Cannot approve a approved request") in a Thai UI |

Totals: 30 bugs — High 4 (4 fixed) · Medium 15 (13 fixed, 2 open) · Low 11 (6 fixed, 5 open). 23 fixed, 7 open.

---

## Details

### APV-01 — requester approves own request · approvals · High · Fixed
- Steps: store@ creates a request (type BUDGET) with approvers `[store@, acc@]`, `submit: true`; store@ `POST /requests/:id/approve`.
- Expected: 403 — nobody approves his own request (segregation of duties).
- Actual: 200, step 1 approved by the requester; the inbox showed an "อนุมัติ" button on his own request.
- Fix: `decide()` refuses `approved` by the requester (also for approvals admins); `can_act` / inbox `can_act` false for own requests. Another admin can still take the step.
- Test: `services/approvals/test/service.test.ts` › APV-01; UAT-29.

### EXP-01 — approver approves own claim / advance · expense · High · Fixed
- Steps: acc@ (has `expense.claim.approve` + `pay`) creates a claim with `submit: true`, approves it, pays it to himself. Same for an advance.
- Expected: 403 on approving one's own claim or advance.
- Actual: 200 — one person could request, approve and pay out money to himself.
- Fix: `refuseSelfApproval()` on `/claims/:id/approve` and `/advances/:id/approve`.
- Test: expense › EXP-01 (existing test adjusted: the manager's own claim is now approved by another approver).

### EXP-02 — advance cleared against an already-paid claim · expense · High · Fixed
- Steps: advance 2,000 paid in cash; claim 350 approved **and paid** by transfer; `POST /advances/:id/clear { claimId }`.
- Expected: refused — the claim was already paid in full, so the employee must return the whole 2,000.
- Actual: 200, `settle_amount = -1,650` ("พนักงานคืนเงินบริษัท 1,650.00 บาท") — the company loses 350; claim shows `net_payable -1,650` on a paid claim.
- Fix: only `approved` (not yet paid) claims can clear an advance (409 with a Thai explanation). The UI lookup already offered approved claims only.
- Test: expense › EXP-02; UAT-31 (clear with an approved claim).

### CRM-01 — superseded quotation accepted · crm · High · Fixed
- Steps: QT sent → revise → QT-…-R1 sent → accept R1 → accept the original QT too.
- Expected: 409 "ถูกแก้ไขเป็น …-R1 แล้ว".
- Actual: both accepted; `crm.quotation_accepted` published twice (a sales-order integration would create two orders); opportunity showed 3 accepted quotes.
- Fix: accept refuses a quotation with `revised_by`. Test: crm › CRM-01.

### EXP-03 — zero-baht claim submitted · expense · Medium · Fixed
- Steps: claim with one line `amount: 0`, `submit: true`. Expected 400. Actual 201 `submitted`, total 0 lands in the approver's queue.
- Fix: submit requires total > 0. Test: expense › EXP-03.

### EXP-04 — VAT above amount · expense · Medium · Fixed
- Steps: line `amount: 100, vat: 500`. Expected 400 on `vat`. Actual 201, total 600 (payout inflated).
- Fix: VAT ≤ amount per line (field error `vat`). Test: expense › EXP-04 / EXP-05.

### EXP-05 — future expense date · expense · Low · Fixed
- Steps: line `expenseDate: 2027-12-01`. Expected 400. Actual 201. Fix: date ≤ today (Bangkok). Test: expense › EXP-04 / EXP-05.

### HR-01 — leave before start date · hr · Medium · Fixed
- Steps: store@ (started 2016-01-04) files ลากิจ on 2001-03-05. Expected 400. Actual 201 — counted against the 2001 quota.
- Fix: `fromDate` ≥ employee `start_date`. Test: hr › HR-01.

### HR-02 — approver rejects own leave · hr · Low · Fixed
- Steps: hr@ files leave, `POST /leave-requests/:id/reject`. Expected 409 like approve. Actual 200. Fix + test: hr › HR-02 (cancel still allowed).

### HR-03 — impossible date rolls over · hr · Medium · Fixed
- Steps: hr@ `POST /employees/:id/check-in { date: '2026-02-30', time: '08:00' }`. Expected 400. Actual 201 with `work_date 2026-03-02`.
  Also the duplicate / missing check-in messages said "วันนี้" for a past date and "ยังไม่ได้ลงเวลาเข้างานวันนี้" when the check-out time was before the check-in.
- Fix: calendar-date check; messages name the date and hint "เวลาออกงานก่อนเวลาเข้างาน". Test: hr › HR-03.
- Note: the demo tenant now holds one stray open check-in for EMP-003 on 2026-03-02 created while reproducing.

### BK-01 — odometer rollback · booking · Medium · Fixed
- Steps: VAN-01 last reading 153,226; complete a trip with `mileageStart: 10, mileageEnd: 20`.
- Expected: 400. Actual: 200; `lastMileage` became 20, so every following trip would start at 20 (distances of ~153,000 km).
- Fix: the start reading may not be below the previous trip's end (by trip date), the end may not pass the next trip's start; `lastMileage` = latest trip by date. Test: booking › BK-01; UAT-35.
- Note: the demo VAN-01 now shows last mileage 20 (from the reproduction, before the fix).

### CRM-02 — accept expired quotation · crm · Medium · Fixed
- Steps: quote valid until 2026-09-15, sent, accepted on 2026-10-02. Expected 409 (revise first). Actual 200. Test: crm › CRM-02.

### CRM-03 — validity before issue date · crm · Low · Fixed
- Steps: `issueDate 2026-10-02, validUntil 2026-09-01`. Expected 400 on `validUntil`. Actual 201. Test: crm › CRM-03.

### PJ-01 — self-approved timesheet · projects · Medium · Fixed
- Steps: plan@ (projects.*) logs 8 h, submits the week, approves it. Expected 403. Actual 200. Test: projects › PJ-01.

### PJ-02 — future hours · projects · Low · Fixed
- Steps: `POST /timesheets { workDate: '2027-05-03', hours: 8 }`. Expected 400. Actual 201. Test: projects › PJ-02.

### PJ-03 — raw constraint error · projects · Low · Fixed
- Steps: project with end 2026-10-01 before start 2026-10-10. Expected a Thai field error. Actual `400 Value not allowed (projects_check)`.
- Fix: explicit check on create and PATCH (`fieldErrors.endDate`). Test: projects › PJ-03.

### AST-01 — future disposal date · assets · Medium · Fixed
- Steps: dispose AS-… with `disposedOn: 2027-03-15`. Expected 400. Actual 200: asset disposed today, depreciation stopped, gain/loss booked on the 2027 book value.
- Fix: `disposedOn` ≤ today. Test: assets › AST-01 (also checks no depreciation after the disposal month); UAT-42.

### QC-01 — unrounded measurement · quality · Medium · Fixed
- Steps: spec 0.1–0.3, value `0.1 + 0.2` (0.30000000000000004) or 2.05004 in 1.95–2.05.
- Expected: judged as stored/printed (numeric 4 dp) → pass; exactly at min/max passes.
- Actual: stored and printed "0.3000"/"2.0500" but marked ไม่ผ่าน.
- Fix: round to 4 dp before comparing. Test: quality › QC-01; UAT-43 (2.05 at the limit passes, 2.20 fails).

### HD-01 — technician rates own work · helpdesk · Medium · Fixed
- Steps: requester's ticket resolved; technician `POST /tickets/:id/close { satisfaction: 5 }`. Expected 403. Actual 200 — CSAT inflated.
- Fix: satisfaction/feedback only from the ticket's creator (a phone ticket keyed in by the technician may still carry the caller's score). Test: helpdesk › HD-01; UAT-38.

### KRN-01 — 500 on impossible dates · kernel · Medium · Fixed (wave 4)
- Wave 4: the kernel's date schemas reject impossible calendar dates with 400 (`packages/kernel/test/schemas.test.ts`). Original report:
- Steps: `POST /expense/claims` with `expenseDate: '2026-02-31'`. Expected 400. Actual 500 `{"code":"internal"}`.
- Cause: `s.isoDate` is a regex only; Postgres rejects the value (22008). Owner: kernel (`packages/kernel/src/schemas.ts` or map 22007/22008 to 400 in `errors.ts`). Out of this QA's edit scope.

### UI-01 — wide lists on phone · web · Medium · Open
- Steps: phone 390×844, approver opens รออนุมัติ (ของฉัน) (`/m/approvals/inbox`), also inspResults.
- Expected: the row action "อนุมัติ" is visible (shop-floor / mobile approval is the main use).
- Actual: the table is wider than the screen; columns after "จำนวนเงิน" and the action button are off-screen (see `docs/uat/screens/UAT-28-3.jpg`); dialogs opened from such pages are clipped at the right edge. Owner: apps/web (generic list renderer: card layout or horizontal scroll container on phones).

### UI-02 — "ปิดงานตรวจ" dialog on the results page (phone) · web/quality · Medium · Open
- Steps: qc@ on phone → inspResults → ปิดงานตรวจ → dialog → press ปิดงานตรวจ.
- Actual: Chromium reports the dialog's submit button covered ("ยกเลิก intercepts pointer events"); the dialog is pushed partly off-screen (same cause as UI-01).
- Workaround: close the inspection from the report page (inspDetail) — UAT-43 does this. Owner: apps/web.

### AUT-01 — notifications have no recipient · automation · Medium · Fixed (wave 4)
- Wave 4: notifications carry `recipient_user_id`; office templates address the approver / requester / claimant / employee; broadcast read state is per user
  (automation `test/service.test.ts`). UAT-45 now checks that only the step-1 approver gets the alert (not the requester, not the administrator). Original report:
- Notifications are stored per tenant, not per user: anyone with `automation.notify.read` sees every alert, including leave requests and rejection reasons.
  Needs a `recipient_id` (e.g. `nextApproverId`, `requesterId` from the event) and a per-user bell — schema + UI change, design decision for the product owner.

### SEC-01 — finance screens visible to every employee · assets/expense ui · Medium · Fixed (wave 4)
- Wave 4: asset money fields and depreciation need `assets.finance.read`; expense all-claims / to-pay / summary screens need approve / pay perms. UAT-46 checks the
  menus and `GET /assets/depreciation` (403) and that `cost` / `book_value` come back null for staff. Read-only setup lists are left over → SEC-02. Original report:
- The self-service role needs `assets.asset.read` (QR lookup, report a repair) and `expense.claim.read`, which also opens ค่าเสื่อมรายเดือน / ค่าเสื่อมตามหมวด
  (company cost and book values), รอจ่ายเงิน, หมวดค่าใช้จ่าย and ประเภทคำขอและสายอนุมัติ menus. Proposal: a separate `assets.report.read` permission for
  `/depreciation` and finance-only menu perms in `ui.ts` (owned by the ui.ts team; the API change must land together with the screens).

### APV-02 — unknown approver ids · approvals · Low · Open
- A request can be sent to an approver id that does not exist; nobody can act except an approvals admin. Validation needs identity (a lookup through the gateway); left for design.

### AST-02 — future purchase date · assets · Low · Open
- Registering an asset with a purchase date in 2027 is accepted (shows up in future depreciation). Possibly wanted for pre-registration; product decision.

### MSG-01 — English messages · several modules · Low · Open
- e.g. approvals "Cannot approve a approved request", expense "Receipt number required on line(s) 1", assets "Repair is already done". All new messages added in this release are Thai.

### ID-01 — admin menu group for every employee · identity ui · Low · Fixed
- Found by UAT-46 after wave 4: staff (no identity permission) saw the "ผู้ใช้และสิทธิ์" group with "ข้อมูลบริษัท".
- Cause: the new `company` detail screen had no `perm`, so the menu showed it to everyone; `GET /company` is deliberately open to every signed-in user (printed letterheads).
- Fix: the screen needs `identity.company.write` (the same permission the web app already uses for the "ตั้งค่าข้อมูลบริษัท" link); the API is unchanged, printing still works for everyone.
  Test: identity › company profile › "shows the company settings menu only to whoever may change it"; UAT-46.

### SEC-02 — read-only setup menus for staff · approvals / expense / assets ui · Low · Open
- The self-service role still sees ประเภทคำขอและสายอนุมัติ, หมวดค่าใช้จ่าย and หมวดทรัพย์สิน (read-only lists; no money, no edit). Hide them behind the write perms
  (`approvals.type.write`, `expense.category.write`, `assets.asset.write`) or a setup-read perm — product decision, ui.ts owners.

### UI-03 — "จองแทนผู้อื่น" shown to everyone · booking ui · Low · Open
- The booking form shows the optional on-behalf name to every employee; the server ignores it unless the user has `booking.book.approve`, so a typed name silently disappears.
  Needs a per-field `perm` in `@erp/ui-schema` (renderer change in apps/web + apps/mobile), or a 403/field error from the API when a non-approver types someone else's name.

## UAT suite maintenance (wave 4)

- UAT-28/30/34/35: the requester / claimant / booker name inputs were removed on purpose (name comes from the login) — the tests no longer fill them and instead assert
  the field is absent and the detail shows the signed-in user's name.
- UAT-29: PR types lock the approver chain, so "requester puts himself on the chain" is now a 403 on create; the self-approval check (APV-01) runs on a new unlocked
  `MEMO` type seeded for this purpose.
- UAT-45: alerts are personal — the approver (head) opens his bell; the staff role gets `automation.notify.read` as the automation CLAUDE.md recommends.
- UAT-47's 400-vs-404 failure was a knock-on of UAT-28 (no request id → `undefined` in the URL); passes once UAT-28 passes.
- UAT-40 was flaky: the row button turns into "กำลังบันทึก…" while the request runs, so waiting for "อนุมัติ" to detach raced the approval; now polls the API.
- `startWeb` (tests/ui-e2e/browser.ts) refuses to start when the port already answers: a `next start` orphaned by an interrupted run kept :3931 with a dead gateway
  and made the whole factory run hang past the 10-minute limit.
