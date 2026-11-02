# CLAUDE.md — ERP Template Core

Modular ERP for Thai SME factories, split into **independently sellable microservices**.
A customer buys Core + any set of modules, receives the source, and extends it (often with AI).
Your job when working here: add or change features **without breaking module independence**.

**Two kinds of code live here.** *Vendor code* is GO Along's tested base (everything shipped in the pack).
*Customer code* lives in `services/<module>/ext/` and in modules the customer creates. In a customer installation
(there is a `.erp/vendor-lock.json`) **never edit vendor files** — put the change in `ext/` or a new module
(see "Where a change goes" below). That keeps the base correct, lets `pnpm erp upgrade` replace it without merging,
and lets `pnpm erp doctor` prove it. `CUSTOM.md` (if present) holds this company's own conventions — read it too.

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
services/<module>/ext   the CUSTOMER's extension of that module (ext.json, index.ts, migrations/, ui.ts, test/) — see below
tools/erp            `pnpm erp …`: compose, pack, license, new-module, ui-sync, verify, doctor, upgrade
tests/e2e            whole installations (all modules / partial) through the gateway
tests/ui             UI <-> API contract of every module (vendor screens merged with ext/ui.ts)
<!-- erp:internal:start -->
catalog/catalog.json prices & bundles (internal — never shipped to customers)
tests/ui-e2e, tests/uat  browser tests and the UAT run (Chromium against a real installation)
site/                landing page (internal — never shipped; `pnpm site --serve`)
<!-- erp:internal:end -->
```

<!-- erp:modules:start -->
Modules: `identity`, `master-data` (core, always installed) · `accounting`, `approvals`, `assets`, `automation`, `booking`, `contracts`, `costing`, `crm`,
`etax`, `expense`, `helpdesk`, `hr`, `inventory`, `maintenance`, `payroll`, `production`, `projects`, `purchasing`, `quality`, `sales` (features).
<!-- erp:modules:end -->
Each module folder has its own `CLAUDE.md` — read it before touching that module.

## Where a change goes (decide this first)

| The customer wants… | Put it in |
|---|---|
| a new field on an existing document (PO, invoice, item…) | `ext/migrations/00N_x_….sql` (`alter table … add column x_…`) + an `ext` route to set it + `ext/ui.ts` patch (column/fact/action) |
| a company rule ("PO over 100,000 needs a note", "no sale below cost") | an `ext` **guard** on the existing route (refuses with a Thai message; vendor code untouched) |
| something to happen when a fact happens elsewhere ("LINE the QC group when an NCR is raised") | an `ext` **handler** subscribing to the existing event (`ext/ext.json` `subscribes`) |
| a new report / screen inside an existing module | an `ext` GET route under `/x/…` + a new screen in `ext/ui.ts` |
| a whole new business area (own documents, own tables) | a **new module**: `pnpm erp new-module <id>` (`/new-module`) |
| a bug fix or behaviour change in the base itself | **not here** — report it to GO Along; it ships in the next release for everyone |

In GO Along's own source repo (no `.erp/vendor-lock.json`) you are building the vendor base: edit modules directly and never create `ext/` folders there.

## Extension layer — `services/<module>/ext/` (customer code)

The kernel loads it automatically; the module's own code does not change. Every file is optional.

```
ext/ext.json          { "description": "…", "permissions": [{ "key": "purchasing.x_budget.write", "label": "…" }], "subscribes": ["quality.ncr_raised"], "publishes": [] }
ext/index.ts          export default defineExtension({ routes, guards, handlers })      (from @erp/kernel)
ext/migrations/*.sql  run after the vendor migrations, recorded as ext/<file>; same rules (tenant_id + -- @tenant)
ext/ui.ts             export default defineUiExtension({ module, patch, hide, screens, menu })   (from @erp/ui-schema) → then `pnpm erp ui-sync`
ext/test/*.test.ts    the customer's tests — `bootTestService(definition)` boots the module WITH its extension
```

```ts
import { auth, badRequest, defineExtension, parse, requirePerm, z } from '@erp/kernel';

export default defineExtension({
  routes(app, k) {                                   // new routes only, always under /x/ (an update can never collide with them)
    app.post('/x/purchase-orders/:id/budget', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.x_budget.write');   // declared in ext/ext.json
      const b = parse(z.object({ code: z.string().min(1) }), req.body);
      return k.db.tx(a.tenantId, async (c) => (await c.query('update purchase_orders set x_budget_code = $2 where id = $1 returning *', [(req.params as any).id, b.code])).rows[0]);
    });
  },
  guards: {                                          // company rules on EXISTING routes: throw to refuse, return to allow
    'POST /purchase-orders/:id/approve': async (req, { k, auth }) => { /* … */ },
  },
  handlers: {                                        // run after the vendor handler, same transaction; keys = ext.json subscribes
    'quality.ncr_raised': async (data, ctx) => { /* … */ },
  },
});
```
Naming: ext routes start with `/x/`, ext tables and added columns with `x_`, ext permissions `<module>.x_<thing>.<action>`, ext screen ids with `x`.
Then GO Along can add anything to the base without ever clashing with the customer's names.
Mistakes fail at startup/test time, never silently: a guard whose route no longer exists, a patch on a screen or column the vendor renamed,
an ext route that would override a vendor route, handlers that don't match `ext.json`.
Ext code may import `@erp/kernel`, `@erp/contracts`, `@erp/thai`, `@erp/ui-schema` and its own module's exported helpers; never another module.


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
10. Customer-specific code goes in the module's **`ext/`** or a **new module** (`pnpm erp new-module`) — never in vendor files of an installation, never in `packages/*`.
11. **Screens are data, in `services/<module>/src/ui.ts`.** Each endpoint in it uses the exact path template of the server route (`/purchase-orders/:id/approve`); lookups may only target the module itself or a core module; perms must exist in module.json. `tests/ui/descriptors.test.ts` checks all of this against the real routes. Don't write module-specific React in apps/web or apps/mobile — extend the generic renderer (packages/ui-schema types + both apps) if a new kind of field/format is needed.
12. After adding/removing a module or an `ext/ui.ts` run `pnpm erp ui-sync` (regenerates the apps' module registries; `verify` fails if stale).
13. In an installation, `pnpm erp doctor` must report "Vendor base intact" before you finish. `pnpm erp verify` warns about edited vendor files
    (`--strict` fails on them).

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
pnpm erp ui-sync            # after adding/removing a module or an ext/ui.ts
pnpm erp doctor             # installation: is the vendor base intact? what has this company added?
pnpm erp upgrade <release-folder> [--apply]   # installation: take a GO Along release; ext/ and own modules are never touched
<!-- erp:internal:start -->
pnpm test:ui                # builds the web app, then drives it in Chromium against a real installation
pnpm uat:pack               # rerun all tests + the 22 UAT cases with screenshots, rebuild docs/uat/uat-pack.html
<!-- erp:internal:end -->
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
A status list can be a drag-and-drop kanban: `display: 'board'` + `board: { field, lanes, moves }` — `moves` names the detail screen's
own actions (drag = the same endpoint + dialog as the button). A form with `aiFill: { kind, label, hint }` is filled from a photo/PDF by AI
(the person saves); its list then offers "create from documents" for many files. Both are data — no module-specific React.
Full reference: docs/ui.md. A module can also declare `widgets` (home dashboard: kpi/bars/pipeline/trend/floor3d/feed),
`commands` (Thai ⌘K commands that prefill forms), `search` (palette record search) and `notifications` (the bell).
The AI assistant (`apps/web/src/app/assist`) reads only GET endpoints declared there, with the user's token, and never writes.

Tests boot the real service against a fresh database as the non-superuser `erp_app`, so RLS is really enforced.
Use `bootTestService(definition)` → `t.api(method, url, body, { token: t.token(perms, tenantId) })`, `t.deliver(type, data)`, `t.published(type)`.

## Definition of done for any change

- `pnpm check` passes (typecheck, unit + e2e tests, verify). In an installation: `pnpm erp doctor` says the vendor base is intact.
- New behaviour has a test (vendor: the module's `test/`; customer: `ext/test/`), including a permission test and a tenant-isolation check for new tables.
- Vendor: `module.json` and the module's `CLAUDE.md` describe any new endpoint, permission or event. Customer: `ext/ext.json` (`description` too) and `CUSTOM.md`.
- A new endpoint users need has a screen or action in `src/ui.ts` (and `mobile: true` if it is shop-floor work).
