# Security review 0.3 — Factory OS (template-core)

วันที่ 2026-10-03 · ขอบเขต: kernel (auth/JWT, db + RLS + migrations, service factory, attachments, audit, errors), gateway,
web `/api` proxy + ผู้ช่วย AI, identity, automation (webhook, LINE), master-data import, payroll, `tools/erp` (pack / license / compose)
และสุ่มตรวจ expense / hr / helpdesk / booking / approvals (การเห็นเฉพาะข้อมูลของตัวเอง)

## สรุปสำหรับผู้บริหาร (ภาษาไทย)

ภาพรวม **โครงสร้างแยกข้อมูลแต่ละบริษัทแข็งแรง**: ทุกตารางธุรกิจ (และ `_attachments` / `_audit`) มี Row-Level Security แบบ `FORCE`,
service ต่อฐานข้อมูลด้วย role ที่ไม่ใช่ superuser, ไม่มี `SECURITY DEFINER`/view ที่ข้าม RLS, query ข้อมูลบริษัททั้งหมดอยู่ใน `k.db.tx`
(ยกเว้นการหา `tenants` ตอน login ซึ่งเป็นตาราง global โดยตั้งใจ) ไฟล์แนบตรวจ magic bytes + ส่งพร้อม CSP sandbox/nosniff, ลิงก์ไฟล์เซ็น HMAC
ผูกกับบริษัท, payroll/expense/hr/helpdesk/booking กรอง "เฉพาะของตัวเอง" ฝั่ง server ถูกต้อง, LINE webhook ตรวจลายเซ็นแบบ constant-time

พบปัญหาที่ต้องแก้ก่อนลูกค้าใช้ข้อมูลจริง (เงินเดือน บัญชีธนาคาร ภาษี HR) — **แก้แล้วทั้งหมดในรอบนี้** พร้อม test:

| ระดับ | จำนวน | แก้แล้ว | ต้องตัดสินใจเชิงผลิตภัณฑ์ / เอกสาร |
|---|---|---|---|
| Critical | 0 | – | – |
| High | 3 | 3 | – |
| Medium | 6 | 4 | 2 (SEC-07 เพิกถอน token, SEC-14 การติดตั้ง/HTTPS) |
| Low / Info | 12 | 6 | 6 |

ความเสี่ยงสูงที่ปิดแล้ว:
1. **SEC-01 ยกระดับสิทธิ์ตัวเอง** — ผู้ที่มีสิทธิ์ "จัดการผู้ใช้" (เช่น HR) ใส่บทบาท Administrator ให้ตัวเองได้ หรือสร้างบทบาท `*` ได้ → ตอนนี้ให้ได้เฉพาะสิทธิ์ที่ตัวเองมี
   และแก้/ปิดบัญชีคนที่มีสิทธิ์มากกว่าไม่ได้
2. **SEC-02 เดารหัสผ่านไม่จำกัด** — login ไม่มีการจำกัดจำนวนครั้ง และเวลาในการตอบบอกได้ว่าอีเมล/รหัสบริษัทมีอยู่จริง → จำกัด 10 ครั้ง/15 นาที/บัญชี และตอบเวลาเท่ากัน
3. **SEC-03 ค่า secret ตัวอย่าง** — ถ้าลูกค้าใช้ `.env.example` ตามที่ได้ไป ใครก็ปลอม token เป็นแอดมินของทุกบริษัทได้ และยิง event ปลอมผ่าน gateway ได้ → service/gateway ไม่ยอม start

สิ่งที่ยังต้องตัดสินใจ (ไม่ได้แก้เพราะกระทบการใช้งาน/ราคา): token ยกเลิกไม่ได้ก่อนหมดอายุ 12 ชม. (คนลาออกยังใช้ token เดิมได้),
การติดตั้งมาตรฐานยังเป็น HTTP และไม่ได้ตั้ง `NODE_ENV=production`, ไม่มีหน้าเปลี่ยน/รีเซ็ตรหัสผ่าน และ `pnpm erp pack` ส่งโฟลเดอร์ `docs/`
(รวมรายงานนี้) ให้ลูกค้าด้วย — ดูหัวข้อ "Open decisions" ด้านล่าง

---

## Findings (English, technical)

Status legend: **Fixed** (code + regression test in this change) · **Documented** (needs a product decision, see "Open decisions") · **Accepted**.

### SEC-01 — High — Privilege escalation through user / role administration — Fixed

- Evidence (before): `services/identity/src/service.ts` `POST /users` inserted any `roleIds`; `PUT /users/:id/roles` replaced roles of any user
  (incl. the caller); `POST /roles` accepted `permissions: ['*']`; `POST /roles/from-template` and `POST /users/:id/deactivate` had no
  relationship to the caller's own rights. Role ids were not checked to belong to the tenant (the FK check bypasses RLS).
- Exploit: a customer gives HR `identity.user.write` so they can onboard staff. HR calls `PUT /api/identity/users/<self>/roles
  {roleIds:[<Administrator>]}`, logs in again and has `*` — payroll, bank lists, accounting. Or HR deactivates / strips the real admin.
- Fix: `canGrant` / `requireGrantable` (service.ts ~L95–L115). Creating a role, creating it from a template, assigning roles, changing a
  user's roles and deactivating a user all require the caller to hold every permission involved (`*` needs `*`, `m.*` needs `m.*`,
  a single permission needs it or a covering wildcard), including the target user's current permissions. Unknown / foreign role ids → 400.
- Tests: `services/identity/test/identity.test.ts` › "security review 0.3" › SEC-01 (2 tests).

### SEC-02 — High — Unlimited password guessing; account / tenant enumeration by timing — Fixed

- Evidence (before): `POST /auth/login` (identity service.ts) had no throttling; an unknown tenant or e-mail returned immediately while a
  known user paid a scrypt hash (~50 ms) — measurable enumeration. Passwords need only 8 characters; the installation is internet-facing.
- Fix: per account (`tenant|email`) at most `LOGIN_MAX_FAILURES` = 10 failures per 15 minutes → `429 too_many_attempts` (Thai message),
  cleared by a success; unknown tenant / user verify against a dummy scrypt hash and count as failures. Same body for all failures.
- Residual (Accepted/Documented): the counter is in memory per identity instance (one container per module in the standard install); a
  per-IP limit is not possible inside identity because the gateway does not forward the client address — put a rate limit on the reverse
  proxy (e.g. nginx `limit_req` on `/api/identity/auth/login`). An attacker can deliberately lock a known account for 15 minutes.
- Tests: identity.test.ts › SEC-02.

### SEC-03 — High — Example secrets accepted at boot (token forgery, event forgery) — Fixed

- Evidence (before): `tools/erp/src/compose.ts` writes `.env.example` with `JWT_SECRET=replace-with-64-random-characters` and
  `INTERNAL_TOKEN=replace-with-another-random-string`; `createService` only checked that the variables exist. The gateway's
  `POST /_events/publish` is reachable on the public port 8080 and is protected only by `INTERNAL_TOKEN`.
- Exploit: an installation started with the example file → anyone signs `{"tid":"<any tenant>","perms":["*"]}` with the public placeholder
  and reads every company's payroll; or posts forged events (e.g. `expense.claim_paid`) into any tenant through `/_events/publish`.
- Fix: `secretProblems()` (`packages/kernel/src/auth.ts`) — placeholders are always refused; with `NODE_ENV=production` secrets must be
  ≥ 32 characters and JWT_SECRET ≠ INTERNAL_TOKEN. `Service.start()` and `apps/gateway/src/main.ts` refuse to start. (Tests and the demo
  use `createService` / non-placeholder values and are unaffected.) Internal-token comparisons are now constant time (`safeEqual`).
  The generated `.env.example` explains `openssl rand -hex 32`.
- Tests: `packages/kernel/test/kernel.test.ts` › SEC-03 (2 tests).

### SEC-04 — Medium — Web proxy dropped the attachment safety headers — Fixed

- Evidence (before): `apps/web/src/app/api/[...path]/route.ts` returned only `content-type`. The gateway forwards
  `content-disposition`, `x-content-type-options: nosniff` and the sandboxing `content-security-policy` of `/_attachments/:id/content`,
  but the browser (same origin as the app, token in `localStorage`) never saw them.
- Impact: an uploaded file opened through the web origin lost "download, don't render", nosniff and the script sandbox — the defence in
  depth the kernel relies on (attachments.ts `sendFile`).
- Fix: `apps/web/src/lib/proxy-headers.ts` passes the same allow-list as the gateway and always adds `nosniff`; cookies/server headers are
  not passed. Test: `apps/web/test/proxy-headers.test.ts`.

### SEC-05 — Medium — No security headers on the web app (clickjacking, sniffing) — Fixed (partially)

- Evidence (before): `apps/web/next.config.ts` had no `headers()`.
- Fix: every page (not `/api/*`, which keeps the module's own headers) gets `X-Frame-Options: DENY`,
  `CSP: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`, `nosniff`, `Referrer-Policy: same-origin`,
  `Permissions-Policy`, and `X-Powered-By` is off.
- Residual (Documented): no `script-src` CSP — Next's inline bootstrap needs nonces (middleware). With the JWT in `localStorage`
  (`apps/web/src/lib/session.ts`) any future XSS means token theft. No XSS sink was found today (no `dangerouslySetInnerHTML`, data links
  go through `safeHref`, the logo is rendered with `<img>`). Verify the headers with `next build` + a browser (not run in this review).

### SEC-06 — Medium — Webhook SSRF guard bypassable — Fixed (DNS rebinding residual)

- Evidence (before): `services/automation/src/engine.ts` `webhookProblem` only matched the host *text* against a regex: a public name
  resolving to 10.x / 169.254.169.254, IPv4-mapped IPv6 (`https://[::ffff:7f00:1]`), `[::]`, CGNAT `100.64/10`, single-label docker names
  (`https://gateway`) all passed. Rule writers (`automation.rule.write`) see the first 200 bytes of the response in `runs`.
- Fix: `isPrivateAddress()` (BlockList of loopback/private/link-local/CGNAT/multicast/reserved + IPv4-mapped handling), credentials in URL
  and single-label hosts refused; `sendWebhook` resolves the host (`resolvesPrivate`) and refuses if any address is internal. Redirects were
  already refused (`redirect: 'error'`). `AUTOMATION_ALLOW_PRIVATE_WEBHOOKS=1` still opts out.
- Residual (Documented): DNS rebinding between lookup and connect; run the automation container behind an egress firewall. Only https
  targets are allowed, which further limits internal reach.
- Tests: `services/automation/test/service.test.ts` › SEC-06.

### SEC-07 — Medium — Tokens cannot be revoked — Documented (product decision)

- Evidence: `signToken` 12 h TTL (`JWT_TTL_SECONDS`), stateless verification in every module; `POST /users/:id/deactivate` and role changes
  only affect the next login (identity CLAUDE.md says so).
- Impact: a dismissed employee (or a stolen token) keeps full access — payslips, bank-transfer lists — for up to 12 hours.
- Options: (a) shorter TTL (e.g. 1 h) + refresh endpoint in identity that re-checks `active`/roles; (b) a `ver` claim per user and a
  revocation event (`identity.user_deactivated`) that modules cache; (c) at minimum lower `JWT_TTL_SECONDS` in compose. Needs a decision
  because it changes the mobile/web session UX.

### SEC-08 — Low — AI assistant: percent-encoded dot segments in `read_data` ids — Fixed

- Evidence (before): `apps/web/src/lib/assistant.ts` `matchesTemplate` matched `:id` with `[^/]+`, so `/purchase-orders/%2e%2e` (normalised
  by `fetch` to `..`) or `?x=` could reach GET routes not declared in any `ui.ts`, e.g. `/_audit` or `/_attachments/<id>/content`.
- Impact: limited — still GET only, with the user's own token (RLS + permissions enforced by the module); the server side never writes,
  `open_screen` links are same-app paths (`safeHref`). A prompt-injected record could make the model read more of what the user may
  already read and put it in the answer.
- Fix: id segments must be plain `[A-Za-z0-9_~:@.-]`, and `%`, `?`, `#`, whitespace, `\`, `.`/`..` segments are refused.
  Test: `apps/web/test/assistant.test.ts`.
- Note: the read-only guarantee of the assistant is enforced in the Next route (server), not by the model: only `GET`, only declared
  templates, the user's bearer token is forwarded to the gateway and never sent to Anthropic.

### SEC-09 — Low — LINE link codes guessable with many LINE accounts — Fixed

- Evidence: `services/automation/src/line.ts` limited wrong 6-digit codes per LINE account only (5 / 15 min). With fresh LINE accounts an
  attacker could keep guessing a live code and receive a colleague's personal notifications.
- Fix: also at most 30 wrong codes per company per 15 minutes (`MAX_WRONG_CODES_PER_TENANT`). Test: `line.test.ts` › SEC-09.

### SEC-10 — Low — Audit-log redaction gaps — Fixed

- Evidence: `packages/kernel/src/audit.ts` `DROP_KEY` covered password/secret/token but not `apiKey`, `privateKey`, `otp`, `pin`,
  `credentials`, `authorization`, `cookie`; `MASK_KEY` lacked passport / IBAN.
- Fix + test: `packages/kernel/test/platform.test.ts` › SEC-10 (company `signatureLabels` intentionally still logged).

### SEC-11 — Low — SVG company logo could carry script — Fixed

- Evidence: `logoProblem` (identity) accepted any SVG containing `<svg`. Today it is only rendered with `<img>` (scripts do not run), but
  the value is printed on every document and returned to every user; any future inline use would be stored XSS.
- Fix: SVG with `<script`, `on*=` handlers, `javascript:`, `<foreignObject`, `<!ENTITY` or non-fragment/non-data `href` → 400. Test in
  identity.test.ts (company profile validation).

### SEC-12 — Low — JWT without `exp` accepted — Fixed

- Evidence: `verifyToken` only checked `exp` when present. Identity always sets it, but a token minted by a customer script/another tool
  with the shared secret would never expire. Fix: `exp` required. `alg` is never read from the header (HS256 fixed) — no alg confusion /
  `none`. Test: kernel.test.ts › SEC-12.

### SEC-13 — Low — CSV formula injection through "numeric" columns — Fixed

- Evidence: `packages/ui-schema/src/index.ts` `csvCell(text, numeric=true)` skipped the formula guard for any text in a money/qty column
  (`csvValue` returns the raw string when it is not a number). Fix: the guard is skipped only for real numbers; full-width `＝＋－＠`
  are also neutralised. Test: `packages/ui-schema/test/csv.test.ts`.

### SEC-14 — Medium — Deployment defaults — Documented (product decision)

- `tools/erp/src/compose.ts`: gateway `8080` and web `3000` published on all interfaces over plain HTTP (passwords and bearer tokens in
  clear on the LAN/Internet); no TLS terminator in the bundle.
- `NODE_ENV` is not set to `production` in the generated compose, so `checkLicense` runs in dev mode when `ERP_LICENSE` is empty and the
  production secret-length checks of SEC-03 are not active (placeholders are still refused).
- The README provisions the first admin with password `change-me-now`, and identity has **no change-password / reset** endpoint, so
  the initial password tends to stay. Password policy is "≥ 8 characters" only.
- Recommendation: ship a Caddy/nginx service with HTTPS and bind 8080/3000 to `127.0.0.1`; set `NODE_ENV=production` once every
  customer has a license token; add `POST /me/password` (current + new, scrypt) and an admin reset; consider TOTP for `*` holders.

### SEC-15 — Low — `GET /api/_catalog` is public — Accepted / Documented

- `apps/gateway/src/gateway.ts` L81: lists installed modules, versions and permission keys without a token. Useful for reconnaissance
  only (no tenant data). Could require a bearer token if the login screen does not need it.

### SEC-16 — Low — Client-supplied `X-Forwarded-Host/Proto` forwarded — Documented

- gateway.ts L145 passes the client's `x-forwarded-host` to modules; automation uses it only to *display* the LINE webhook URL when
  `PUBLIC_BASE_URL` is unset (the admin's own request). Set `PUBLIC_BASE_URL` in production; if a reverse proxy is added, have it overwrite
  these headers.

### SEC-17 — Low — Kernel tables without RLS (`_outbox`, `_inbox`, `_doc_seq`) — Accepted

- `packages/kernel/src/db.ts` `KERNEL_SQL`: `_outbox` holds every tenant's event payloads and is read by the dispatcher outside a tenant
  context (`rawTx`) by design; `_doc_seq` writes use the tenant expression. Only kernel code touches them; module code must never query
  them (add to `pnpm erp verify` if module authors start to).

### SEC-18 — Info — Automation rule writers see event payloads — Documented

- `automation.rule.write` can route any subscribed event (leave type names, claim amounts, payroll *totals*) to "everyone" or to an external
  https webhook. Event contracts already exclude salaries / national IDs (`payroll.run_paid` = company totals only). Treat
  `automation.rule.write` as an admin permission in role templates (it is not in any non-admin template today).

### SEC-19 — Low — No body-size limit in the Next routes — Documented

- `apps/web/src/app/api/[...path]/route.ts` (`req.text()`) and `/assist` buffer the whole request before the gateway's 8 MB limit applies.
  Put a `client_max_body_size` (~10 MB) on the reverse proxy.

### SEC-20 — Info — `pnpm erp pack` ships `docs/` — Documented (decision)

- `tools/erp/src/pack.ts` `ROOT_DIRS` includes `docs`, so this review (with open items) and `docs/roadmap` go to every customer. Decide
  whether `docs/security` should be excluded or published deliberately.

### SEC-21 — Info — `.gitignore` ignores `*.pem` — Info

- `packages/kernel/license-public.pem` (meant to be committed, per `pnpm erp license keygen`) is ignored by `*.pem`; licensed installs then
  need `ERP_LICENSE_PUBLIC_KEY`. Add `!packages/kernel/license-public.pem`.

## Verified (no issue found)

- RLS: every `create table` in `services/*/migrations` has `-- @tenant` (only `identity.tenants` is global, by design); `FORCE ROW LEVEL
  SECURITY`; services connect as `erp_app`; no `SECURITY DEFINER`, views or functions in migrations. `k.db.pool` used only for the
  `tenants` lookup at login. `_attachments` / `_audit` get the same policy.
- Authorization: an automated scan of every route in `services/*/src` found a permission check or an owner-scoped loader on all
  authenticated routes (exceptions are deliberate: `/me`, `/company`, `/users/directory`). "Own records only" verified for payroll
  (`/my-payslips`, `/my-certificates`, `/certificates/:id`), expense (`loadClaim`/`loadAdvance` + attachments `access`), hr leave,
  helpdesk tickets (`loadTicket`, internal notes), booking (`assertOwnerOrApprover`).
- Payroll stores only `bank_account_last4`; bank-transfer / SSO / ภ.ง.ด.1 reports need `payroll.run.read`; the audit log masks bank /
  ID numbers.
- Attachments: extension + magic bytes, size checked before allocation, per-record cap under advisory lock, `content-disposition` with
  RFC 6266 names, CSP sandbox, nosniff; signed links HMAC(`att|module|tenant|id|exp`), 5 min, constant-time compare.
- LINE webhook: raw bytes forwarded by the gateway, HMAC-SHA256 constant time, tenant from key + secret compared inside RLS.
- Gateway: overwrites `x-erp-modules` (clients cannot spoof it); never forwards `x-internal-token`; no CORS headers (same-origin web,
  native mobile). Internal routes (`/_events`, `/tenants`) need the internal token even when reached through `/api/<module>/…`.
- Passwords: scrypt with 16-byte salt, constant-time compare; `password_hash` never returned.
- License: Ed25519 signature, expiry and module list checked at boot (a contractual guard, not DRM — source is delivered).
- master-data import: columns come from a fixed map after zod validation (no SQL built from user keys); 1 transaction.
- Mobile stores the session in `expo-secure-store`.

## Open decisions (need product owner)

1. SEC-07 token revocation / shorter TTL + refresh.
2. SEC-14 HTTPS in the standard bundle, `NODE_ENV=production` in compose, change-password / reset flow, optional 2FA for admins.
3. SEC-20 whether security docs ship to customers.
4. SEC-05 nonce-based `script-src` CSP (and/or moving the web token from `localStorage` to an httpOnly cookie).

## How this was checked

`npx vitest run services packages tests/ui tests/e2e apps/web/test`, `npx tsc --noEmit -p tsconfig.json`, `pnpm erp verify`.
`next build` was not run (not allowed during this review) — the `next.config.ts` header change should be confirmed in the next build.
