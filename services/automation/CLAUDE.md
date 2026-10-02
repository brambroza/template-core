# automation — Automation & Alerts (ระบบอัตโนมัติ) · feature

No-code rules ("เมื่อ… ถ้า… ให้…"): when an event happens in any installed module, check conditions and
notify in the app, push to LINE, or call a webhook. Requires only `identity`; every partner module is optional
(`enhancedBy`) — a rule for an event nobody publishes simply never fires.

## Data
- `rules` — `event_type`, `conditions` (jsonb `[{ field, op, value }]`, all must match), `actions` (jsonb `[{ type: notify|line|webhook, target?, message? }]`), `enabled`, `template_id`, `fire_count`, `last_fired_at`
- `runs` — one row per rule per event: `done | failed | skipped` + detail (what was sent, or why not)
- `notifications` — the bell: `level (info|warn|stop|ok)`, `title`, `body`, `link` (in-app path), `read_at`

## Behaviour
- `src/catalog.ts` is the single list of events a rule can react to (Thai label, usable fields, default
  message, link, level) and of the 19 one-click templates (8 factory + 11 office/service). **New event → add it to `@erp/contracts`, to
  `module.json` `subscribes`, and to `EVENTS` here.**
- Handlers never throw: every outcome is a `runs` row. LINE/webhook failures are recorded as `failed`.
- Messages use `{{field}}` placeholders (numbers formatted th-TH). Links are path-encoded (`renderLink`).
- LINE: env `LINE_CHANNEL_ACCESS_TOKEN` (Messaging API push; `target` = user/group id). Without it LINE actions record `failed`.
- Webhook: https only; private/loopback hosts refused unless `AUTOMATION_ALLOW_PRIVATE_WEBHOOKS=1`; 5 s timeout;
  no redirects; body signed with `x-erp-signature: sha256=<hmac>` when `WEBHOOK_SECRET` is set.

## API
- `GET /event-types` · `GET /templates` · `POST /templates/:id/apply { target? }`
- `GET /rules` · `POST /rules` (full JSON) · `POST /rules/simple` (flat form fields) · `GET /rules/:id` (+ last 20 runs)
- `POST /rules/:id/enable | disable` · `DELETE /rules/:id` · `POST /rules/:id/test { data? }` (dry run, no side effects; returns `preview`)
- `GET /runs` · `GET /notifications?unread=1` → `{ unread, items }` · `POST /notifications/:id/read` · `POST /notifications/read-all`
- `GET /summary` → `{ activeRules, firedToday, failedToday, unread }`
- perms: `automation.rule.read`, `automation.rule.write`, `automation.notify.read`

## Events
- publishes: none · subscribes: see `module.json` — factory: stock low, PO created/approved/received, SO confirmed/delivered/invoiced, production completed, breakdown, work completed;
  office/service: `approvals.request_submitted|request_decided`, `expense.claim_submitted|claim_paid`, `hr.leave_requested|leave_decided`,
  `helpdesk.ticket_created|ticket_resolved`, `crm.lead_created|quotation_accepted`, `quality.inspection_completed|ncr_raised`, `booking.requested`, `assets.repair_reported`.
  Every publisher is optional (`enhancedBy`). Links go to each module's detail screen (`/m/<module>/<detailScreen>/{{id}}`).
- Enum fields (decision, priority, result, severity, source, stage) carry English codes — conditions compare them (`priority eq urgent`);
  templates write the Thai wording into their own message. Boolean fields (`overLimit`, `needsApproval`) compare as `eq true`.
- Office templates: approval-to-approver, approval-approved, approval-not-approved, expense-over-limit, leave-to-manager, urgent-ticket,
  new-lead, quote-accepted, qc-fail, ncr-critical, booking-needs-approval. `test/service.test.ts` checks that catalogue = `subscribes`,
  every template condition field exists, and each sample payload parses against `@erp/contracts`.

## Screens (src/ui.ts)
templates (card gallery, one-click "เปิดใช้") · rules · ruleNew (เมื่อ/ถ้า/ให้ form) · rule (detail + runs, test, enable/disable, delete)
· notifications · runs. Declares the bell (`notifications`), a dashboard feed widget and a KPI widget, and ⌘K commands.

## Extension ideas
E-mail action, quiet hours, per-role recipients, digest ("สรุปเช้านี้ 8 โมง"), rules on time (PM due tomorrow).
