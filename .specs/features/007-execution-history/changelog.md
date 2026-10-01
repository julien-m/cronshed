# Changelog — Execution History

## 2026-10-01 — Bugfix: deterministic ANSI formatter tests

- **Type:** Bugfix
- **Spec modified:** No
- **Code modified:** Updated [`src/cli/cli.formatter.test.ts`](../../../src/cli/cli.formatter.test.ts) to control `NO_COLOR` explicitly and cover plain history output.
- **AC impacted:** AC-003
- **Author:** Codex CI Guardian

## 2026-03-30 — [Feature]: Execution History implemented

- **Type:** Feature
- **Spec modified:** Yes (sections: status → Implemented)
- **Code modified:** log.types.ts, log.service.ts, cli.formatter.ts, cli.handler.ts, log.service.test.ts, cli.formatter.test.ts, cli.integration.test.ts
- **AC impacted:** AC-001 through AC-013 (all)
- **Author:** tool (spec.feature --auto)
