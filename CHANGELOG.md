# Changelog

## 0.3.0 — 2026-10-03 · "ทั้งบริษัท" — office, service and finance modules

**In numbers:** 21 modules (2 core + 19 feature, up from 9) · ~520 automated test cases in 59 test files (unit, permission,
tenant isolation, gateway e2e, UI descriptors) · 64 UAT cases in Chromium (up from 27): UAT-01..47 passed 47/47 in wave 4,
UAT-48..64 (company profile, role templates, payroll, month-end close, VAT/WHT, MA, LINE, attachments, audit, delegation, QC-HOLD)
added for this release — run `pnpm uat:pack` for the full 64 before tagging ·
roadmap 516 of 1,020 functions done (was 455 of 1,000) · 19 bundles incl. 3 new industry packs · 26 one-click bot templates (was 8).

**Multi-industry modules**
- Nine business modules for offices, services and factories: `approvals` (e-Approval / e-Memo), `hr` (employees, leave, GPS check-in),
  `expense` (claims, cash advances), `assets` (QR register, depreciation), `crm` (leads, pipeline, quotations), `helpdesk` (tickets, SLA,
  knowledge base), `projects` (budget, task board, timesheets), `quality` (inspection plans, NCR, CAPA), `booking` (rooms, cars, equipment).
- Each with permission + tenant-isolation tests, screens on web and mobile, dashboard widgets, Thai ⌘K commands and search.
- 14 new events; quality creates inspections from goods receipts and production; quotation accepted → draft sales order.
- CSV export on every list, CSV import with dry-run preview; demo company covers all modules.

**Wave fixes from buyers** (plant manager, office HR manager, service company owner — `sales/feedback/`)
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
- Not yet (0.4, Mar 2027): e-Filing files, e-Tax Invoice, AP bills + PND3/53, bank reconciliation, bank-format payroll files.

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
- Roadmap re-planned: 0.3.x (Dec 2026) pilot promises, 0.4 (Mar 2027) tax filing / AP / bank / e-Tax, 0.5 (Jun 2027) POS, marketplaces,
  LINE OA for customers, field service, OEE, AI that works.

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
