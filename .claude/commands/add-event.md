---
description: Connect two modules through a new or existing event
argument-hint: <publisher module> -> <subscriber module>: <what should happen>
---
Integrate: $ARGUMENTS

1. Check docs/events.md — reuse an existing event if one carries the needed facts.
2. New event: add a zod schema in packages/contracts/src/index.ts named `<module>.<past_tense_fact>`; only additive changes to existing events.
3. Publisher: `await k.emit(c, '<type>', data)` inside the same transaction as the business write; add to module.json `publishes`.
4. Subscriber: add a handler in `handlers` and the type to module.json `subscribes`. Handlers use `ctx.client` (already tenant-scoped) and must not throw for business reasons.
5. Tests: publisher asserts `t.published('<type>')`; subscriber uses `t.deliver('<type>', data)` incl. a duplicate delivery. Add a step to tests/e2e if both modules are present there.
6. Update docs/events.md and both modules' CLAUDE.md. `pnpm check`.
