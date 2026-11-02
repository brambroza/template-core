---
description: Apply a GO Along release to a customized installation
argument-hint: <path to new release>
---
Upgrade this installation using the release at: $ARGUMENTS

1. `pnpm erp doctor` — note which vendor files this installation has edited (those are the only possible conflicts).
2. `pnpm erp upgrade $ARGUMENTS` (dry run) and read the plan. Then `pnpm erp upgrade $ARGUMENTS --apply`.
   It replaces every untouched vendor file, removes files the release dropped, and never touches `services/*/ext/`, the customer's own modules,
   `deploy/`, `CUSTOM.md` or `README.md`.
3. For each conflict (vendor file edited here AND changed by the release; the release copy is in `.erp/upgrade/<path>`):
   prefer moving the local edit into `services/<module>/ext/` (route, guard, handler, migration, ui.ts) and taking the release file as-is;
   only if that is impossible, merge the release changes into the local file. Delete `.erp/upgrade/` when done.
4. `pnpm install && pnpm erp ui-sync && pnpm check`; fix until green. An ext guard / ui patch that now fails points at something the release
   renamed — update the extension, not the vendor code.
5. Summarize: what the release changed, which conflicts were resolved how, anything that needs a human decision. Finish with `pnpm erp doctor`.
