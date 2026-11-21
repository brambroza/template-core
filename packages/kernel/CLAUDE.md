# kernel — shared runtime (changes here affect EVERY module and every customer)

Treat as a library with a stable API. Prefer adding new helpers over changing existing behaviour.
Customers receive kernel updates as drop-in replacements, so never put customer-specific logic here.

- `createService(def, env)` — Fastify app + auth hook + error format + `/_health`, `/_manifest`, `/_events` + outbox dispatcher + license check.
- `auth(req)`, `requirePerm`, `hasPerm`, `signToken`, `verifyToken`, `hashPassword` — JWT HS256 shared secret (`JWT_SECRET`). Tokens carry a unique `jti`
  (`AuthContext.tokenId`, undefined for older tokens — still accepted) and `iat` (`issuedAt`); `signToken(secret, ctx, ttl, { iat })`.
- `revocation.ts` — token revocation (security review 0.3, SEC-07). `KERNEL_SUBSCRIPTIONS` = events every module's kernel handles itself
  (`identity.tokens_revoked`): not listed in module.json (allowed if listed; the module's own handler then runs after the kernel's), the gateway router
  sends them to every installed module. Stored in the kernel tenant table `_revoked_tokens (tenant_id, user_id, before, reason)` — one row per user,
  the largest cutoff wins (idempotent) — and in memory (`k.revocations`, a `RevocationList`), loaded at boot (`onReady`), updated on delivery and
  reloaded every `TOKEN_REVOCATION_RELOAD_MS` (default 30000; 0 = off). `verifyToken(secret, token, revokedBefore)` refuses `iat < before` with
  401 `session_revoked` "เซสชันถูกยกเลิก กรุณาเข้าสู่ระบบใหม่" (also on bearer attachment downloads). `k.emit(c, 'identity.tokens_revoked', …)` applies
  the revocation to the publishing service in the same transaction (the router never sends an event back to its publisher).
  Propagation delay: publisher immediately; other modules when the outbox is dispatched (~`EVENT_DISPATCH_MS`, 1 s); other instances of a module
  that did not get the delivery ≤ reload interval. Loading all tenants uses a SELECT-only policy gated by `app.kernel_read = 'revoked_tokens'`
  (`RevocationList.load` only — never set it in module code).
- `impact.ts` — impact preview ("ผลกระทบเมื่อกดยืนยัน"). (1) Dry run: a route with `config: { dryRun: true }` called with `?_dryRun=1` runs normally inside
  `dryRunStore` (AsyncLocalStorage): every `db.tx`/`rawTx` rolls back instead of committing and `k.emit` records `{ type, data }`; the answer is
  `{ dryRun: true, result, events }`, no audit row. Opt in only routes whose side effects are all in the database (no LINE/webhook/e-mail calls).
  (2) `POST /_impact { type, data }` (signed-in): the module's `ServiceDefinition.impact[type]` describer returns Thai `ImpactLine[]`; it may call
  `ctx.run()` (the module's own handler) and read what changed — the whole call is a rolled-back dry run, not audited. Describers check `ctx.auth`
  permissions and return `[]` for what the caller may not see. Rows inserted by the preview transaction: `where xmin = pg_current_xact_id()::xid`.
  The gateway's `POST /api/_impact { events }` asks every installed subscriber. Helpers `impactMoney`, `impactQty`. Test: `test/impact.test.ts`.
- `db.tx(tenantId, fn)` — sets `app.tenant_id` for RLS, the transaction's `TimeZone` to Asia/Bangkok (wave 8: leftover SQL `current_date` / `date_trunc` is the Thai day)
  and `app.today` = `thaiToday()`; `TODAY_SQL` is the SQL expression for it (follows `setClock`) — use it for SQL date defaults instead of `current_date`. `migrate()` applies `-- @tenant` directives. `nextDocNo`, `one`.
- `emit`, `dispatchOutbox`, `receiveEvent` — transactional outbox, at-least-once delivery, inbox de-dup.
- `checkLicense`, `issueLicense`, `readLicense` — Ed25519-signed module licenses.
- `attachments.ts` — opt-in file attachments per module (`ServiceDefinition.attachments` → `/_attachments` routes, `_attachments` table with RLS,
  5 MB, type by extension + magic bytes, signed links; optional per-entity `writable` hook freezes a record's files, e.g. a paid claim). `audit.ts` — `_audit` table (RLS) written by the `onSend` hook for every successful
  non-GET request of a signed-in user (redacted body ≤ 2 KB; secrets/files dropped, account / card / ID numbers kept as `••••<last 4>`), `GET /_audit` behind `<module>.audit.read` (added to every served manifest).
  Kernel tenant tables are listed in `KERNEL_TENANT_TABLES` (db.ts) and get the same RLS policy as `-- @tenant` tables.
- `clock.ts` — business dates. `thaiToday()` / `thaiDate(d)` give the Asia/Bangkok calendar day (YYYY-MM-DD); `now()` is the clock every
  service should use. The database runs in UTC, so **never default a document/business date with SQL `current_date`/`now()::date`** —
  compute `b.date ?? thaiToday()` in TS and pass it. Tests freeze time with `setClock('2026-10-02T19:00:00Z')` (= 02:00 Bangkok) or env
  `ERP_CLOCK`; `setClock(null)` restores. `nextDocNo` defaults to the Thai year of `thaiToday()`. `addDaysIso(day, n)` for date maths.
- `lock.ts` — lock date (วันที่ปิดงวด) per tenant in the kernel table `_lock_date` (RLS, one copy in each module's database).
  `guardLockDate(c, auth, { module, date, what, overrideReason })` → Thai 409 for a document dated on/before the lock unless the user has
  `<module>.lock.override` and gives a reason (≥ 3 chars; the request is in `_audit`). `lockThroughPeriod(c, 'YYYY-MM')` (forward only — handler for
  `accounting.period_closed`), `unlockPeriod(c, 'YYYY-MM')` (steps an accounting lock back — `accounting.period_reopened`), `setLockDate(c, date|null, byName)` (manual), `readLock(c)`.
- `testing.ts` — `bootTestService`, `createTestDatabase`; `t.raw()` for binary responses / requests without a token.

Env: `ERP_CLOCK` (tests/demos only: frozen ISO instant), `DATABASE_URL`, `JWT_SECRET`, `INTERNAL_TOKEN`, `EVENT_ROUTER_URL` (optional), `ERP_LICENSE`, `PORT`, `LOG_LEVEL`,
`TOKEN_REVOCATION_RELOAD_MS` (default 30000). Token `iat`/revocation cutoffs use real wall-clock time, never the (freezable) business clock.
