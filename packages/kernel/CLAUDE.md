# kernel — shared runtime (changes here affect EVERY module and every customer)

Treat as a library with a stable API. Prefer adding new helpers over changing existing behaviour.
Customers receive kernel updates as drop-in replacements, so never put customer-specific logic here.

- `createService(def, env)` — Fastify app + auth hook + error format + `/_health`, `/_manifest`, `/_events` + outbox dispatcher + license check.
- `auth(req)`, `requirePerm`, `hasPerm`, `signToken`, `verifyToken`, `hashPassword` — JWT HS256 shared secret (`JWT_SECRET`).
- `db.tx(tenantId, fn)` — sets `app.tenant_id` for RLS. `migrate()` applies `-- @tenant` directives. `nextDocNo`, `one`.
- `emit`, `dispatchOutbox`, `receiveEvent` — transactional outbox, at-least-once delivery, inbox de-dup.
- `checkLicense`, `issueLicense`, `readLicense` — Ed25519-signed module licenses.
- `testing.ts` — `bootTestService`, `createTestDatabase`.

Env: `DATABASE_URL`, `JWT_SECRET`, `INTERNAL_TOKEN`, `EVENT_ROUTER_URL` (optional), `ERP_LICENSE`, `PORT`, `LOG_LEVEL`.
