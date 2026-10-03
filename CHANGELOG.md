# Changelog

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
