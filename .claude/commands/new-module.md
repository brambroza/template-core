---
description: Create a new independently sellable ERP module
argument-hint: <id> <what it does>
---
Create a new module: $ARGUMENTS

1. Read CLAUDE.md (root) and one similar module's CLAUDE.md + src/service.ts as the reference pattern.
2. Run `pnpm erp new-module <id> --name "<English>" --name-th "<ไทย>"` then `pnpm install`.
3. Replace the placeholder `records` table with the real tables in `migrations/001_init.sql` (every table: `tenant_id` + `-- @tenant <table>`).
4. Write routes in `src/service.ts` following the route pattern (auth → requirePerm → parse → k.db.tx). Declare permissions in module.json.
5. If it must react to other modules, subscribe to existing events (module.json `subscribes` + `handlers`) — never import other modules. New events: add the schema to packages/contracts first.
6. Tests in `test/`: happy path, status/validation errors, a 403 permission check, tenant isolation; `t.deliver()` for each handler.
7. Screens: edit `src/ui.ts` (list/form/detail per business document; mark shop-floor screens `mobile: true`). Run `pnpm erp ui-sync`.
8. Fill in the module's CLAUDE.md. Add a price to catalog/catalog.json if this repo has one.
9. Run `pnpm check` (includes the UI contract test) and fix until green. Optionally `pnpm test:ui`.
