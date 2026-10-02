# helpdesk — Helpdesk & Service (แจ้งปัญหาและบริการ) · feature

Tickets for internal IT/facility requests or customer service, with SLA, technician queue, comments, satisfaction,
canned replies and a knowledge base. Requires only `identity` (assignee lookups; users stored as id + name snapshots).

## Data
- `categories` (`code`, `sla_response_hours`, `sla_resolve_hours`, default assignee snapshot, `active`)
- `tickets` (`TK-2569-0001`, channel `web | phone | line | email | walk_in`, priority `low | normal | high | urgent`,
  status `open → in_progress → waiting → resolved → closed`, `response_due_at`, `due_at`, `first_response_at`, `resolution`,
  `satisfaction` 1–5, `feedback`, `reopen_count`, `created_by` = requester user)
- `ticket_comments` (`internal` note or public reply, author snapshot) · `canned_replies` · `kb_articles` (`published`, `views`)

## Behaviour
- SLA: due times = created + category hours (no category: 4 h response / 24 h resolve); `urgent` halves both.
  Editing category/priority (`PUT`) recomputes from creation; reopening starts a new resolve deadline from now.
- Computed on every read: `overdue` (active and past `due_at`), `response_overdue` (no response yet and past `response_due_at`),
  `priority_label`, `channel_label`.
- Category default technician is assigned on create. Only `helpdesk.ticket.work` users may choose an assignee.
- First response = `start`, a public reply by a technician, or resolve.
- Requesters (`helpdesk.ticket.create` only) see just their own tickets and never internal notes; their public reply on a
  `waiting` ticket moves it back to `in_progress`.
- `resolve` needs a resolution; `close` (requester or technician) only from `resolved`; `reopen` only from `resolved`.
  Disallowed transitions return 409; comments on closed tickets 409.
- KB: readers see published articles only (`GET /articles/:id` of a draft = 404 for them); reading counts a view.

## API
- `GET/POST /categories` · `GET/PUT /categories/:id`
- `POST /tickets` · `GET /tickets` (`?q,status,priority,channel,categoryId,assigneeId,unassigned,overdue,active`) · `GET /tickets/mine` (technician queue)
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
- subscribes: none. Candidate (not added): `helpdesk.ticket_overdue` (needs a timer).

## Screens
`src/ui.ts`: ticketNew, myRequests, myTickets, tickets, overdueTickets, ticket (+ticketEdit, printable), articles (cards)/article/articleNew/articleEdit,
cannedReplies/cannedNew/cannedEdit, categories/categoryNew/categoryEdit. Widgets: KPI, status pipeline, monthly trend.
⌘K: `แจ้งปัญหา <เรื่อง>`, `งานค้างของฉัน`, `วิธีแก้ <คำค้น>`, `เกิน SLA`; search tickets and articles. Mobile: report, my requests, technician queue and all ticket actions.

## Extension ideas
Photo attachments (URLs), business-hours SLA calendar, auto-close resolved tickets after N days, link tickets to machines when Maintenance is installed (via events).
