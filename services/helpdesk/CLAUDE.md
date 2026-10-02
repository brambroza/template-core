# helpdesk — Helpdesk & Service (แจ้งปัญหาและบริการ) · feature

Tickets for internal IT/facility requests or customer service, with SLA, technician queue, comments, satisfaction,
canned replies and a knowledge base. Requires only core: `identity` (assignee lookups; users stored as id + name snapshots) and
`master-data` (customer lookup on the "บันทึกเรื่องจากลูกค้า" screen; stored as a snapshot, never joined).

## Data
- `categories` (`code`, `sla_response_hours`, `sla_resolve_hours`, default assignee snapshot, `active`)
- `tickets` (`TK-2569-0001`, channel `web | phone | line | email | walk_in`, priority `low | normal | high | urgent`,
  status `open → in_progress → waiting → resolved → closed`, `response_due_at`, `due_at`, `first_response_at`, `resolution`,
  `satisfaction` 1–5, `feedback`, `reopen_count`, `created_by` = requester user, `reported_at` (SLA start), `sla_mode` `business | clock`,
  customer snapshot `customer_id/code/name`, `asset_ref` (asset code / serial, free text), `ref` (source document, searchable), `source_visit_id` (PM visit, unique — migration 003))
- `sla_settings` (one row per tenant; none = defaults: business hours on, Mon–Fri 08:00–17:00 `Asia/Bangkok`, urgent 24×7) · `holidays` (`date`, `name`, unique per tenant)
- `ticket_comments` (`internal` note or public reply, author snapshot) · `canned_replies` · `kb_articles` (`published`, `views`)

## Behaviour
- SLA: due times = `reported_at` + category hours (no category: 4 h response / 24 h resolve); `urgent` halves both.
  Hours are **business hours** (working days/hours + holidays from the tenant calendar, `src/business-hours.ts`) unless business hours are off,
  or the ticket is `urgent` and `urgent24x7` is on (then clock hours). Example: reported 23:04 Friday, 4 h → due Monday 12:00.
  `reportedAt` (ISO datetime, not in the future) is accepted from technicians only — e.g. a call logged the next morning; requesters always start now.
  Editing category/priority/customer (`PUT`) recomputes from `reported_at`; reopening starts a new resolve deadline from now. Changing the calendar affects new/edited/reopened tickets only.
- Computed on every read: `overdue` (active and past `due_at`), `response_overdue` (no response yet and past `response_due_at`),
  `priority_label`, `channel_label`, `sla_mode_label` (เวลาทำการ / 24 ชม.).
- Category default technician is assigned on create. Only `helpdesk.ticket.work` users may choose an assignee; `start`/`resolve` by an unassigned
  technician sets assignee id **and name** from the token.
- Names come from the login (`auth(req).userName`): comment author (`authorName` in the body is only a fallback for old tokens without a name),
  requester name when a non-technician reports for themself and leaves it empty.
- First response = `start`, a public reply by a technician, or resolve.
- Requesters (`helpdesk.ticket.create` only) see just their own tickets and never internal notes; their public reply on a
  `waiting` ticket moves it back to `in_progress`.
- `resolve` needs a resolution; `close` (requester or technician) only from `resolved` — satisfaction/feedback only from the ticket's creator (403 for a technician closing someone else's ticket); `reopen` only from `resolved`.
  Disallowed transitions return 409; comments on closed tickets 409.
- **PM tickets from MA contracts** (`pmTicketFromVisit`, handler `contracts.visit_due`): one ticket per visit (`source_visit_id`), category `PM-MA` "PM ตามสัญญา"
  (auto-created, 24/72 h), title `PM <contract no> — <customer>`, description = due date + covered items + coverage, customer snapshot (requester name = customer),
  assignee = the visit's technician snapshot, `response_due_at` / `due_at` = scheduled date 08:00 / 17:00 Bangkok (`sla_mode` clock), `asset_ref` = items text,
  `ref` = `PMV-… (MA-…)`, `created_by` null; publishes `helpdesk.ticket_created`.
- KB: readers see published articles only (`GET /articles/:id` of a draft = 404 for them); reading counts a view.

## API
- `GET/POST /categories` · `GET/PUT /categories/:id`
- `GET /settings/sla` (any helpdesk reader) · `PUT /settings/sla {businessHours, workDays: [1..7] | "1,2,3,4,5", workStart "HH:MM", workEnd, urgent24x7, timezone}` (setup)
- `GET /holidays?year=` (พ.ศ. or ค.ศ.) · `POST /holidays {date, name}` (409 duplicate date) · `DELETE /holidays/:id`
- `POST /tickets` (+ `customerId, customerCode, customerName, assetRef, reportedAt`) · `GET /tickets` (`?q,status,priority,channel,categoryId,assigneeId,unassigned,overdue,active,customerId`; q also matches customer and asset) · `GET /tickets/mine` (technician queue)
  · `GET /tickets/requested` (my requests) · `GET /tickets/overdue` · `GET/PUT /tickets/:id`
- `POST /tickets/:id/assign {assigneeId, assigneeName?} | start | wait {reason?} | comments {body, internal?, authorName?} | resolve {resolution} | reopen {reason?} | close {satisfaction?, feedback?}`
- `GET/POST /canned-replies` · `GET/PUT/DELETE /canned-replies/:id`
- `GET/POST /articles` (`?q,categoryId`) · `GET/PUT /articles/:id` · `POST /articles/:id/publish | unpublish`
- `GET /summary` → `open, overdue, unassigned, resolvedToday, avgResolutionHours (90 d), satisfactionAvg (90 d), months[{month,opened,resolved}], rows` (not closed, by due)

Permissions: `helpdesk.ticket.create | read | work`, `helpdesk.setup.write`, `helpdesk.kb.read | write`.
Technician roles should also get `helpdesk.ticket.create` (the ticket detail screen is gated on it so requesters can open it).

## Events
- publishes `helpdesk.ticket_created` (ticketId, no, title, priority, categoryName, requesterName, assigneeName) and
  `helpdesk.ticket_resolved` (ticketId, no, title, requesterName, resolution) — Automation alerts the technician / requester.
- subscribes `contracts.visit_due` (contracts is `enhancedBy`) → PM ticket (see Behaviour). Candidates (not added): `helpdesk.ticket_overdue` (needs a timer);
  a `contracts.visit_completed` event to resolve the PM ticket when the technician closes the visit in contracts.

## Screens
`src/ui.ts`: ticketNew, ticketLog (technician logs a customer's call: customer lookup + asset/serial), myRequests, myTickets, tickets, overdueTickets, ticket (+ticketEdit, printable),
slaSettings (form on `/settings/sla`), holidays/holidayNew, articles (cards)/article/articleNew/articleEdit,
cannedReplies/cannedNew/cannedEdit, categories/categoryNew/categoryEdit. Widgets: KPI, status pipeline, monthly trend.
⌘K: `แจ้งปัญหา <เรื่อง>`, `งานค้างของฉัน`, `วิธีแก้ <คำค้น>`, `เกิน SLA`; search tickets and articles. Mobile: report, my requests, technician queue and all ticket actions.

## Extension ideas
Photo attachments (URLs), per-category / per-contract calendars, customer satisfaction link, auto-close resolved tickets after N days, link tickets to machines when Maintenance is installed (via events).
