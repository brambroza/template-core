# maintenance — Maintenance / CMMS (ซ่อมบำรุงเครื่องจักร) · feature

Machines, preventive maintenance plans, work orders. Mobile-first: operators scan a QR on the machine.

## Data
- `machines` (`running | down | retired`) · `pm_plans` (`interval_days`, `next_due_on`)
- `work_orders` (`WO-2569-0001`, `breakdown | pm`, `open → in_progress → done`, `downtime_minutes`, `parts_warehouse_code`) · `wo_parts`
- `settings.default_parts_warehouse` (default `SPARE`)

## Behaviour
- Default PM `last_done_on` (work order completed without a date) uses kernel `TODAY_SQL` — the Thai day of the kernel clock, not the database's UTC `current_date` (wave 8).
- Breakdown report sets machine `down`; completing the last open breakdown sets it back to `running`.
- `POST /pm-plans/generate { asOf }` is idempotent (unique `pm_plan_id + due_on`) — call it daily from a scheduler.
- Completing a PM work order moves the plan: `next_due_on = done date + interval_days`.
- Parts are issued from the `warehouseCode` given on complete, else the tenant's `defaultPartsWarehouse` (SPARE). The UI field is a free-text code
  (lookups into inventory are not allowed) left empty by default so the setting applies; `GET /work-orders/:id` shows `parts_warehouse`.

## API
- `POST/GET /machines` · `GET /machines/by-code/:code` (QR) · `GET /machines/:id/history` (downtime, breakdown count)
- `POST/GET /pm-plans` (`?dueBy=`) · `POST /pm-plans/generate`
- `POST /work-orders` (breakdown, perm `maintenance.wo.report`) · `GET /work-orders` · `GET /work-orders/:id`
- `POST /work-orders/:id/start | complete` (perm `maintenance.wo.work`; complete body: resolution, downtimeMinutes, warehouseCode?, parts)
- `GET /settings` · `PUT /settings { defaultPartsWarehouse }` (perm `maintenance.settings.write`)

## Events
- publishes `maintenance.parts_used` when parts are recorded → Inventory issues spare parts
- publishes `maintenance.breakdown_reported` (report) and `maintenance.work_completed` (complete) → Automation alerts

## Attachments
Kernel attachments (`ServiceDefinition.attachments`): `work-order` (write: report / work / machine.write) and `machine`. The "แจ้งซ่อม" form
(`woNew.attach`) keeps photos/files picked on the spot (camera on phones) and uploads them to the work order right after it is created;
the work-order and machine pages show them with "ถ่ายรูป" / "แนบไฟล์". The reporter only needs `maintenance.wo.report` to attach.

## Extension ideas
Meter-based PM, MTBF/MTTR report from history, before/after photo pairs on completion.

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.
Also: the 3D floor widget (`GET /summary`), ⌘K commands `แจ้งซ่อม <เครื่อง> <อาการ>` / `เครื่อง <เครื่อง>`, and search over machines/work orders.
