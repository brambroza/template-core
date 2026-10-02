# assets — Fixed Assets (ทะเบียนทรัพย์สิน) · feature

Fixed asset register for SMEs: every asset gets a code printed as a QR label. Admin registers assets by category,
staff scan the QR to look an asset up or report a repair, accounting reads monthly straight-line depreciation and
disposes assets with gain/loss, and a yearly physical audit is done by scanning per location. Requires only `identity`.

## Data
- `asset_categories` (code, name, `useful_life_years`, method `straight_line | none`, `salvage_pct`)
- `assets` (code `AS-2569-0001` or user given, category, serial/brand/model, location, purchase_date, cost, salvage_value,
  useful_life_years + method copied from the category at registration, supplier text, warranty_until, custodian snapshot,
  status `in_use | in_storage | in_repair | disposed | lost`, disposal fields, lost_on)
- `asset_assignments` (custodian/location history) · `asset_repairs` (`open | done`, cost, vendor, prev_status)
- `asset_audits` (`AU-2569-0001`, location, `open → closed`) · `asset_audit_lines` (expected, scanned_at, result `found | missing | unexpected`, marked_lost)

## Behaviour
- Default dates written to rows (assignment / repair done / lost on) use kernel `TODAY_SQL` — the Thai day of the kernel clock, not the database's UTC `current_date` (wave 8).
- Depreciation (`src/depreciation.ts`, pure): (cost − salvage) / (life × 12) per month, starting the purchase month; the last
  month absorbs rounding. A month is recognised at month end, so book value "as of" a date counts months whose last day ≤ that date.
  Method `none` or life 0 = never depreciates. Salvage defaults to cost × category %, life to the category's.
- Status: registered `in_use` with a custodian, else `in_storage`. Assign without custodian = back to storage. An open repair puts
  the asset `in_repair`; completing the last open repair restores the previous status. Logging a repair with `completed: true` keeps the status.
- Disposal (sold | scrapped | donated), dated between the purchase date and today (400 otherwise): depreciate through the disposal month, gain/loss = price − book value; open repairs are closed.
- Disposed assets: assign, repair, edit, dispose → 409. Lost assets: repair → 409; assign = found again (status restored, lost_on cleared); dispose allowed (write-off).
- Finance visibility: cost, salvage, accumulated depreciation, book value, monthly depreciation and disposal price/book value/gain-loss
  are returned only to users with `assets.finance.read` (else `null` in every asset response — list, detail, by-code, write results).
  `/depreciation` and `/assets/:id/schedule` require it (403 otherwise); `/summary` returns `totalCost/bookValue/depreciationMonth = null`,
  `byCategory = []`, `months = []` without it. Repair costs stay visible (operational, entered by the reporter).
- Audit: opening snapshots every non-disposed, non-lost asset at that location (case/space-insensitive). Scan answers
  `found | duplicate | unexpected | unknown` + Thai `message`. Close marks unscanned expected lines `missing`.
  `mark-lost` (closed audits only) sets every missing asset `lost`. Scans on a closed audit → 409.

## API
- `GET/POST /categories` · `GET/PATCH /categories/:id`
- `POST/GET /assets` (`?q=&status=&categoryId=&location=&custodianId=&warrantyExpiring=true&active=true`; rows include book_value)
- `GET /assets/by-code/:code` (QR) · `GET/PATCH /assets/:id` · `POST /assets/:id/assign` · `POST /assets/:id/dispose`
- `GET /assets/:id/schedule?asOf=` · `GET /depreciation?month=YYYY-MM&categoryId=` (`rows`, `byCategory`, `totals`)
- `POST /assets/:id/repairs` · `POST/GET /repairs` (POST takes `assetId`) · `POST /repairs/:id/complete`
- `GET /locations` · `POST/GET /audits` · `GET /audits/:id` · `POST /audits/:id/scan { code }` · `POST /audits/:id/close` · `POST /audits/:id/mark-lost`
- `GET /summary` → count, totalCost, bookValue, inRepair, lost, warrantyExpiring30d, depreciationMonth, byCategory, months[6] `{month, depreciation, acquisitions}`, rows (feed)

Permissions: `assets.asset.read` (register without money) · `assets.finance.read` (cost, depreciation, book value) · `assets.asset.write` (register, edit, categories, assign) · `assets.repair.report` · `assets.asset.dispose` · `assets.audit.run`.

## Events
- publishes `assets.repair_reported` (assetId, code, name, description) when an open repair is reported (not when logging an already-finished repair).
- subscribes: none.
- Candidates (not added): `assets.warranty_expiring`, `assets.audit_closed` (automation alerts);
  `assets.depreciation_posted` / `assets.disposed` for a future accounting/costing module; consuming `purchasing.goods_received` to pre-fill assets.

## Screens
`src/ui.ts` — assetList, assetScan (QR filter, mobile), assetNew/Edit/Detail (QR, assign/repair/dispose actions, printable),
assetSchedule, categoryList/New/Edit, repairList (complete row action) + repairNew (QR asset lookup, mobile),
depreciationReport + depreciationByCategory, auditList/New/Detail (scan by QR or typed code, close, mark lost).
Widgets: kpi (counts), kpi `as-value` + bars (book value by category) + trend (depreciation) — finance only, feed (in repair / warranty ending).
Depreciation screens, assetSchedule and the `ค่าเสื่อม` command need `assets.finance.read`.
⌘K: `ทรัพย์สิน <รหัส>` (opens it), `ตรวจนับ`, `ซ่อมทรัพย์สิน <รหัส> <อาการ>`, `ค่าเสื่อม <รหัส>`; search assets and audits.

## Extension ideas
Declining-balance method, partial-month (daily) depreciation, photos (URLs), label sheet printing, insurance policies, link a repair to Maintenance via events.
