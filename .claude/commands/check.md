---
description: Run all checks and fix failures
---
Run `pnpm check` (typecheck + every module's tests + e2e + `pnpm erp verify`).
For each failure: find the root cause, fix it in the smallest way that keeps the hard rules in CLAUDE.md, re-run. Never delete or weaken a test to make it pass; never edit an applied migration.
