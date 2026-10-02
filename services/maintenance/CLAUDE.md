# maintenance — Maintenance / CMMS (ซ่อมบำรุงเครื่องจักร) · feature

Machines, preventive maintenance plans, work orders. Mobile-first: operators scan a QR on the machine.

## Data
- `machines` (`running | down | retired`) · `pm_plans` (`interval_days`, `next_due_on`)
- `work_orders` (`WO-2569-0001`, `breakdown | pm`, `open → in_progress → done`, `downtime_minutes`) · `wo_parts`

## Behaviour
- Breakdown report sets machine `down`; completing the last open breakdown sets it back to `running`.
- `POST /pm-plans/generate { asOf }` is idempotent (unique `pm_plan_id + due_on`) — call it daily from a scheduler.
- Completing a PM work order moves the plan: `next_due_on = done date + interval_days`.

## API
- `POST/GET /machines` · `GET /machines/by-code/:code` (QR) · `GET /machines/:id/history` (downtime, breakdown count)
- `POST/GET /pm-plans` (`?dueBy=`) · `POST /pm-plans/generate`
- `POST /work-orders` (breakdown, perm `maintenance.wo.report`) · `GET /work-orders` · `GET /work-orders/:id`
- `POST /work-orders/:id/start | complete` (perm `maintenance.wo.work`; complete body: resolution, downtimeMinutes, warehouseCode, parts)

## Events
- publishes `maintenance.parts_used` when parts are recorded → Inventory issues spare parts
- publishes `maintenance.breakdown_reported` (report) and `maintenance.work_completed` (complete) → Automation alerts

## Extension ideas
Photos (store URLs), meter-based PM, MTBF/MTTR report from history.

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.
Also: the 3D floor widget (`GET /summary`), ⌘K commands `แจ้งซ่อม <เครื่อง> <อาการ>` / `เครื่อง <เครื่อง>`, and search over machines/work orders.
