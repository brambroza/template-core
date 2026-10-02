# automation — Automation & Alerts (ระบบอัตโนมัติ) · feature

No-code rules ("เมื่อ… ถ้า… ให้…"): when an event happens in any installed module, check conditions and
notify in the app, push to LINE, or call a webhook. Requires only `identity`; every partner module is optional
(`enhancedBy`) — a rule for an event nobody publishes simply never fires.

## Data
- `rules` — `event_type`, `conditions` (jsonb `[{ field, op, value }]`, all must match), `actions` (jsonb `[{ type: notify|line|webhook, target?, message?, to? }]`), `enabled`, `template_id`, `fire_count`, `last_fired_at`
- `runs` — one row per rule per event: `done | failed | skipped` + detail (what was sent, or why not)
- `notifications` — the bell: `level (info|warn|stop|ok)`, `title`, `body`, `link` (in-app path), `recipient_user_id` (null = broadcast), `read_at` (personal ones; also legacy broadcast reads)
- `notification_reads` — per-user read state of broadcast notifications (`notification_id`, `user_id`, `read_at`)
- `line_settings` — one row per tenant: `webhook_secret` (second half of the webhook key) · `line_links` — ERP `user_id` ↔ `line_user_id` (+ names), unique both ways per tenant
- `line_link_codes` — 6-digit one-time codes (10 min, single use, `used_at`, `line_user_id`) · `line_link_attempts` — wrong codes per LINE account (5 per 15 min) and per company (30 per 15 min, security review 0.3 SEC-09)

## Behaviour
- `src/catalog.ts` is the single list of events a rule can react to (Thai label, usable fields, default
  message, link, level) and of the 26 one-click templates (8 factory + 14 office/service + 4 wave 5). **New event → add it to `@erp/contracts`, to
  `module.json` `subscribes`, and to `EVENTS` here.**
- Handlers never throw: every outcome is a `runs` row. LINE/webhook failures are recorded as `failed`.
- **Webhook SSRF guard** (SEC-06): `webhookProblem` (on save) refuses non-https, credentials in the URL, single-label hosts, private /
  loopback / link-local / CGNAT / IPv4-mapped IPv6 literals; `sendWebhook` also resolves the host and refuses if ANY address is internal
  (`resolvesPrivate`). `AUTOMATION_ALLOW_PRIVATE_WEBHOOKS=1` (tests, on-prem integrations) turns both off. DNS rebinding between the check
  and the request is not covered — use an egress firewall for the automation container.
- **Recipients** (notify only): `to` = `'all'` (default — everyone with `automation.notify.read`), `'field:<a>[,<b>]'` (user ids carried by the event; only keys listed in
  the event's `userFields` are accepted, 400 otherwise) or `'user:<uuid>'` (one person; the simple form's `toUserId`). One row per distinct user.
  An event without the user id(s) creates **no** notification (never falls back to everyone); the run says "ไม่ได้แจ้งในแอป: เหตุการณ์ไม่มีผู้รับ".
  Rules applied from a template whose notify action has no stored `to` follow the template's current `to` (`effectiveActions`) — old installs stop broadcasting personal news.
- `GET /notifications` returns mine + broadcast (`personal` flag); `read_at` and `unread` are the caller's own. Read / read-all mark only what the caller can see
  (personal: `read_at`; broadcast: a `notification_reads` row). Someone else's personal notification → 404.
- **Give `automation.notify.read` to every role** (e.g. the self-service staff role) so everyone has the bell: it only ever shows broadcast alerts and alerts addressed to that user.
- Messages: `{{field:th}}` renders enum codes in Thai (approved → อนุมัติแล้ว, urgent → ด่วนมาก …).
- Messages use `{{field}}` placeholders (numbers formatted th-TH). Links are path-encoded (`renderLink`).
- LINE: env `LINE_CHANNEL_ACCESS_TOKEN` (Messaging API push; `target` = user/group id). Without it LINE actions record `failed`.
- **LINE to the person** (`src/line.ts`): a `line` action with `to` (`field:…` / `user:…`, same rules as notify; `'all'` and `to`+`target` together are refused)
  pushes to each recipient's linked LINE. Not linked → no push, the run says "ผู้รับยังไม่ได้ผูก LINE n คน" (status stays `done`); a failed push → `failed`.
  `PUBLIC_APP_URL` set → the push ends with "เปิดดู: <app><link>". The 7 personal templates (approval-to-approver, approval-approved/not-approved,
  leave-to-manager, leave-decided-to-employee, expense-paid-to-claimant, ticket-resolved-to-requester) add a personal LINE action next to the in-app one;
  rules applied from those templates earlier get it through `effectiveActions` (only people who linked their own LINE receive anything).
- **Linking**: `POST /line/link-code` (anyone with `automation.notify.read`) → 6-digit code; the user sends "ผูกบัญชี 123456" (Thai digits ok) to the OA.
  Newest link wins (one LINE per user, one user per LINE). LINE re-delivery of the same message answers OK again. `unfollow` (blocked the OA) unlinks.
- **Webhook** `POST /line/webhook/:key` — public, raw body (own content-type parser in an encapsulated context), `x-line-signature` =
  base64 HMAC-SHA256(`LINE_CHANNEL_SECRET`, raw bytes), constant-time. No secret configured → 503; bad/missing signature → 401; unknown key → 404;
  otherwise always 200 (each event handled in its own tenant transaction, errors logged; replies sent after commit).
  Key = tenant id (32 hex) + `line_settings.webhook_secret` (32 hex): the tenant comes from the key and the secret is compared inside that tenant's
  RLS transaction — no global lookup table (verify forbids tables without RLS). The gateway forwards `/api/automation/line/webhook/:key` byte for byte.
- **LINE commands** (1:1 chat, linked users): `แจ้งเตือน` (last 5 personal notifications), `ยกเลิกผูกบัญชี`, `ช่วยเหลือ`; in groups only `ไอดีกลุ่ม`
  (and the bot posts the group id when it joins). Unknown text gets **no** reply — the OA may also be used for human chat.
- Env for LINE: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_OA_ID` (add-friend link/QR), `PUBLIC_BASE_URL` (public https of the gateway → webhook URL;
  else built from `x-forwarded-host/proto` the gateway forwards), `PUBLIC_APP_URL`, `LINE_API_URL` (tests). One LINE channel per installation (env), not per tenant.
- Webhook: https only; private/loopback hosts refused unless `AUTOMATION_ALLOW_PRIVATE_WEBHOOKS=1`; 5 s timeout;
  no redirects; body signed with `x-erp-signature: sha256=<hmac>` when `WEBHOOK_SECRET` is set.

## API
- `GET /event-types` · `GET /templates` · `POST /templates/:id/apply { target? }`
- `GET /rules` · `POST /rules` (full JSON) · `POST /rules/simple` (flat form fields) · `GET /rules/:id` (+ last 20 runs)
- `POST /rules/:id/enable | disable` · `DELETE /rules/:id` · `POST /rules/:id/test { data? }` (dry run, no side effects; returns `preview`)
- `POST /rules/simple` also takes `to` / `toUserId` · rules and templates carry `recipients` (Thai wording of `to`), templates `module_label` (Thai)
- `GET /runs` · `GET /notifications?unread=1` → `{ unread, items }` (mine + broadcast) · `POST /notifications/:id/read` · `POST /notifications/read-all`
- `GET /summary` → `{ activeRules, firedToday, failedToday, unread }` (`unread` = the caller's)
- LINE: `GET /line/settings` (creates the webhook key on first view; shows what is configured, never the secrets) · `POST /line/settings/rotate` · `GET /line/links` · `DELETE /line/links/:id` (perm `automation.line.manage`)
  · `GET /line/me` · `POST /line/link-code` · `POST /line/unlink` · `POST /line/test` (push a test to my LINE) (perm `automation.notify.read`) · `POST /line/webhook/:key` (public, LINE only)
- perms: `automation.rule.read`, `automation.rule.write`, `automation.notify.read`, `automation.line.manage`

## Events
- publishes: none · subscribes: see `module.json` — factory: stock low, PO created/approved/received, SO confirmed/delivered/invoiced, production completed, breakdown, work completed;
  office/service: `approvals.request_submitted|request_decided`, `expense.claim_submitted|claim_paid`, `hr.leave_requested|leave_decided`,
  `helpdesk.ticket_created|ticket_resolved`, `crm.lead_created|quotation_accepted`, `quality.inspection_completed|ncr_raised`, `booking.requested`, `assets.repair_reported`,
  `sales.payment_received`; wave 5: `contracts.visit_due` (userField `technicianId`), `contracts.contract_expiring`, `payroll.run_paid`, `hr.employee_upserted` (userField `userId`, no template).
  Every publisher is optional (`enhancedBy`). Links go to each module's detail screen (`/m/<module>/<detailScreen>/{{id}}`).
- Enum fields (decision, priority, result, severity, source, stage) carry English codes — conditions compare them (`priority eq urgent`);
  templates write the Thai wording into their own message. Boolean fields (`overLimit`, `needsApproval`) compare as `eq true`.
- Office templates (22 templates before wave 5): approval-to-approver (→ `field:nextApproverId,delegateId`), approval-approved / approval-not-approved (→ `field:requesterId`),
  expense-over-limit, expense-paid-to-claimant (→ `field:claimantId`), leave-to-manager (→ `field:approverUserId`), leave-decided-to-employee (→ `field:employeeUserId`),
  urgent-ticket, ticket-resolved-to-requester (→ `field:requesterUserId`), new-lead, quote-accepted, qc-fail, ncr-critical, booking-needs-approval.
  Wave 5 (26 in total): pm-visit-to-technician (→ `field:technicianId`, in-app + personal LINE), contract-expiring-to-sales (broadcast + LINE group),
  payment-received ("ลูกค้าชำระเงินแล้ว แจ้งเซลส์/บัญชี", broadcast), payroll-paid ("จ่ายเงินเดือนแล้ว", broadcast — company totals only; no per-role recipients yet).
  `test/service.test.ts` checks that catalogue = `subscribes`, every template condition / recipient field exists (recipients also in the contract), and each sample payload parses against `@erp/contracts`.

## Screens (src/ui.ts)
templates (card gallery, one-click "เปิดใช้") · rules · ruleNew (เมื่อ/ถ้า/ให้ form) · rule (detail + runs, test, enable/disable, delete)
· notifications · runs · lineMe (ผูก LINE ของฉัน: code, QR to add the OA, test/unlink; mobile) · lineSetup (webhook URL, config status, test, rotate) · lineLinks (admin unlink). Declares the bell (`notifications`), a dashboard feed widget and a KPI widget, and ⌘K commands.

## Extension ideas
E-mail action, quiet hours, per-role recipients (needs role membership from identity), per-tenant LINE channels (secret/token in `line_settings`, encrypted), digest ("สรุปเช้านี้ 8 โมง"), rules on time (PM due tomorrow).

## Adding LINE commands for other modules (later, via events — never by reading their databases)
Today any module reaches a person on LINE without code here: publish an event carrying the user id (declare it in `userFields`) and
use a template/rule with a personal `line` action. For two-way commands ("สถานะ", "งานของฉัน"):
1. contracts: `automation.line_command { userId, command, args, lineCommandId }` (published by automation when a linked user types a word
   registered by an installed module) and `<module>.line_answer { userId, text, lineCommandId }`.
2. the module subscribes to `automation.line_command`, answers from its own data, publishes `<module>.line_answer`;
   automation subscribes to the answers and **pushes** the text to that user's LINE (reply tokens expire in ~1 minute; events are async).
3. which words exist: each module lists them in `module.json` (e.g. `lineCommands: [{ word: 'สถานะ', label: '…' }]`) and the gateway catalogue
   tells automation which are installed, so `ช่วยเหลือ` lists only what the customer bought.
