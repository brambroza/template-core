# Changelog

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
