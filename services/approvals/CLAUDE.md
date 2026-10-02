# approvals — e-Approval (อนุมัติออนไลน์) · feature

Online approval / e-Memo for any organisation. Staff raise a request (ขอซื้อ, ขอเดินทาง, ขอใช้งบ, บันทึกข้อความ…),
it travels approver by approver along a chain, each approver decides on web or phone, and every step is kept in an audit trail.
Requires only `identity` (approvers are picked from `/users` and stored as snapshots).

## Data
- `request_types` — `code`, `name`, `description`, `amount_note` (guidance text), `approvers` jsonb `[{ userId, userName }]` (default chain, ordered), `lock_approvers` (default true), `active`
- `requests` — `APV-2569-0001`, type snapshot (`type_code`, `type_name`), `title`, `detail`, `amount?`, `needed_by?`, requester (`requester_id` = token user, `requester_name`, `department`),
  `status` `draft → pending → approved | rejected | cancelled`, plus `returned` (sent back for edit, can be resubmitted), `current_step` (1-based while pending, else 0), `step_count`, `last_note`, `submitted_at`, `decided_at`, `decided_by`
- `request_steps` — one row per approver: `step_no`, `approver_id`, `approver_name`, `status waiting | approved | rejected | returned`, `acted_by`, `acted_by_name`, `on_behalf_of_name` (set when a delegate/admin acted for the approver), `acted_at`, `note`
- `request_history` — every action: `actor_id`, `actor_name`, `action` (created, edited, approvers_changed, submitted, approved, rejected, returned, cancelled, commented), `step_no`, `note`, `on_behalf_of_id/name`
- `delegations` — `from_user_id/name` (the approver) → `to_user_id/name` (stands in), `starts_on`..`ends_on` (Bangkok calendar dates, inclusive), `note`, `cancelled_at`

## Behaviour
- Today (delegations in force, "ended" checks) = SQL `TODAY_SQL` from the kernel: the kernel clock's Thai day (`app.today`, set by `db.tx`; follows `setClock` in tests — wave 8).
- **Requester name comes from the token** (`auth(req).userName`): on create, and on edit by the requester themself, a typed `requesterName` is ignored.
  Only tokens without a name (old sessions) fall back to the body; an approvals admin editing someone else's request may set it.
- Steps are copied from the type when the request is created. **`lock_approvers` (default true)**: requesters cannot pick approvers on create (403 unless the list equals
  the type's chain) nor `PUT /requests/:id/approvers` (403); approvals admins can. Unlocked types: `approvers` in the body overrides the chain (an empty list = the type's chain).
- **Delegation**: an approver (perm `approve`) hands their approvals to another user for a date range (`POST /delegations`); admins may create one for any approver
  (`fromUserId`). One delegation per approver per period (overlap → 409), not to oneself (400), end date not in the past (400). While in force the delegate sees the
  request (and keeps seeing requests they acted on), finds it in `/inbox` (`acting_for_name`), may approve / reject / return the step, and the step + history
  record `acted_by_name` and "แทน <approver>" (`action_label` `อนุมัติ (แทน …)`). Admins acting on someone's step are recorded the same way. The approver keeps their own rights.
  Delegations are not transitive. Cancel: the approver who gave it or an admin.
- Submit (requester or admin) needs ≥1 step (400 otherwise); it resets all steps to `waiting` and sets `current_step = 1`. Resubmitting a returned request restarts at step 1.
- Approve / reject / return act on the current step only, by **that step's approver** or a user with `approvals.request.admin` (403 otherwise). Nobody approves their own request — not even an admin (403, `can_act` false). Reject and return need a `note` (400).
  Approving the last step → `approved`; reject → `rejected`; return → `returned` (requester edits / changes approvers / resubmits).
- Cancel: requester or admin while `draft | pending | returned`. Comment: anyone who can see the request, any status.
- Wrong status → 409. Visibility: a user sees requests they raised or are on the chain of; `approvals.request.admin` sees all. Invisible → 404.
- Detail responses carry viewer flags for the UI: `can_act`, `can_edit`, `can_change_approvers`, `can_submit`, `can_cancel`, `is_requester`, `lock_approvers`, `acting_for_name`, plus `step_text`,
  `current_approver_name`, `current_delegate_name`, `steps[].status_label`, `steps[].acted_by_label`, `history[].action_label` (Thai).
- `actor_name` in history = the token's name; for old tokens it falls back to the step snapshot (approver) or `requester_name`.

## API
- `GET/POST /types` (`?q`, `?active=true`) · `GET/PUT/DELETE /types/:id` (DELETE → 409 when used) · `PUT /types/:id/approvers { approvers }`
- `POST /requests { typeId, title, detail?, amount?, neededBy?, department?, approvers? (unlocked types only), submit? }` (`requesterName` only used for nameless tokens)
- `GET /requests` (`?q`, `?status`, `?typeId`, `?mine=1`, `limit` 200) · `GET /my-requests` · `GET /inbox` (pending, waiting for me)
- `GET /requests/:id` · `PUT /requests/:id` (draft/returned) · `PUT /requests/:id/approvers`
- `POST /requests/:id/submit | approve {note?} | reject {note} | return {note} | cancel {note?} | comment {note}`
- `GET /delegations` (`?status=active|scheduled|ended|cancelled`; mine given/received, admins all) · `POST /delegations { toUserId, toUserName?, startsOn, endsOn, note?, fromUserId?/fromUserName? (admin) }` · `POST /delegations/:id/cancel`
- `GET /summary` → `waitingForMe, pendingTotal, returnedTotal, approvedThisMonth, rejectedThisMonth, approvedAmountThisMonth, avgHoursToDecide, months[{month, submitted, approved, rejected, approved_amount}], rows[]`

Permissions: `approvals.request.read | write | approve | admin`, `approvals.type.write`.

## Events
- publishes `approvals.request_submitted` (requestId, no, title, typeName, requesterName, amount, nextApproverId/Name, step, stepCount, requesterId, delegateId?/delegateName? when the approver has delegated today) — on submit (step 1)
  **and** each time an approval moves the request to the next step, so the next approver can be alerted.
- publishes `approvals.request_decided` (requestId, no, title, decision approved|rejected|returned, requesterId, requesterName, byName, note) — final approve, reject or return.
- subscribes: none. Automation turns both into LINE / in-app alerts addressed to the person (`to: field:nextApproverId,delegateId` / `field:requesterId`; link `/m/approvals/requestDetail/:id`).

## Screens
`src/ui.ts`: inbox (mobile, row action อนุมัติ, "อนุมัติแทน" column), myRequests (mobile), requests (all, filters), requestNew (mobile; no name/approver inputs — both come from the login and the type),
requestEdit, requestDetail (flow, steps with "ดำเนินการโดย" + history lines, actions by viewer flag, "เปลี่ยนผู้อนุมัติ" only when `can_change_approvers`, printable),
delegations / delegationNew (มอบอำนาจอนุมัติแทน, mobile), types / typeNew / typeEdit / typeDetail (set chain, lock).
Widgets: kpi, pipeline (`rows`), trend (`months`). ⌘K: `ขออนุมัติ <เรื่อง>`, `รออนุมัติ`, `คำขอของฉัน`. Search: requests.

## Extension ideas
Amount-based routing (skip/add steps above a threshold), "requester's manager" steps (needs the manager's user id in the request — hr owns the org chart), parallel approvers, attachments (store URLs), SLA reminders via Automation.
