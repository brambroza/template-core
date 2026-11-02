---
description: Add a feature to an existing module safely
argument-hint: <module> <feature description>
---
Add this feature: $ARGUMENTS

In a customer installation (there is a `.erp/vendor-lock.json`) do NOT edit the module itself — use `/extend` instead.
These steps are for GO Along's own source repo (the vendor base).

1. Read CLAUDE.md (root) and `services/<module>/CLAUDE.md`, then the module's src/ and test/.
2. Schema changes → NEW file `services/<module>/migrations/00N_<name>.sql` (never edit applied migrations; new tables need `tenant_id` + `-- @tenant`).
3. Implement routes with the standard pattern; new permissions go in module.json.
4. Touching another module's data? Don't. Publish/subscribe an event instead (see docs/events.md).
5. Write tests first for the new behaviour (+ a 403 test), then make them pass.
6. Add/extend screens in `src/ui.ts` so users can reach the feature (endpoints must match the routes exactly).
7. Update the module's CLAUDE.md (data, API, events, screens).
8. `pnpm check` must be green.
