# Implementation: Failure Notifications

- **Feature:** 008-failure-notifications
- **Date:** 2026-03-30
- **Status:** Implemented

---

## Requirement Mapping

| Requirement | File(s) | @spec Anchor | Status | Last Verified |
|-------------|---------|-------------|--------|---------------|
| FR-047 | `src/task/task.types.ts`, `src/task/task.service.ts`, `src/task/task.repository.ts` | `@spec FR-047` | ✅ Implemented | 2026-03-30 |
| FR-048 | `src/wrapper/wrapper.service.ts` | `@spec FR-048` | ✅ Implemented | 2026-03-30 |
| FR-049 | `src/wrapper/wrapper.service.ts`, `src/wrapper/wrapper.types.ts` | `@spec FR-049` | ✅ Implemented | 2026-03-30 |
| FR-050 | `src/wrapper/wrapper.service.ts` | `@spec FR-050` | ✅ Implemented | 2026-03-30 |
| FR-051 | `src/cli/cli.handler.ts` | `@spec FR-051` | ✅ Implemented | 2026-03-30 |
| FR-052 | `src/cli/cli.handler.ts` | `@spec FR-052` | ✅ Implemented | 2026-03-30 |
| FR-053 | `src/crontab/sync.service.ts`, `src/wrapper/wrapper.service.ts` | `@spec FR-053` | ✅ Implemented | 2026-03-30 |
| FR-054 | `src/cli/cli.formatter.ts` | `@spec FR-054` | ✅ Implemented | 2026-03-30 |
| FR-055 | (automatic via JSON.stringify) | — | ✅ Implemented | 2026-03-30 |

## Acceptance Criteria Mapping

| AC | Test File | Status |
|----|-----------|--------|
| AC-063 | `src/wrapper/wrapper.integration.test.ts` | ✅ |
| AC-064 | `src/wrapper/wrapper.integration.test.ts` | ✅ |
| AC-065 | `src/wrapper/wrapper.integration.test.ts` | ✅ |
| AC-066 | `src/task/task.service.test.ts` | ✅ |
| AC-067 | `src/wrapper/wrapper.integration.test.ts` | ✅ |
| AC-068 | `src/task/task.service.test.ts` | ✅ |
| AC-069 | `src/task/task.service.test.ts` | ✅ |
| AC-070 | `src/wrapper/wrapper.service.test.ts` | ✅ |
| AC-071 | `src/wrapper/wrapper.service.test.ts` | ✅ |
| AC-072 | `src/crontab/sync.service.test.ts` | ✅ |
| AC-073 | `src/cli/cli.formatter.test.ts` | ✅ |
| AC-074 | (automatic via JSON.stringify) | ✅ |

## Files Created/Modified

**Modified:**
- `src/task/task.types.ts` — Added `notify: boolean` to Task, optional in CreateTaskInput/UpdateTaskInput
- `src/task/task.service.ts` — Handle notify in add/update
- `src/task/task.repository.ts` — Backward compat: default notify=false for old manifests
- `src/wrapper/wrapper.service.ts` — Added NOTIFY_BLOCK, conditional insertion in buildScript
- `src/wrapper/wrapper.types.ts` — Added notify to WrapperConfig, NOTIFY_STDERR_MAX_CHARS constant
- `src/cli/cli.handler.ts` — Added --notify/--no-notify flags to add/update, wrapper regeneration on notify change
- `src/cli/cli.formatter.ts` — Added Notify: on/off to formatTaskDetails
- `src/crontab/sync.service.test.ts` — Updated test fixture with notify field
- `src/cli/cli.formatter.test.ts` — Added notify display tests
- `src/wrapper/wrapper.integration.test.ts` — Added notification integration tests
