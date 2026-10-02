# CLAUDE.md — ERP Template Core

Modular ERP for Thai SME factories, split into **independently sellable microservices**.
A customer buys Core + any set of modules, receives the source, and extends it (often with AI).
Your job when working here: add or change features **without breaking module independence**.

## Map

```
packages/kernel      shared runtime: service factory, auth/JWT, tenant RLS, outbox/inbox events, licensing, migrations, test helpers
packages/contracts   event schemas — the ONLY coupling between modules
packages/thai        VAT, baht text, Buddhist-era dates, tax-ID check, PromptPay
packages/ui-schema   screen-definition types + helpers shared by web and mobile (browser-safe, no deps)
apps/gateway         front door: /api/<module>/* proxy, /api/_catalog, event router (/_events/publish)
apps/web             Next.js app: renders every installed module's screens (menu from /api/_catalog)
apps/mobile          Expo app: renders the screens marked `mobile: true`, QR/barcode scan on lookups
services/<module>    one deployable, sellable module each (own database, module.json, migrations, src/ui.ts screens, tests, CLAUDE.md)
tools/erp            `pnpm erp …`: catalog, quote, compose, pack, license, new-module, verify
catalog/catalog.json prices & bundles (internal — never shipped to customers)
tests/e2e            whole installations (all modules / partial) through the gateway
tests/ui-e2e, tests/uat  browser tests and the UAT run (Chromium against a real installation)
site/                landing page (internal — never shipped; `pnpm site --serve`)
```

Modules: `identity`, `master-data` (core, always installed) · `inventory`, `purchasing`, `sales`, `production`, `maintenance`, `costing`, `automation` (features).
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
11. **Screens are data, in `services/<module>/src/ui.ts`.** Each endpoint in it uses the exact path template of the server route (`/purchase-orders/:id/approve`); lookups may only target the module itself or a core module; perms must exist in module.json. `tests/ui/descriptors.test.ts` checks all of this against the real routes. Don't write module-specific React in apps/web or apps/mobile — extend the generic renderer (packages/ui-schema types + both apps) if a new kind of field/format is needed.
12. After adding/removing a module run `pnpm erp ui-sync` (regenerates the apps' module registries; `verify` fails if stale).

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
pnpm erp ui-sync            # after adding/removing a module
pnpm test:ui                # builds the web app, then drives it in Chromium against a real installation
pnpm uat:pack               # rerun all tests + the 22 UAT cases with screenshots, rebuild docs/uat/uat-pack.html
pnpm --filter @erp/web dev  # web on :3000 (GATEWAY_URL=http://localhost:8080)
pnpm --filter @erp/mobile start   # Expo; EXPO_PUBLIC_GATEWAY_URL=http://<lan-ip>:8080
```

## Screens (src/ui.ts) in one glance

```ts
export default defineUi({
  module: 'purchasing', label: 'จัดซื้อ', glyph: 'ซ',
  menu: [{ label: 'ใบสั่งซื้อ', screen: 'poList' }],
  screens: {
    poList:   { kind: 'list', endpoint: '/purchase-orders', columns: [...], rowLink: { screen: 'poDetail' }, create: 'poNew', mobile: true },
    poNew:    { kind: 'form', method: 'POST', endpoint: '/purchase-orders', fields: [...], lines: {...}, after: { screen: 'poDetail', idFrom: 'id' } },
    poDetail: { kind: 'detail', endpoint: '/purchase-orders/:id', heading: 'no', fields: [...], actions: [{ id: 'approve', method: 'POST', endpoint: '/purchase-orders/:id/approve', when: { field: 'status', in: ['draft'] } }] },
  },
});
```
Full reference: docs/ui.md. A module can also declare `widgets` (home dashboard: kpi/bars/pipeline/trend/floor3d/feed),
`commands` (Thai ⌘K commands that prefill forms), `search` (palette record search) and `notifications` (the bell).
The AI assistant (`apps/web/src/app/assist`) reads only GET endpoints declared there, with the user's token, and never writes.

Tests boot the real service against a fresh database as the non-superuser `erp_app`, so RLS is really enforced.
Use `bootTestService(definition)` → `t.api(method, url, body, { token: t.token(perms, tenantId) })`, `t.deliver(type, data)`, `t.published(type)`.

## Definition of done for any change

- `pnpm check` passes (typecheck, unit + e2e tests, verify).
- New behaviour has a test in the module's `test/` folder, including a permission test and a tenant-isolation check for new tables.
- `module.json` and the module's `CLAUDE.md` describe any new endpoint, permission or event.
- A new endpoint users need has a screen or action in `src/ui.ts` (and `mobile: true` if it is shop-floor work).
