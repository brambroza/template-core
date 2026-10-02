---
description: Apply a GO Along release to a customized installation
argument-hint: <path to new release>
---
Upgrade this installation using the release at: $ARGUMENTS

1. Replace `packages/*` and `apps/gateway` wholesale with the release versions (customers must not have changed them; if `git diff` shows local edits there, list them and stop to ask).
2. For each `services/<module>` present here: copy NEW migration files from the release, then port code changes from the release's CHANGELOG/diff onto the local (possibly customized) code, keeping local customizations.
3. Run `pnpm install && pnpm check`; fix until green. Summarize what changed and anything that needs a human decision.
