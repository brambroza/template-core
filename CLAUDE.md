# CLAUDE.md — ERP Template Core

Modular ERP for Thai SME factories, split into **independently sellable microservices**.
A customer buys Core + any set of modules, receives the source, and extends it (often with AI).
Your job when working here: add or change features **without breaking module independence**.

## Map

```
packages/kernel      shared runtime: service factory, auth/JWT, tenant RLS, outbox/inbox events, licensing, migrations, test helpers
packages/contracts   event schemas — the ONLY coupling between modules
packages/thai        VAT, baht text, Buddhist-era dates, tax-ID check, PromptPay
apps/gateway         front door: /api/<module>/* proxy, /api/_catalog, event router (/_events/publish)
services/<module>    one deployable, sellable module each (own database, module.json, migrations, tests, CLAUDE.md)
tools/erp            `pnpm erp …`: catalog, quote, compose, pack, license, new-module, verify
catalog/catalog.json prices & bundles (internal — never shipped to customers)
tests/e2e            whole installations (all modules / partial) through the gateway
```

Modules: `identity`, `master-data` (core, always installed) · `inventory`, `purchasing`, `sales`, `production`, `maintenance`, `costing` (features).
Each module folder has its own `CLAUDE.md` — read it before touching that module.

## Hard rules (CI enforces most of them via `pnpm erp verify`)

1. **No module imports another module.** Never `import … from '@erp/svc-x'` or `../../services/x` inside `services/*`.
2. **No module reads another module's database.** Each module owns its tables; data from elsewhere arrives as an event or as a snapshot in the request (e.g. `itemId` + `itemCode` + `itemName` on a line).
3. **Feature modules may only `require` core modules.** Optional integrations go in `enhancedBy` and work through events. A module must work when its partners are absent.
4. **Every business table has `tenant_id` and a `-- @tenant <table>` line** in its migration (row-level security). Always query inside `k.db.tx(auth.tenantId, …)`; never filter tenants by hand and never use `k.db.pool` for tenant data.
5. **Events go through the outbox:** `await k.emit(c, 'module.fact', data)` with the transaction client `c`. New event? Add its zod schema to `packages/contracts/src/index.ts` first, then list it in `module.json` `publishes`/`subscribes`.
6. **Event handlers must be idempotent-safe and must not throw for business reasons** (the fact already happened elsewhere). The kernel de-duplicates by event id; record anomalies instead of rejecting (see inventory `force: true`).
7. **Migrations are append-only:** add `migrations/00N_description.sql`; never edit an applied file.
8. **Validate every input with zod** via `parse(Schema, req.body)`; check permissions with `requirePerm(a, '<module>.<thing>.<action>')` and declare new permissions in `module.json`.
9. Money: `numeric(18,4)` in SQL, `round()` / `documentTotals()` from `@erp/thai` in code. Thai documents: `nextDocNo(c, 'PREFIX')` → `PREFIX-2569-0001`.
10. Customer-specific code goes in a **new module** (`pnpm erp new-module`) or a new migration/route inside their copy — don't fork kernel behaviour.

## Route pattern (copy this)

```ts
app.post('/things', async (req, reply) => {
  const a = auth(req);                          // 401 if no/invalid token
  requirePerm(a, 'mymodule.thing.write');       // 403 if missing
  const b = parse(ThingInput, req.body);        // 400 with field errors
  reply.code(201);
  return k.db.tx(a.tenantId, async (c) => {     // tenant-scoped transaction (RLS)
    const row = (await c.query('insert into things (name) values ($1) returning *', [b.name])).rows[0];
    await k.emit(c, 'mymodule.thing_created', { thingId: row.id });  // same transaction
    return row;
  });
});
```

## Commands

```
pnpm install
pnpm db:dev                 # Postgres in Docker (role erp_app). Tests need TEST_DATABASE_ADMIN_URL if not default.
pnpm check                  # typecheck + all tests + architecture verify  ← run before every commit
pnpm vitest run services/sales          # one module
pnpm erp new-module quality --name "Quality Control" --name-th "ควบคุมคุณภาพ"
pnpm erp verify
```

Tests boot the real service against a fresh database as the non-superuser `erp_app`, so RLS is really enforced.
Use `bootTestService(definition)` → `t.api(method, url, body, { token: t.token(perms, tenantId) })`, `t.deliver(type, data)`, `t.published(type)`.

## Definition of done for any change

- `pnpm check` passes (typecheck, unit + e2e tests, verify).
- New behaviour has a test in the module's `test/` folder, including a permission test and a tenant-isolation check for new tables.
- `module.json` and the module's `CLAUDE.md` describe any new endpoint, permission or event.
