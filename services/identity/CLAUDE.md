# identity — Identity & Access (ผู้ใช้และสิทธิ์) · core

Companies (tenants), users, roles, login. Issues the JWT every module trusts (`tid` = tenant, `perms` = union of role permissions).

## Events
- publishes `identity.tokens_revoked` (every module's kernel handles it; nobody lists it in `subscribes`)

## Data
- `tenants` (global, no RLS — login looks it up before a tenant context exists)
- `users.email` is unique across ALL companies (migration 003, index `users_email_global`). Policy `login_lookup` (SELECT only, on while a transaction sets `app.login_lookup = 'on'`) lets login and the e-mail-taken check read users of every company; nothing else sets it.
- `users`, `roles` (`permissions text[]`), `user_roles` — tenant tables
- `company_profiles` (one row per tenant, `tenant_id` is the key) — seller details printed on every document
- Global tables of migration 005 (`-- @global`, used before anyone is signed in; tokens kept as SHA-256 only): `signups` (pending sign-up,
  24 h; migration 010: `token_hash` = hash of the browser's ticket, `code_hash` = HMAC of the 6-digit code, `code_expires_at`,
  `code_attempts`, `account_exists`), `password_resets` (one-time, 60 min), `auth_attempts` (throttle rows: key + time).
- `tenant_subscriptions` (migration 004, one row per cloud company; none = no plan limit, e.g. self-hosted) — `plan starter|factory|business`,
  `status trial|active|suspended|cancelled`, `trial_ends_at`, `paid_through` (Bangkok day), overrides `modules`, `max_users`, `note`.
  `tenant_subscription_log` — every change with `by_name`. Policy `ops_read` (SELECT, on while `app.ops_read = 'on'`) only for `/_ops` lists.
  Plans (modules, user limit, price), TRIAL_DAYS 14 and GRACE_DAYS 7 are in `src/plans.ts`.

## API
- `POST /tenants` (internal token) — provision company + Administrator role (`*`) + first admin; `plan?` starts a 14-day trial of it
- **Cloud plans:** login refuses a closed company (trial over, `paid_through` + 7 days passed, suspended, cancelled) with 402
  `subscription_inactive` + Thai reason; otherwise the token carries the plan's modules (claim `mods`, the kernel refuses other feature
  modules) and never outlives access (`tokenTtl`). Login and `/me` return `subscription` (plan, status, daysLeft, modules, maxUsers, blocked).
  `POST /users` → 409 `user_limit` when the plan's active users are all taken. `GET /subscription` (any signed-in user) → `subscription`,
  `usedUsers`, `plans` + flat fields for the "แพ็กเกจของบริษัท" screen.
- **Self-serve sign-up by 6-digit code (public):** `GET /plans` (plans + Thai module names + trial days) · `POST /signup { companyName,
  name, email, password, plan? = factory, captchaToken? }` → 202 `{ ticket, email, codeMinutes, resendSeconds, message }` and a mail with a
  6-digit code (no link). The browser keeps the ticket; the code only counts together with it. Same work and the same answer whether or
  not the e-mail has an account: a taken e-mail also gets a ticket and a row (`account_exists`, nothing typed is kept, its code is told to
  nobody) but its mail points to "ลืมรหัสผ่าน". 5/h per IP, 3/h per e-mail.
  `POST /signup/verify { ticket, code }` → creates company (code from the e-mail domain, `-2`… when taken, random for free mail), first
  admin and the trial, and answers like a login (201). Every failure answers the same 400 `code_invalid` (wrong code, older than
  `SIGNUP_CODE_MINUTES` = 10, `SIGNUP_CODE_MAX_TRIES` = 5 wrong tries, unknown ticket, taken e-mail); 20 failures per IP per 15 min → 429.
  `POST /signup/resend { ticket }` → 202 and a new code (the old one dies, tries start again): one per 60 s (429 `too_soon`), 3/h per
  sign-up, 10/h per IP; unknown ticket → same answer, nothing sent. Never tell "expired" from "wrong" or count tries in the answer —
  that would tell a taken e-mail from a new one.
- `GET /captcha` (public) → `{ provider: 'turnstile' | null, siteKey }` — the web app's Turnstile widget reads its site key here.
- **Password reset (public):** `POST /auth/forgot { email, captchaToken? }` → 202 same answer always; an active user gets
  `<APP_URL>/reset-password?token=…` (60 min, once). 3/h per e-mail, 10/h per IP. `POST /auth/reset { token, newPassword }` → new password,
  other links of the user die, every session is revoked (`password_changed`), the login throttle for that e-mail + IP is cleared.
- **Settings:** `APP_URL` (public web address for mail links — required in production; elsewhere the forwarded host is used), `EMAIL_PROVIDER`
  `resend|sendgrid|log` (default: resend when `RESEND_API_KEY` is set, else log = print + keep in `sentMail`), `EMAIL_FROM`, `RESEND_API_KEY`,
  `SENDGRID_API_KEY`, `TURNSTILE_SECRET` + `TURNSTILE_SITE_KEY` (Cloudflare Turnstile on sign-up and forgot: set both; no secret = no
  check, no site key = no widget unless the web app was built with `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; a half-set pair is warned about in the
  log at start). Mail failure → 503 `mail_failed`.
- **Back office for GO Along staff (signed in):** the operator company is `OPS_TENANT_CODE`; its staff hold `identity.ops.read` /
  `identity.ops.write` **by name** — `<module>.ops.*` is never granted by `*` or `identity.*` (kernel `isExplicitPerm`, ui-schema `hasPerm`,
  `canGrant`), and `requireOps` also refuses any other company. `GET /ops/tenants?q=` (flat list) · `GET /ops/tenants/:code` (plan, company
  profile for the invoice, users, owner, `payments[]`, `log[]`) · `POST /ops/tenants/:code/payments { months, paidOn?, amount?, plan?, ref?, note? }`
  (bank transfer: `tenant_payments` row (migration 006), status active, `paid_through` = end of `paymentPeriod` — continues the paid period or
  starts today when lapsed; publishes `identity.subscription_paid` in the operator company → its sales drafts the tax-invoice order) ·
  `POST /ops/tenants/:code/plan { plan?, status?, trialDays?, maxUsers?, note }` (reason required). Screens: "หลังบ้าน: บริษัทลูกค้า".
  Bootstrap: `POST /_ops/operators { email }` (internal; `pnpm erp plan grant-ops <email>`) gives a user of the operator company the role
  "หลังบ้าน GO Along".
- **Back office (internal token):** `GET /_ops/tenants?q=` (every company + plan + active users), `PUT /_ops/tenants/:code/subscription
  { by, plan?, status?, paidThrough?, trialDays?, modules?, maxUsers?, note? }` (bank transfer confirmed → `status: active, paidThrough`;
  creates the row when missing — `plan` then required; access changes revoke every user's tokens, reason `plan_changed`),
  `GET /_ops/tenants/:code/subscription-log`. CLI: `pnpm erp plan list | set <code> … | log <code>`.
- `POST /auth/login` (public) `{ email, password, tenant? }` → `{ token, tenant, permissions, … }` — the company comes from the e-mail. `tenant` (company code) is optional; only e-mails that two companies shared before 003 need it: the password picks the account, several fit → 409 `tenant_required` (web/mobile then show the รหัสบริษัท field)
- `POST /tenants` and `POST /users` answer 409 `email_taken` when any company already has the e-mail (checked before the company row is created)
- `GET /company` (any signed-in user) — letterhead/seller details: `legal_name, name_en, branch_code, branch_label` (as typed, may be null), `branch_text` (what to print), `address, tax_id, tax_id_text` (0-0000-00000-00-0), phone, email, website, logo, footer_note, signature_labels, configured`, plus the company's **number format** `number_comma` (boolean), `money_decimals`, `qty_decimals` (0–4; migration 009, defaults `true / 2 / 2`) — web and mobile read it from this answer and write every amount and quantity that way (`packages/ui-schema/src/number.ts`). Before setup it answers `configured: false` with the tenant name, empty fields and the default number format.
- `PUT /company` (`identity.company.write`) — full replace (missing optional fields become null). `taxId` must pass the 13-digit check (`isValidThaiTaxId`, dashes/spaces stripped), `branchCode` 5 digits (`00000` = สำนักงานใหญ่; `branch_text` = `branchLabel` or "สำนักงานใหญ่" / "สาขาที่ 0000x"), `logo` = base64 data URL of PNG/JPEG/SVG ≤ 300 KB whose bytes match the type, `signatureLabels` = array or comma-separated text (≤ 6). `numberComma` (boolean), `moneyDecimals`, `qtyDecimals` (integers 0–4, text from the form's select is accepted) are the exception to "full replace": **left out = kept as they are**, so the setup wizard and older apps that do not know them never reset the company's number format.
- `GET /users/directory?q=` (any signed-in user) — active users' `id, name, email` for people pickers (delegate, technician, assignee…); `/users` stays admin (`identity.user.read`)
- `GET /me` · `GET/POST /users` · `GET /users/:id` (`identity.user.read`; + `roles`, `roleIds`, `permissions`, `sessions_revoked_at`, `sessions_revoked_reason` in Thai)
  · `PUT /users/:id/roles` · `POST /users/:id/deactivate` · `GET/POST /roles`
- `POST /logout` (any signed-in user) — log out **everywhere**: revokes every token of this user issued up to now → `{ ok, revokedBefore, message }`.
- `POST /me/password { currentPassword, newPassword }` (any signed-in user) — wrong current → 400 with `fieldErrors.currentPassword` (never 401: the
  apps would log the user out; counted by the same 10/15-min throttle → 429), new ≥ 8 chars and ≠ current. Then revokes older tokens and returns a
  fresh token: body `{ ok, message, token, expiresIn, revokedBefore }` + header `x-erp-session-token` (gateway and web proxy pass it; the web stores it).
- `POST /users/:id/revoke-sessions` (`identity.user.write`, not on users with more rights than the caller → 403) — admin "บังคับออกจากระบบ";
  the user can log in again.
- `GET /role-templates?modules=a,b&q=` (`identity.user.read`) — suggested Thai roles (ผู้บริหาร, พนักงานทั่วไป, หัวหน้างาน, ฝ่ายบุคคล, บัญชีและการเงิน, จัดซื้อ, ฝ่ายขาย, คลังสินค้า, ช่างซ่อมบำรุง, QC, ไอที, วางแผนการผลิต, ผู้จัดการโครงการ) → `{ id, name, description, permissions, permission_count, skipped }`.
- `POST /roles/from-template { template, name?, modules? }` (`identity.role.write`) — creates the role (name defaults to the template's; taken → 409) with only the permissions of the
  installed modules (`modules` from the client's catalog, else an `x-erp-modules` header, else all). Returns the role + `skipped` + Thai `message`.

## Rules
- The company profile is what makes a printed tax invoice legal (Revenue Code §86/4: seller name, address, tax ID, branch). apps/web reads it once per session for every printed document.
- `footer_note` is printed only where a screen's `print.footer` asks (tax invoice / quotation payment terms) — not on POs, receipts, claims, payslips, 50 ทวิ, QC/NCR or approvals.
- Never return `password_hash`. Passwords: scrypt via kernel `hashPassword`.
- Permission strings: `<module>.<thing>.<action>`, wildcards `<module>.*` and `*`. The list of available permissions comes from installed modules' manifests (`GET /api/_catalog`), not from this module.
- Role templates live in `src/role-templates.ts` (static — identity cannot read other modules). A permission belongs to module `m` when its prefix is `m`
  or `m` starts with `<prefix>-` (`master.*` → `master-data`). `tests/ui/role-templates.test.ts` checks every key against the repo's module.json files.
- Templates keep segregation of duties (wave 8, tested in `tests/ui/role-templates.test.ts`): only `executive` holds `purchasing.po.approve-high` and
  `expense.claim.approve-over-limit`; no template both writes and approves POs (`purchasing` raises, receives, returns — no approve); control settings
  (`purchasing.settings.write`, `expense.settings.write`) and `inventory.hold.override` stay admin-only; `warehouse` has no `inventory.hold.release` (QC does).
  Lock dates (bugs-0.4 ID-05): `accounting` (who already closes/reopens periods) holds `sales|expense|purchasing.lock.write` and `sales|expense.lock.override`;
  no other template holds any `*.lock.override` (no `purchasing.lock.override` at all — a late goods receipt needs the period reopened).
  Round-2 N3 gaps closed: `it`/`technician` + `master.partner.read`, `technician` + contracts visits / helpdesk work / timesheets, `qc` + `quality.ncr.close`
  and helpdesk work (customer complaints), `purchasing` + `approvals.request.approve` (PR chain), new `planner` (วางแผนการผลิต). The demo seed
  (`tools/erp/src/demo*.ts`) creates every demo user from these templates + `staff`.
- **Token revocation** (security review 0.3, SEC-07): logout, password change, deactivation (`user_disabled`), role change (`roles_changed`) and the admin
  action (`admin`) emit `identity.tokens_revoked { userId, before, reason }`. `before` = the next whole second (`revocationCutoff`) so tokens from
  earlier in the same second die too; `/auth/login` and `/me/password` issue new tokens with `iat` = the user's cutoff (read from identity's own
  `_revoked_tokens`), so logging in again at once is not refused. Identity refuses revoked tokens immediately (kernel applies its own emit);
  every other module gets the event from the gateway (kernel subscription — see packages/kernel/CLAUDE.md for the propagation delay).
  Changing your own roles logs you out too. Role *edits* (no endpoint yet) would need the same for every holder of the role.
  Tokens still live `JWT_TTL_SECONDS` (default 12h) when nothing revokes them.
- **No granting beyond your own rights** (security review 0.3, SEC-01): `POST /roles`, `POST /roles/from-template`, `POST /users` (roleIds),
  `PUT /users/:id/roles` and `POST /users/:id/deactivate` answer 403 unless the caller holds every permission involved — the new role's,
  the assigned roles', and (for role changes / deactivation) the target user's current ones (`canGrant`: `*` needs `*`, `m.*` needs `m.*`).
  Role ids of another company → 400.
- **Login throttling** (SEC-02): 10 wrong passwords per e-mail **+ client IP** in 15 minutes (with or without a company code) → 429 `too_many_attempts`,
  so wrong guesses from one place do not lock the owner out from another. Looser caps: 50 per e-mail from any IP, 100 per IP over any e-mails
  (`loginBuckets`). The IP is `x-erp-client-ip`, set by the gateway from what it saw (`clientIp`; missing → one shared `direct` bucket).
  Counted in Postgres (`auth_attempts`, shared by every identity instance, kept across restarts — `src/throttle.ts`); the right password
  clears the e-mail + IP bucket. Unknown company / unknown e-mail run a dummy scrypt so they answer like a wrong password ("อีเมลหรือรหัสผ่านไม่ถูกต้อง").
- SVG logos must not contain script, event handlers, `<foreignObject>`, entities or outside links (SEC-11).

## Screens for sessions
- `changePassword` (form, no perm, not in the menu — the web links it from the user box beside "ออกจากระบบ"); `userDetail` (row link from `users`)
  with actions บังคับออกจากระบบ / กำหนดบทบาท / ปิดใช้งาน.

## Extension ideas
LINE Login (new route + `users.line_user_id` in a new migration), 2FA, password reset (e-mail), SSO, per-device logout (tokens already carry `jti`).

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.
