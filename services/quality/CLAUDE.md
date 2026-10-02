# quality — Quality Control (ควบคุมคุณภาพ) · feature

ISO 9001-friendly QC for factories: inspection plans per item and stage, incoming / in-process / final inspections with
per-checkpoint results, non-conformance reports (NCR) and corrective actions (CA). QC staff work from the phone queue.
Requires `identity` + `master-data` only; `purchasing` and `production` enhance it through events.

## Data
- `inspection_plans` — item snapshot (`item_id/code/name`), `stage incoming | in_process | final`, `sampling_mode fixed | percent` + `sampling_value`, `active`.
  **One active plan per item + stage** (partial unique index).
- `plan_checkpoints` — `seq`, name, method, `type measure | pass_fail | visual`, unit, target, `min_value`, `max_value`, `critical`.
- `inspections` — `QC-2569-0001`, stage, plan snapshot, item snapshot, lot no, `source_type manual | purchase_order | production_order`, `source_ref` (PO/MO no),
  supplier snapshot, qty, `sample_size`, inspector snapshot, `status pending → in_progress → completed` (exit `cancelled`),
  `result pass | fail | conditional`, `accepted_qty` / `rejected_qty`. `source_event_id + source_line` unique (event idempotency).
- `inspection_results` — checkpoint **snapshot** per inspection (editing a plan never changes past inspections) + `value`, `passed`, `note`.
- `ncrs` — `NCR-2569-0001`, optional link to one inspection (unique), item/lot/supplier snapshots, description, `qty_affected`,
  `severity minor | major | critical`, `disposition rework | scrap | use_as_is | return_to_supplier`, `why_analysis` (5-Why), `root_cause`,
  `status open → investigating → action → closed`.
- `corrective_actions` — `CA-2569-0001`, NCR link, action, owner snapshot, `due_on`, `status open → done → verified`; overdue = open and past due.

## Behaviour
- Sample size: fixed qty (never more than the lot) or `ceil(qty × % / 100)`, at least 1. Can be overridden on a manual inspection.
- A checkpoint fails when a measured value is outside min/max, or when it is marked failed (`/fail`). Measure checkpoints need a value; others need pass/fail.
- Recording any result moves a pending inspection to `in_progress`. Complete needs every checkpoint recorded (409 otherwise).
- Verdict: no fails → `pass`; any **critical** checkpoint failed → `fail`; only non-critical fails → `conditional`.
  Default quantities: fail → all rejected; pass/conditional → all accepted. Given quantities must add up to the lot qty (400).
- NCR from an inspection only when completed with `fail`/`conditional`, once per inspection; prefilled description (failed checkpoints, values, spec),
  `severity` (fail → major, conditional → minor), `qty_affected` (rejected qty or lot qty).
- Adding a CA moves an open/investigating NCR to `action`. Closing (from investigating/action) requires root cause + disposition and no CA still `open`.
- Every state change outside its allowed states returns 409. Thai labels come back as `*_th` fields (status_th, stage_th, result_th, severity_th…).

## API
- Plans: `POST/GET /plans` (`?q&stage&itemId&active`) · `GET/PATCH /plans/:id` · `POST /plans/:id/checkpoints` · `POST /plans/:id/checkpoints/remove { seq }` ·
  `POST /plans/:id/deactivate | activate` (perm `quality.plan.read|write`)
- Inspections: `POST /inspections` (409 when no active plan) · `GET /inspections` (`?q&status=a,b&stage&result&itemId&from&to`) · `GET /inspections/queue` ·
  `GET /inspections/:id` · `GET /inspections/:id/results` · `POST /inspections/:id/start { inspectorId?, inspectorName? }` ·
  `POST /inspections/:id/results { results: [{ resultId, value?, passed?, note? }] }` · `POST /inspection-results/:id { value?, passed?, note? }` ·
  `POST /inspection-results/:id/pass | fail` · `POST /inspections/:id/complete { acceptedQty?, rejectedQty?, note? }` · `POST /inspections/:id/cancel`
  (perm `quality.inspection.read|record`)
- NCR: `POST /inspections/:id/ncr` · `POST/GET /ncrs` (`?q&status&severity&open`) · `GET/PATCH /ncrs/:id` · `POST /ncrs/:id/investigate` ·
  `POST /ncrs/:id/actions` (new CA) · `POST /ncrs/:id/close` (perm `quality.ncr.close`)
- CA: `GET /corrective-actions` (`?q&status&overdue&ncrId`) · `GET /corrective-actions/:id` · `POST /corrective-actions/:id/done` · `POST /corrective-actions/:id/verify` (perm `quality.ncr.close`)
- Reports: `GET /summary` (pendingInspections, passRateMonth, inspectedMonth, failedMonth, openNcr, criticalNcr, overdueActions, months[], rows = open NCRs, defects) ·
  `GET /reports/pass-rate?months&stage` · `GET /reports/defects?by=checkpoint|item&stage&from&to` · `GET /reports/suppliers?from&to` · `GET /reports/ncr-severity`

## Events
- subscribes `purchasing.goods_received` → one PENDING incoming inspection per received line whose item has an active incoming plan (supplier + PO no snapshot).
- subscribes `production.completed` → a PENDING final inspection when the item has an active final plan (MO no snapshot).
- Handlers skip items without plans, never throw for business reasons, and are idempotent (kernel inbox + unique `source_event_id, source_line`).
- publishes nothing yet.

## Screens
`src/ui.ts` — queue (mobile home: งานรอตรวจ → บันทึกผล), inspList / inspNew / inspDetail (printable inspection report, flow, actions record / assign /
complete / raise NCR / cancel), inspResults (per-checkpoint pass / fail / measure buttons, mobile), ncrList / ncrNew / ncrEdit / ncrDetail (printable NCR),
caList / caDetail, planList / planNew / planEdit / planDetail, reports passRate / defects / suppliers / ncrSeverity.
Widgets: kpi, pass-rate trend, NCR pipeline, defects bars. ⌘K: `ตรวจ <สินค้า> <ล็อต>`, `NCR <รายละเอียด>`, `รอตรวจ`, `CA ค้าง`. Search: inspections, NCRs.

## Extension ideas
AQL tables (ANSI Z1.4) instead of fixed/% sampling, photo attachments per result, SPC charts (X̄-R) from measured values, supplier scorecards
merged with delivery performance, events `quality.inspection_completed` / `quality.ncr_raised` for Automation alerts and Inventory quarantine.
