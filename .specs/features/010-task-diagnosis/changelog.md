# Changelog — Task Diagnosis

## 2026-08-13 — Bugfix: cron-parser v5 compatibility

- **Type:** Bugfix
- **Spec modified:** No
- **Code modified:** Updated [`src/diagnosis/diagnosis.service.ts`](../../../src/diagnosis/diagnosis.service.ts) to use the cron-parser v5 parser API.
- **AC impacted:** AC-004 behavior preserved
- **Author:** Codex CI Guardian

## 2026-03-30 — Feature: Task Diagnosis implemented

- **Type:** Feature
- **Spec modified:** Yes (status: Draft → Implemented)
- **Code modified:** diagnosis.types.ts, diagnosis.service.ts, cli.handler.ts, cli.formatter.ts
- **AC impacted:** AC-001 through AC-015
- **Author:** tool (spec.feature --auto)
