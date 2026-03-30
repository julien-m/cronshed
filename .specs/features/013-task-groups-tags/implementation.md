# Implementation — 013 Task Groups/Tags

## Requirement Mapping

| Requirement | File(s) | @spec Anchor | Status | Last Verified |
|-------------|---------|-------------|--------|---------------|
| FR-001 | `src/task/task.types.ts` | `@spec FR-001: Tags field on Task` | ✅ Implemented | 2026-03-30 |
| FR-002 | `src/task/task.types.ts` | `@spec FR-002: CreateTaskInput with tags` | ✅ Implemented | 2026-03-30 |
| FR-003 | `src/task/task.types.ts` | `@spec FR-003: UpdateTaskInput with tags/untags` | ✅ Implemented | 2026-03-30 |
| FR-004 | `src/task/task.service.ts` | `@spec FR-004: Validate tags on add` | ✅ Implemented | 2026-03-30 |
| FR-005 | `src/task/task.service.ts` | `@spec FR-005: Tag/untag on update`, `@spec FR-005: Apply tag additions and removals` | ✅ Implemented | 2026-03-30 |
| FR-006 | `src/task/task.repository.ts` | `@spec FR-006: Backward compat for tags field` | ✅ Implemented | 2026-03-30 |
| FR-007 | `src/task/task.types.ts` | `@spec FR-007: Tag validation uses same regex as task names` | ✅ Implemented | 2026-03-30 |
| FR-008 | `src/task/task.errors.ts` | `@spec FR-008: InvalidTagError` | ✅ Implemented | 2026-03-30 |
| FR-009 | `src/cli/cli.handler.ts` | `@spec FR-009: Parse --tag flags on add` | ✅ Implemented | 2026-03-30 |
| FR-010 | `src/cli/cli.handler.ts` | `@spec FR-010: Parse --tag and --untag flags on update` | ✅ Implemented | 2026-03-30 |
| FR-011 | `src/cli/cli.handler.ts` | `@spec FR-011: List filter by tag`, `@spec FR-011: Filter tasks by tag` | ✅ Implemented | 2026-03-30 |
| FR-012 | `src/cli/cli.handler.ts`, `src/cli/cli.formatter.ts` | `@spec FR-012: Tags subcommand`, `@spec FR-012: Tags table formatting` | ✅ Implemented | 2026-03-30 |
| FR-013 | `src/cli/cli.formatter.ts` | `@spec FR-013: Display tags in task details` | ✅ Implemented | 2026-03-30 |
| FR-014 | `src/cli/cli.formatter.ts` | `@spec FR-014: Tags column in task table` | ✅ Implemented | 2026-03-30 |
| FR-015 | `src/cli/cli.handler.ts` | `@spec FR-015: Help text with tag flags` | ✅ Implemented | 2026-03-30 |

## Acceptance Criteria Mapping

| AC | Test File | Status |
|----|-----------|--------|
| AC-001 | `task.service.test.ts`, `cli.integration.test.ts` | ✅ |
| AC-002 | `task.service.test.ts`, `cli.integration.test.ts` | ✅ |
| AC-003 | `task.service.test.ts` | ✅ |
| AC-004 | `task.service.test.ts`, `cli.integration.test.ts` | ✅ |
| AC-005 | `task.service.test.ts`, `cli.integration.test.ts` | ✅ |
| AC-006 | `task.service.test.ts`, `cli.integration.test.ts` | ✅ |
| AC-007 | `task.service.test.ts`, `cli.integration.test.ts` | ✅ |
| AC-008 | `cli.integration.test.ts` | ✅ |
| AC-009 | `cli.integration.test.ts` | ✅ |
| AC-010 | `cli.integration.test.ts` | ✅ |
| AC-011 | `cli.integration.test.ts` | ✅ |
| AC-012 | `cli.integration.test.ts` | ✅ |
| AC-013 | `task.service.test.ts`, `cli.integration.test.ts` | ✅ |
| AC-014 | `task.service.test.ts`, `cli.integration.test.ts` | ✅ |

## Files Created/Modified

| File | Action | Description |
|------|--------|-------------|
| `src/task/task.types.ts` | Modified | Added `tags: string[]` to Task, `tags?` to CreateTaskInput, `tags?`/`untags?` to UpdateTaskInput, TAG_REGEX, normalizeTags() |
| `src/task/task.errors.ts` | Modified | Added InvalidTagError class |
| `src/task/task.service.ts` | Modified | Tag validation/dedup in add(), tag/untag logic in update() |
| `src/task/task.repository.ts` | Modified | Backward compat: default missing tags to [] |
| `src/cli/cli.handler.ts` | Modified | --tag on add, --tag/--untag on update, --tag filter on list, new handleTags, help text, error mapping |
| `src/cli/cli.formatter.ts` | Modified | Tags in formatTaskDetails, TAGS column in formatTaskTable, new formatTagsTable |
| `src/task/task.service.test.ts` | Modified | 17 new unit tests for tag operations |
| `src/cli/cli.integration.test.ts` | Modified | 20 new integration tests for CLI tag features |
| `src/cli/cli.formatter.test.ts` | Modified | Added tags field to test fixtures |
| `src/crontab/sync.service.test.ts` | Modified | Added tags field to test fixture |
| `src/diagnosis/diagnosis.service.test.ts` | Modified | Added tags field to test fixture |
| `src/task/task.repository.test.ts` | Modified | Added tags field to test fixtures |
