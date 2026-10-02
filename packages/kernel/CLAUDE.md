# kernel — shared runtime (changes here affect EVERY module and every customer)

Treat as a library with a stable API. Prefer adding new helpers over changing existing behaviour.
Customers receive kernel updates as drop-in replacements, so never put customer-specific logic here.

- `createService(def, env)` — Fastify app + auth hook + error format + `/_health`, `/_manifest`, `/_events` + outbox dispatcher + license check.
- `auth(req)`, `requirePerm`, `hasPerm`, `signToken`, `verifyToken`, `hashPassword` — JWT HS256 shared secret (`JWT_SECRET`).
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

Env: `ERP_CLOCK` (tests/demos only: frozen ISO instant), `DATABASE_URL`, `JWT_SECRET`, `INTERNAL_TOKEN`, `EVENT_ROUTER_URL` (optional), `ERP_LICENSE`, `PORT`, `LOG_LEVEL`.
