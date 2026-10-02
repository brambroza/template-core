# approvals — e-Approval (อนุมัติออนไลน์) · feature

Online approval / e-Memo for any organisation. Staff raise a request (ขอซื้อ, ขอเดินทาง, ขอใช้งบ, บันทึกข้อความ…),
it travels approver by approver along a chain, each approver decides on web or phone, and every step is kept in an audit trail.
Requires only `identity` (approvers are picked from `/users` and stored as snapshots).

## Data
- `request_types` — `code`, `name`, `description`, `amount_note` (guidance text), `approvers` jsonb `[{ userId, userName }]` (default chain, ordered), `active`
- `requests` — `APV-2569-0001`, type snapshot (`type_code`, `type_name`), `title`, `detail`, `amount?`, `needed_by?`, requester (`requester_id` = token user, `requester_name`, `department`),
  `status` `draft → pending → approved | rejected | cancelled`, plus `returned` (sent back for edit, can be resubmitted), `current_step` (1-based while pending, else 0), `step_count`, `last_note`, `submitted_at`, `decided_at`, `decided_by`
- `request_steps` — one row per approver: `step_no`, `approver_id`, `approver_name`, `status waiting | approved | rejected | returned`, `acted_by`, `acted_at`, `note`
- `request_history` — every action: `actor_id`, `actor_name`, `action` (created, edited, approvers_changed, submitted, approved, rejected, returned, cancelled, commented), `step_no`, `note`

## Behaviour
- Steps are copied from the type when the request is created; `approvers` in the body overrides them (an empty list = use the type's chain).
- Submit (requester or admin) needs ≥1 step (400 otherwise); it resets all steps to `waiting` and sets `current_step = 1`. Resubmitting a returned request restarts at step 1.
- Approve / reject / return act on the current step only, by **that step's approver** or a user with `approvals.request.admin` (403 otherwise). Reject and return need a `note` (400).
  Approving the last step → `approved`; reject → `rejected`; return → `returned` (requester edits / changes approvers / resubmits).
- Cancel: requester or admin while `draft | pending | returned`. Comment: anyone who can see the request, any status.
- Wrong status → 409. Visibility: a user sees requests they raised or are on the chain of; `approvals.request.admin` sees all. Invisible → 404.
- Detail responses carry viewer flags for the UI: `can_act`, `can_edit`, `can_submit`, `can_cancel`, `is_requester`, plus `step_text`, `current_approver_name`, `steps[].status_label`, `history[].action_label` (Thai).
- Tokens carry no names, so `actor_name` in history comes from the step snapshot (approver) or `requester_name`.

## API
- `GET/POST /types` (`?q`, `?active=true`) · `GET/PUT/DELETE /types/:id` (DELETE → 409 when used) · `PUT /types/:id/approvers { approvers }`
- `POST /requests { typeId, title, detail?, amount?, neededBy?, requesterName?, department?, approvers?, submit? }`
- `GET /requests` (`?q`, `?status`, `?typeId`, `?mine=1`, `limit` 200) · `GET /my-requests` · `GET /inbox` (pending, waiting for me)
- `GET /requests/:id` · `PUT /requests/:id` (draft/returned) · `PUT /requests/:id/approvers`
- `POST /requests/:id/submit | approve {note?} | reject {note} | return {note} | cancel {note?} | comment {note}`
- `GET /summary` → `waitingForMe, pendingTotal, returnedTotal, approvedThisMonth, rejectedThisMonth, approvedAmountThisMonth, avgHoursToDecide, months[{month, submitted, approved, rejected, approved_amount}], rows[]`

Permissions: `approvals.request.read | write | approve | admin`, `approvals.type.write`.

## Events
- publishes `approvals.request_submitted` (requestId, no, title, typeName, requesterName, amount, nextApproverId/Name, step, stepCount) — on submit (step 1)
  **and** each time an approval moves the request to the next step, so the next approver can be alerted.
- publishes `approvals.request_decided` (requestId, no, title, decision approved|rejected|returned, requesterId, requesterName, byName, note) — final approve, reject or return.
- subscribes: none. Automation turns both into LINE / in-app alerts (link `/m/approvals/requestDetail/:id`).

## Screens
`src/ui.ts`: inbox (mobile, row action อนุมัติ), myRequests (mobile), requests (all, filters), requestNew (mobile, approver lines from identity /users),
requestEdit, requestDetail (flow, steps + history lines, actions by viewer flag, printable), types / typeNew / typeEdit / typeDetail (set chain).
Widgets: kpi, pipeline (`rows`), trend (`months`). ⌘K: `ขออนุมัติ <เรื่อง>`, `รออนุมัติ`, `คำขอของฉัน`. Search: requests.

## Extension ideas
Amount-based routing (skip/add steps above a threshold), delegation while on leave, parallel approvers, attachments (store URLs), SLA reminders via Automation.
