# Changelog — Task Listing & Status

## 2026-08-13 — Bugfix: cron-parser v5 compatibility

- **Type:** Bugfix
- **Spec modified:** No
- **Code modified:** Updated [`src/cron/cron.service.ts`](../../../src/cron/cron.service.ts) to use the cron-parser v5 parser API.
- **AC impacted:** AC-008 behavior preserved
- **Author:** Codex CI Guardian

## 2026-03-30 — [Feature]: Implemented task listing & status enrichment

- **Type:** Feature
- **Spec modified:** No
- **Code modified:** cron.service.ts, cli.handler.ts, cli.formatter.ts, task.types.ts, log.service.ts (new), log.types.ts (new)
- **AC impacted:** AC-001 through AC-012
- **Author:** tool (spec.feature --auto)
