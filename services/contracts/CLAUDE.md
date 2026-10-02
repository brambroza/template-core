# contracts — Service Contracts (สัญญาบริการ MA) · feature

MA contracts for service companies (CCTV / network / IT / machine service): the customer, covered equipment and sites, SLA level,
billing plan with an installment schedule, and preventive-maintenance (PM) visits generated from the PM frequency with a checklist,
technician assignment, pass/fail results and customer sign-off on a printable service report. Requires only core: `master-data`
(customer lookup → snapshot `customer_id/code/name`) and `identity` (technician lookup → snapshot id + name). `enhancedBy`
helpdesk and sales — both only through events / typed-in numbers, never calls or joins.

## Data
- `contracts` (`MA-2569-0001`, customer snapshot, `contact_name/phone`, `title`, `start_date`/`end_date`, `value` numeric(18,4) (before VAT),
  `billing_plan` `one_time | monthly | quarterly | yearly`, `sla_response_hours`/`sla_resolve_hours`, `coverage` `8x5 | 24x7`,
  `pm_every_months` (0 = no PM), `first_pm_date` (default `start_date`), `checklist text[]` (template), default technician snapshot,
  status `draft → active → expired | cancelled`, `renewal_of`/`renewal_of_no` ↔ `renewed_to_id`/`renewed_to_no`, `uplift_pct`)
- `contract_items` (`asset`, `serial_no`, `location`, `note`) — free text (no inventory link)
- `installments` (`seq`, `due_date`, `amount`, `invoiced`, `invoice_no` text, `invoiced_on`, `invoiced_by_name`)
- `visits` (`PMV-2569-0001`, contract + customer snapshot, `due_date` (from the PM cycle, the idempotency key with `contract_id`), `scheduled_date`,
  technician snapshot, status `planned → done | missed` (+ `cancelled` when the contract is cancelled; `missed → planned` by reschedule),
  `started_at`, `done_on`, `signoff_name`, `findings`, `missed_reason`, `completed_by_name`)
- `visit_checks` (copied from the contract checklist at generation: `seq`, `item`, `result` `pass | fail | null`, `note`)
- `expiry_notices` (contract + `YYYY-MM`: one expiring alert per contract per month)

## Behaviour
- Dates are Thailand dates (`Asia/Bangkok`): SQL `TODAY` expression in service.ts, `todayBkk()` in `src/schedule.ts`.
- Lazy expiry: every list/detail/summary read turns `active` contracts whose `end_date` has passed into `expired`.
- Edit (`PUT`) only while `draft` (409 otherwise). Ids without display names keep the stored snapshot (the edit form loads ids only);
  `items` omitted = keep the equipment, `checklistText` (textarea, one item per line, leading "-", "•", "1." dropped) wins over `checklist[]`.
  Equipment can be added/removed while `draft` or `active`.
- `activate` (draft only, 409 if the end date has passed) builds installments (`billingSchedule`): one per billing period starting on `start_date`
  (monthly / every 3 / every 12 months while the period start ≤ `end_date`; one-time = one on `start_date`); the value is split evenly in satang and the
  last installment takes the remainder, so the sum is always the contract value (12 months monthly = 12 installments).
- PM due dates = `first_pm_date` (or start) + k × `pm_every_months` months, never after `end_date`. `POST /visits/generate { until }` creates the missing
  ones for every active contract (idempotent: unique `contract_id + due_date`), copies the checklist, assigns the contract's technician and emits
  `contracts.visit_due` per new visit. Due dates before the contract was activated are skipped unless `includePast: true` (a contract keyed in mid-term).
  Call it daily (scheduler) or from the screens. `until` ≤ today + 3 years.
- `overdue` = planned and `scheduled_date` < today. `start` (planned only) records arrival and takes an unassigned visit. Checklist items are recorded
  with `POST /checks/:id/pass | fail {note?}` (409 once the visit is closed). `complete` needs `signoffName` and a result for every item
  (`results[]` and/or `markRemainingPass: true`) — else 409; `done_on` defaults to today. `miss {reason}` planned → missed; `reschedule` missed|planned → planned.
- Renewal (`active | expired` only, once — 409 when `renewed_to_id` is set): new `draft` with the same terms and items, value = `round(value × (1 + upliftPct/100), 2)`
  unless `value` given, period = the day after the old end for the same length (whole months stay whole months, else same number of days) unless
  `startDate`/`endDate` given. Cancelling a renewal draft clears the link so the original can be renewed again.
- `cancel` (draft | active): planned visits → `cancelled`; installments of cancelled (and draft) contracts are excluded from billing lists.
- Billing: `bill {invoiceNo}` records the Sales invoice number as text (no cross-module call); 409 if already billed or the contract is not active/expired; `unbill` undoes.
- Expiring alerts: `POST /contracts/expiring/notify {days=60}` — active, not renewed, ending within `days`; one event per contract per month (daily-callable).

## API
- `GET /contracts` (`?q,status,customerId,billingPlan,expiringDays`; q also matches serial/asset/location) · `POST /contracts` (+ `items[]`) · `GET/PUT /contracts/:id`
- `POST /contracts/:id/activate | cancel {reason?} | renew {upliftPct, startDate?, endDate?, value?} (201) | items {asset, serialNo?, location?, note?} (201) | generate-visits {until, includePast?}`
- `DELETE /contract-items/:id`
- `GET /contracts/expiring?days=60&all=` · `POST /contracts/expiring/notify {days?}`
- `GET /coverage?q=&customerId=` — active contracts × covered items (is this serial / customer under MA? with SLA + coverage)
- `POST /visits/generate {until, contractId?, includePast?}` · `GET /visits` (`?q,status,contractId,technicianId,customerId,overdue,from,to`)
  · `GET /visits/today` (planned ≤ today, everyone) · `GET /visits/mine?days=0` (my planned ≤ today + days)
- `GET/PUT /visits/:id` (`{scheduledDate, technicianId?, technicianName?}`, planned only) · `GET /visits/:id/checks`
- `POST /visits/:id/start | complete {signoffName, findings?, doneOn?, markRemainingPass?, results?[{checkId, result, note?}]} | miss {reason} | reschedule {scheduledDate}`
- `POST /checks/:id/pass | fail {note?}`
- `GET /billing?scope=due|open|all&contractId=&overdue=&q=` (due = not invoiced and due by the end of this month) · `POST /installments/:id/bill {invoiceNo, invoicedOn?} | unbill`
- `GET /summary` → `activeContracts, activeValue, expiring60, drafts, visitsToday, visitsDueWeek, overdueVisits, visitsDoneMonth, billingDueMonth, billingDueCount,
  months[{month, done, missed}], rows` (contracts not cancelled, by end date) — `contracts.contract.read` or `contracts.visit.read`

Permissions: `contracts.contract.read | write | activate`, `contracts.visit.read | plan | work`, `contracts.billing.read | write`.
Technician role: `contracts.visit.read` + `contracts.visit.work`. Sales: `contract.read/write`. Manager: all. Accounting: `contract.read`, `billing.*`.

## Events
- publishes `contracts.visit_due` (visitId, no, contractId, contractNo, customerId, customerName, dueDate, scheduledDate, technicianId, technicianName, itemsText, coverage)
  and `contracts.contract_expiring` (contractId, no, customerId, customerName, title, endDate, daysLeft, value).
- subscribes: none. Candidates (not added): `contracts.visit_completed` (helpdesk closes the PM ticket / customer gets the report), `contracts.installment_due`
  (Sales drafts the recurring invoice).

## Screens
`src/ui.ts`: contracts (list + filters) / contractNew (form + equipment lines) / contractEdit / contract (detail: flow, items, installments, visits;
actions activate, generate PM, add equipment, renew, cancel; printable "สัญญาบริการบำรุงรักษา (MA)"), expiring (notify action, renew row action),
coverage, visitsToday (generate action, start), myVisits (technician, mobile), visits, visitEdit, visit (detail, printable service report
"รายงานการบำรุงรักษา" with signatures ช่างผู้ปฏิบัติงาน / ลูกค้า; actions start → checklist, complete with sign-off, miss, reschedule),
visitChecks (list opened with the visit id: row actions ผ่าน / ไม่ผ่าน), billingDue (bill / unbill row actions).
Widgets: contracts KPI, PM KPI, contract status pipeline, 6-month PM trend. ⌘K: `สัญญา MA <ลูกค้า> <เรื่อง>`, `PM วันนี้`, `MA ใกล้หมด`, `วางบิล MA`.
Search: contracts (no, customer, title, serial via q) and visits.

## Extension ideas
Photos / signature image on the visit (needs an attachment field in the renderer — out of scope now), per-contract business calendar for helpdesk SLA,
parts used on a visit (event to inventory), auto-renew, VAT on installments, recurring invoice drafts in Sales from an `installment_due` event,
customer portal link to the service report.
