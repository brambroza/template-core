# Changelog

## Unreleased — 2026-11-20 · ใช้งานเร็วขึ้น: ตัดสินใจจากหน้าแรกและ LINE, เห็นผลก่อนกด

- **Login with e-mail only**: no company code; an e-mail belongs to one user across all companies (identity migration 003, 409 `email_taken`).
  E-mails shared by two companies before the change still log in: the password picks the account, or the app asks for the company code.
- **ปฏิทิน พ.ศ.**: every date / month box (forms, filters, date ranges) shows and accepts พ.ศ. (`03/10/2569`, `3 ต.ค. 69` …) with a calendar
  (web) or เมื่อวาน/วันนี้/พรุ่งนี้ (mobile); values stay ISO — no service changed.
- **ต้องตัดสินใจวันนี้** on the home page: POs, claims, advances, leave, bookings, repair jobs and approval requests waiting on *me*, most
  pressing first (overdue → urgent → due today → longest waiting), with the approve / reject / accept buttons on the card (`ModuleUi.todo`).
- **Approve from LINE**: approvers' personal LINE alerts for approval requests and leave are cards with **อนุมัติ** (+ confirm); the
  owning module decides as that person with the app's rules and the answer comes back in the chat. POs and expense claims go to every
  linked user allowed to approve them (never the person who raised it) — templates `po-approval-line`, `claim-approval-line`. Refused when the person's roles changed
  or they logged out everywhere after the app last saw their permissions. Reject still opens the app (a reason is required).
- **ผลกระทบเมื่อกดยืนยัน**: "รับของ" on a PO shows, before saving, the stock before → after, the new average cost, the journal accounting
  would post (or why it could not) and the QC inspections that would open. Kernel dry runs (`?_dryRun=1`, rolled back) + `/_impact`.
  Also on "รายงานผลผลิต" (materials out, finished goods in, job cost, final QC) and "บันทึกส่งของ" (stock that would go negative in red).
- **Mobile app**: "ต้องตัดสินใจวันนี้" on the home screen, the impact panel in action dialogs, and พ.ศ. month boxes.

**Cloud plans (phase 1, part 1)**
- Plans Starter 1,490 / Factory 3,490 / Business 6,990 บาท/เดือน (`services/identity/src/plans.ts`): a company provisioned with `plan`
  starts a 14-day trial; the token lists the plan's modules and every module refuses the rest (403 `module_not_in_plan`); menus hide them.
- Trial over / unpaid 7 days past `paid_through` / suspended → login 402 with the Thai reason; user limit per plan (409 `user_limit`).
- Back office: `pnpm erp plan list | set | log` (bank transfer confirmed → `--status active --paid-through …`), every change logged;
  access changes sign everyone in the company out so the new module list applies at once.
- Web: banner "ทดลองใช้แพ็กเกจ Factory เหลือ 5 วัน" / payment reminder; settings screen "แพ็กเกจของบริษัท" with how to pay.
- Companies without a plan (self-hosted installs, the demo) are unchanged.

**Self-serve sign-up and password reset (phase 1, part 2)**
- `/signup`: company, name, work e-mail, password, plan → a confirmation e-mail; opening the link creates the company, its admin and the
  14-day trial and signs the owner in. The answer never tells whether an e-mail already has an account (that owner gets a reset hint by mail).
- `/forgot-password` → one-time 60-minute link → `/reset-password`; every older session ends.
- Mail through Resend or SendGrid (`EMAIL_PROVIDER`, `EMAIL_FROM`), printed to the log when not configured. Cloudflare Turnstile on both
  public forms when its keys are set. Links only from `APP_URL` in production.
- Login throttle, sign-up and reset limits are counted in Postgres (`auth_attempts`): shared by every identity instance, kept across restarts.
- Login page links to sign-up and password reset.

**Back office for cloud plans (phase 1, part 3)**
- GO Along runs its back office in its own company (`OPS_TENANT_CODE`): "หลังบ้าน: บริษัทลูกค้า" lists every company (plan, status, days
  left, users); a company page shows the buyer details for the tax invoice, payments and plan history.
- "บันทึกรับโอน": months, transfer date, amount (default plan price × months), plan → the company is active through the new period
  (continues the paid period, or from today when it lapsed) and GO Along's sales module gets a draft order with the customer's tax
  details for the tax invoice and receipt. "เปลี่ยนแพ็กเกจ / สถานะ" with a reason.
- `<module>.ops.*` rights are never granted by `*` — a customer's administrator cannot see or grant them; the API also checks the company.
  First staff member: `pnpm erp plan grant-ops <email>`.

**Operations: backups, uptime, error reporting (phase 1, part 4)** — runbook in `docs/operations.md`
- `pnpm erp compose` adds a `backup` container: nightly `pg_dump` of every database at `BACKUP_AT`, then a restore drill into scratch
  databases (checksums, tables, migrations), `BACKUP_KEEP_DAYS` retention, and a heartbeat ping (`BACKUP_PING_URL`) only when both
  passed. `erp-backup now | list | check | restore <stamp> --yes [db…]`. `backup-offsite` copies the backups to a private Spaces bucket.
- `GET /api/_health` on the gateway (through the web app) for UptimeRobot: 200 when every module and its database answer, 503 naming the
  module that is down. A module's `/_health` now checks its database. A module that is down answers a Thai 502 through the gateway.
- Sentry without an SDK (`SENTRY_DSN`): 500s, failed outbox dispatches and crashes from every module and the gateway, with ids and the
  route pattern only (no bodies, headers, e-mails or query strings), at most 30 per minute per process.

**Sample data per industry (phase 2, part 1)**
- Sign-up asks the type of business: ซื้อมาขายไป/ค้าส่ง, อาหาร/แปรรูป, โรงงานชิ้นส่วนโลหะ/งานกลึง (or none). After the e-mail is confirmed the
  company gets that industry's sample data (`packages/starter`) through the real APIs: items, customers, suppliers, warehouses and opening
  stock, purchase orders, sales orders, production with BOMs, machines with PM and an open repair, QC plans, and journals from the same events
  real work raises. Modules outside the plan are skipped. Two made-up helpers record and approve the samples, so the PO waiting for approval
  can be approved by the owner (separation of duties).
- Home page bar: what to try first (approve PO-…, receive PO-…, ship SO-…) and **ล้างข้อมูลตัวอย่าง — เริ่มใช้จริง**. Typing the words emits
  `identity.tenant_data_cleared`, a kernel subscription: every module deletes all of the company's rows (`packages/kernel/src/wipe.ts`,
  keeping `_revoked_tokens`); users, roles, company profile and plan stay, numbering restarts at 0001. Once only, never while seeding.
- Identity needs the gateway address for this: `GATEWAY_URL`, or the host of `EVENT_ROUTER_URL`.

**Phase 0 (self-serve blockers found by the new-user test)**
- Login throttle per e-mail + client IP (plus 50/e-mail and 100/IP caps): wrong guesses from elsewhere no longer lock the owner out.
  The gateway sends `x-erp-client-ip` (what it saw, never copied from the request); behind a load balancer set `TRUST_PROXY` to its addresses.
- Dates: a Buddhist-era year in an API date (`2569-11-20`) is a Thai 400 ("ปี 2569 เป็น พ.ศ. — ระบบรับปี ค.ศ. (2026)") instead of a document
  dated 543 years ahead (PO-3112-…). `s.isoDate` everywhere; expense months too.
- Validation errors in Thai for every module (kernel zod error map): "ข้อมูลไม่ถูกต้อง — lines › แถวที่ 2 › qty: ต้องมากกว่า 0"; list problems
  name the row; duplicates say which value (`"RM-01" มีอยู่ในระบบแล้ว`); broken JSON is explained. `details.issues` carries the full paths.
- Impact preview: red lines (stock going below zero) must be acknowledged with a tick before the confirm button works (web + mobile).
- Purchasing: the creator-cannot-approve 403 tells an owner/admin where to switch the rule off (one-person companies).

## 0.3.1 — 2026-10-03 · ภาษีไทยครบรอบเดือน + ยกเลิกเซสชัน

**In numbers:** 22 modules (new: `etax`) · 931 automated tests · **77 UAT cases (UAT-01..77)** all passing in Chromium · roadmap 553 of 1,060 functions done.

**Tax documents and returns**
- `sales`: ใบลดหนี้ (CN, §86/10) and ใบเพิ่มหนี้ (DN, §86/9) against a tax invoice — legal reason lists, original/correct value,
  VAT on the difference (exclusive and inclusive invoices, satang-exact), credit limited to the invoice value, receivables and aging net of
  notes (credit balances shown, not aged), goods returned to stock through `inventory`.
- `purchasing`: supplier bills (ตั้งหนี้) against a PO or for services/expenses, payables aging, supplier payments (PV) with withholding tax
  by income type, 50 ทวิ certificates (two copies), monthly ภ.ง.ด.3 / ภ.ง.ด.53 return with CSV and an RD Prep text export.
- `accounting`: posts credit/debit notes, supplier bills (no double-counted input VAT on goods) and payments with WHT payable per form;
  ภ.พ.30 in boxes 1–16 with carry-forward, filing records and ภ.พ.30 เพิ่มเติม, late-filing surcharge hint, WHT payable report.
- `etax` (new, sellable add-on): ETDA e-Tax Invoice XML (ขมธอ. 3-2560) for 388/T02/80/81, XAdES-BES signing with the company's own .p12
  (password never stored), delivery status recorded by the user, cancel and replacement invoices (TIVC codes).

**Security**
- SEC-07 fixed: `identity.tokens_revoked` reaches every module's kernel; logout, change password, disabling a user, changing roles and an
  admin "force logout" revoke older tokens (identity immediately, other modules ~1 s, other instances ≤ 30 s). Change-password screen.

**Not done — what the system does NOT do (say this to customers)**
- Nothing is filed or submitted for the customer: ภ.พ.30 and ภ.ง.ด.3/53 are filed by the user on rd.go.th and recorded here; e-Tax files
  are sent by the user via e-Tax Invoice by Email or a service provider. No PDF/A-3 for e-Tax by Email yet; no e-Receipt.
- Must be checked before relying on it: the RD Prep text layout, ภ.พ.30 box numbering, the e-Tax XML against ETDA's XSD/validator.
- Open UX: the .p12 is uploaded as pasted base64 (no file picker yet); the RD Prep .txt is copied from the screen (no download button).

## 0.3.0 — 2026-10-03 · "ทั้งบริษัท" — office, service and finance modules

**In numbers:** 21 modules (2 core + 19 feature, up from 9) · ~700 automated test cases in 82 test files (unit, permission,
tenant isolation, gateway e2e, UI descriptors, security regressions) · **64 UAT cases (UAT-01..64)** in Chromium (up from 27) — pass results:
see `docs/uat/uat-pack.html` (rebuild with `pnpm uat:pack` before tagging) · roadmap 536 of 1,051 functions done (was 455 of 1,000) ·
19 bundles incl. 3 new industry packs · 26 one-click bot templates (was 8).

**Multi-industry modules**
- Nine business modules for offices, services and factories: `approvals` (e-Approval / e-Memo), `hr` (employees, leave, GPS check-in),
  `expense` (claims, cash advances), `assets` (QR register, depreciation), `crm` (leads, pipeline, quotations), `helpdesk` (tickets, SLA,
  knowledge base), `projects` (budget, task board, timesheets), `quality` (inspection plans, NCR, CAPA), `booking` (rooms, cars, equipment).
- Each with permission + tenant-isolation tests, screens on web and mobile, dashboard widgets, Thai ⌘K commands and search.
- 14 new events; quality creates inspections from goods receipts and production; quotation accepted → draft sales order.
- CSV export on every list, CSV import with dry-run preview; demo company covers all modules.

**Wave fixes from simulated buyer reviews** (AI personas of a plant manager, office HR manager and service company owner — `sales/feedback/`; รีวิวจำลอง (AI persona) — ใช้เป็นสมมติฐาน ต้องยืนยันกับลูกค้าจริง)
- Company profile + A4 letterhead (Revenue Code §86/4 seller block, logo, signature boxes, original/copy label) on every printed document.
- Names from the login everywhere; leave routes to the employee's manager (org chart); locked approver chains; approval delegation.
- Personal notifications with per-user read state; QC-HOLD quarantine; purchase returns; negative-stock anomalies.
- Receipts with 1–5% withholding tax, deposits and deposit application, receivables and aging; helpdesk business-hours SLA.
- Role templates per department; UX pass (menu and dashboard by business area) and QA pass (27 bugs found, 19 fixed with regression tests).

**Finance (MVP)**
- `accounting`: Thai SME chart of accounts, journal vouchers with reversal, monthly period close, automatic posting from sales, receipts,
  goods receipts/returns (VAT split), expense claims (by category) and payroll; posting-error queue with retry; trial balance, general
  ledger, P&L (month + YTD), balance sheet, VAT (ภ.พ.30 summary, sales/purchase VAT registers), WHT received.
- `payroll`: monthly salary and daily wage, OT 1/1.5/2/3×, social security, provident fund, annualised PND1 withholding with allowances,
  proration, loans, mid-year opening balances, Excel import, unpaid leave from HR, approval, payslips and 50 ทวิ on the phone, bank
  transfer list and SPS 1-10 data as CSV, `payroll.run_paid` → salary journal.
- `contracts`: MA contracts with covered equipment/serials and SLA, PM visit generation, checklist on the phone, printable contract and
  maintenance report, billing schedule → draft service orders in sales, renewal, coverage lookup, expiry alerts.
- Not yet: credit notes, ภ.ง.ด.1ก, employees' 13-digit IDs (0.3.x, Dec 2026) · e-Filing files, e-Tax Invoice, AP bills + PND3/53, cost of sales,
  bank reconciliation, bank-format payroll files (0.4, Mar 2027).

**Wave 6 — one connected system**
- Events wire the finance modules together: expense lines/VAT → accounting by category, invoice issue date and purchase VAT split,
  payroll run → salary journal, HR employees → pay profiles, unpaid leave → payroll, MA visits → PM tickets, installments → draft service orders.
- Gateway e2e: invoice → receipt → balanced journals, payroll → journal, HR → payroll. 4 more automation templates (26).
- Mobile camera/library/file uploads, OS dark mode, bigger shop-floor UI; web report presentation (sections, subtotals, accounting format).

**Wave 7 — finance UAT and demo books**
- UAT-48..64 (company profile, role templates, payroll, month-end close, VAT/WHT, MA, LINE, attachments, audit, delegation, QC-HOLD).
- Demo: 42 balanced journals with a closed September, payroll for 27 people (PR-2569-09 paid, PR-2569-10 awaiting approval),
  3 MA contracts with PM tickets and installment orders, real attachments. QA: 14 bugs, 10 fixed (`docs/uat/bugs-0.4.md`).

**Wave 8 — controls and Thai tax correctness** (from the round-2 simulated buyer check and the simulated accounting-firm partner persona — `sales/feedback/`; not real customers, findings still to be confirmed by a real CPA firm)
- Segregation of duties: a PO's creator cannot approve it, two approval limits per company (`purchasing.po.approve-high` above the
  standard limit), receipt log with an "approver received it" exception list; whoever approved a claim/advance cannot pay it and nobody
  pays their own; over-limit claims need `expense.claim.approve-over-limit`. Role templates follow the same split; demo users are created from them.
- QC-HOLD: stock leaves a hold warehouse only through a QC release or a purchase return; every reduction is logged; admin override needs a reason.
- Bangkok business dates everywhere (kernel clock, `thaiToday()`, `TODAY_SQL`) — no more "yesterday" between 00:00 and 07:00.
- Lock dates: closing an accounting period locks tax invoices, receipts, goods receipts, returns and claim payments dated into it (override with permission + reason).
- Tax: social-security ceiling by effective date (17,500 / 875 from Jan 2026; 20,000 in 2029; 23,000 in 2032) · output VAT on deposits
  (deposit tax invoice `DT-…`, deducted on the final invoice) · non-claimable input VAT (entertainment, passenger cars, abbreviated or
  sellerless receipts) booked as expense, VAT must be 7% · WHT received on the service portion or the base on the customer's 50 ทวิ ·
  supplier tax-invoice no/date/tax ID/branch and the real receipt date at goods receipt · VAT registers with partner tax ID and branch,
  totals equal to ภ.พ.30 · ภ.พ.30 carry-forward / carried-in, months never netted.
- Paper: payment terms only on tax invoices and quotations, status/warehouse/outstanding never print, warning when a company buyer has no tax ID;
  ⌘K examples from the user's own modules; ~110 server messages in Thai.
- Still not filing-ready (0.3.x / 0.4): credit notes, AP bills + ภ.ง.ด.3/53, e-Filing files, e-Tax Invoice, employees' 13-digit IDs on
  ภ.ง.ด.1/สปส. attachments, ภ.ง.ด.1ก, cost of sales — see `docs/roadmap/README.md`.

**Security review 0.3** (`docs/security/review-0.3.md` — 3 High, 6 Medium, 12 Low/Info; all High fixed)
- No granting beyond your own rights (users/roles), login throttling (10 failures / 15 min) with uniform errors, services refuse the
  example secrets, download and web security headers, SSRF guard resolves DNS and blocks private ranges, LINE link-code guessing capped,
  wider audit redaction, safe SVG logos, tokens must expire, CSV formula neutralising. Open decisions: token revocation, HTTPS install default.

**AI (optional, customer's own key — `docs/ai.md`)**
- Receipt scan fills the expense claim (vision, validated JSON, Buddhist-era dates, only real categories) and attaches the photo after saving.
- "สรุปให้หน่อย" daily briefing on the dashboard (≤ 5 items with links, cached 10 min per user); "ค้นหาด้วย AI" in ⌘K opens a list with valid filters.
- AI never saves on its own and reads only declared GET endpoints with the user's token.

**Platform**
- Attachments (5 MB, type sniffing, signed links, RLS) on 10 modules; audit log of every write with a history panel on detail pages.
- LINE: link a LINE account to an ERP user with a 6-digit code, personal LINE alerts, chat commands, signed webhook through the gateway.
- Report-grade finance UI: sections, subtotals, double rules, accounting number format, period titles, balanced badge, date-range presets,
  print fixes for every document; Kernel: idle database errors no longer crash a service, DB-busy → 503.

**Mobile**
- Camera / photo library / file attachments on documents, follows the OS dark mode, bigger shop-floor UI, my payslips and 50 ทวิ, PM checklist.

**Pricing v2**
- Monthly rental (≈ 4.1–4.6% of the license per month, 12-month minimum, rent-to-own credit), 60-day pilot, 3-tier partner program;
  `pnpm erp quote … --rent | --pilot | --partner`.
- New packs: สำนักงานครบ + เงินเดือน (`office-payroll`, 65,000 / 2,790 per month), บัญชีและการเงิน SME (`finance-sme`, 62,000 / 2,690),
  ธุรกิจบริการ + MA (`service-ma`, 89,000 / 3,790); Factory OS ครบทุกโมดูล now all 19 feature modules (259,000 / 10,990). Prices exclude the platform.

**Growth docs**
- 12-month expansion plan, 4-week launch content, pricing/TCO calculator, objection handling and partner kit (`sales/`); multi-industry
  landing page with industry switcher, buy/rent toggle, pilot and partner sections, finance area and roadmap counters from `functions.json`.
- Roadmap re-planned (twice on 3 Oct): 0.3.x (Dec 2026) filing deadlines + round-2 blockers + pilot promises, 0.4 (Mar 2027) AP/ภ.ง.ด.3/53,
  e-Filing / e-Tax, cost of sales, bank; 0.5 (Jun 2027) POS, marketplaces, LINE OA for customers, field service, OEE, AI that works.

## 0.2.0 — 2026-10-03 · "Factory OS" launch

**Look and feel**
- New modern-minimal web UI: icon rail + module panel, command bar, dark mode, GSAP motion (respects reduced motion).
- Home "ภาพรวมโรงงาน": 3D factory floor (three.js) coloured by machine status, KPIs that count up, pipelines,
  trends, reorder bars and a live bot feed — every installed module contributes its own widgets.
- Document status flow (2D stepper) on detail screens; card galleries (`display: 'cards'`); toasts.
- Mobile: new theme, "งานวันนี้" home with KPIs and bot feed, row actions on lists.

**Bots and AI**
- New module `automation`: when/if/then rules, 8 one-click templates, in-app notifications (bell), LINE push,
  signed webhooks with SSRF guard, dry-run test, run history.
- New events: `inventory.low_stock`, `purchasing.po_created`, `purchasing.po_approved`,
  `maintenance.breakdown_reported`, `maintenance.work_completed`.
- ⌘K command palette: Thai commands that resolve records and prefill forms ("แจ้งซ่อม PRESS-01 น้ำมันรั่ว"),
  screen jump, record search, and an AI assistant (Claude, customer's own API key) that reads live data with the
  user's permissions and only opens prefilled screens.

**Platform**
- `GET /summary` on every module for dashboards; inventory reorder points.
- `@erp/ui-schema`: widgets, commands, search, notifications, `listRows`, `commandTarget`, `prefillFromQuery`.
- `pnpm demo` seeds a believable 6-month factory (9 machines, POs, invoices, MOs, rules firing).
- Landing page `site/` with live module quote from `catalog.json`; pricing for automation + new bundle.
- UAT 0.2.0: 27 cases in Chromium (new: dashboard, one-click bot, Thai command, notifications, AI assistant).

## 0.1.0
- Modular ERP: identity, master-data, inventory, purchasing, sales, production, maintenance, costing;
  licensing, pack/compose, web + mobile renderers from screen definitions, UAT pack.
