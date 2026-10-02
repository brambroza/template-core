---
description: Add a feature to an existing module safely
argument-hint: <module> <feature description>
---
Add this feature: $ARGUMENTS

1. Read CLAUDE.md (root) and `services/<module>/CLAUDE.md`, then the module's src/ and test/.
2. Schema changes → NEW file `services/<module>/migrations/00N_<name>.sql` (never edit applied migrations; new tables need `tenant_id` + `-- @tenant`).
3. Implement routes with the standard pattern; new permissions go in module.json.
4. Touching another module's data? Don't. Publish/subscribe an event instead (see docs/events.md).
5. Write tests first for the new behaviour (+ a 403 test), then make them pass.
6. Update the module's CLAUDE.md (data, API, events).
7. `pnpm check` must be green.
