---
description: Extend an installed module for this company without touching GO Along's code
argument-hint: <module> <what the company needs>
---
Extend this installation: $ARGUMENTS

1. Read CLAUDE.md (root, "Where a change goes" + "Extension layer"), CUSTOM.md if present, and `services/<module>/CLAUDE.md`.
   Look at `docs/examples/purchasing-budget/ext/` — a complete, tested extension to copy the shape from.
2. Decide where it goes (table in CLAUDE.md). Whole new business area → stop and use `/new-module` instead.
   Bug or behaviour change in the base → stop: describe it for GO Along, don't patch vendor files.
3. Work ONLY in `services/<module>/ext/` (create it if missing):
   - `ext.json` — `description` (one Thai line of what this company added), new `permissions` (`<module>.x_<thing>.<action>`), `subscribes`/`publishes` (existing events only)
   - `migrations/00N_x_<name>.sql` — new tables `x_…` with `tenant_id` + `-- @tenant x_…`; extra columns on vendor tables `add column x_…`. Append-only.
   - `index.ts` — `defineExtension({ routes, guards, handlers })`: routes under `/x/…` with auth → requirePerm → parse → `k.db.tx`;
     company rules as `guards` on the exact vendor route template (throw a kernel error with a Thai message to refuse);
     reactions to other modules' facts as `handlers` (idempotent, never throw for business reasons).
   - `ui.ts` — `defineUiExtension({ module, patch, hide, screens, menu })`: new columns/facts/actions on vendor screens, new `x…` screens. Then `pnpm erp ui-sync`.
4. Tests first in `ext/test/*.test.ts`: `bootTestService(definition)` (from `../../src/service.ts` or `@erp/svc-<module>`) boots the module with its extension.
   Cover the happy path, the guard refusing, a 403 for the new permission and tenant isolation of new tables.
5. Write what was added and why in CUSTOM.md (one short section).
6. `pnpm check` green, and `pnpm erp doctor` must say "Vendor base intact". If it lists a vendor file you changed, move that change into ext/ and restore the file.
