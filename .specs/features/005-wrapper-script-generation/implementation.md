# Implementation — Wrapper Script Generation (005)

## Requirement Mapping

| Requirement | File(s) | @spec Anchor | Status | Last Verified |
|---|---|---|---|---|
| FR-036 | `src/wrapper/wrapper.service.ts` | `@spec FR-036` | Implemented | 2026-03-30 |
| FR-037 | `src/wrapper/wrapper.service.ts` | `@spec FR-037` | Implemented | 2026-03-30 |
| FR-038 | `src/wrapper/wrapper.types.ts`, `src/wrapper/wrapper.service.ts` | `@spec FR-038` | Implemented | 2026-03-30 |
| FR-039 | `src/wrapper/wrapper.service.ts`, `src/app/config.ts` | `@spec FR-039` | Implemented | 2026-03-30 |
| FR-040 | `src/wrapper/wrapper.service.ts` | `@spec FR-040` | Implemented | 2026-03-30 |
| FR-041 | `src/wrapper/wrapper.service.ts`, `src/app/config.ts` | `@spec FR-041` | Implemented | 2026-03-30 |
| FR-042 | `src/cli/cli.handler.ts` | `@spec FR-042` | Implemented | 2026-03-30 |
| FR-043 | `src/cli/cli.handler.ts` | `@spec FR-043` | Implemented | 2026-03-30 |
| FR-044 | `src/crontab/sync.service.ts`, `src/cli/cli.handler.ts` | `@spec FR-044` | Implemented | 2026-03-30 |
| FR-045 | `src/app/config.ts`, `src/wrapper/wrapper.service.ts` (script body) | `@spec FR-045` | Implemented | 2026-03-30 |
| FR-046 | `src/wrapper/wrapper.service.ts` (remove only deletes wrapper) | `@spec FR-046` | ✅ Implemented | 2026-03-31 |

## Acceptance Criteria Mapping

| AC | Test File | Status |
|---|---|---|
| AC-050 | `src/wrapper/wrapper.service.test.ts`, `src/wrapper/wrapper.integration.test.ts` | Passed |
| AC-051 | `src/wrapper/wrapper.service.test.ts`, `src/wrapper/wrapper.integration.test.ts` | Passed |
| AC-052 | `src/wrapper/wrapper.integration.test.ts` | Passed |
| AC-053 | `src/wrapper/wrapper.integration.test.ts` | Passed |
| AC-054 | `src/wrapper/wrapper.service.test.ts`, `src/wrapper/wrapper.integration.test.ts` | Passed |
| AC-055 | `src/wrapper/wrapper.integration.test.ts` | Passed |
| AC-056 | `src/wrapper/wrapper.service.test.ts`, `src/wrapper/wrapper.integration.test.ts` | Passed |
| AC-057 | `src/wrapper/wrapper.integration.test.ts` | Passed |
| AC-058 | `src/wrapper/wrapper.service.test.ts`, `src/wrapper/wrapper.integration.test.ts` | Passed |
| AC-059 | `src/wrapper/wrapper.integration.test.ts` | Passed |
| AC-060 | `src/wrapper/wrapper.integration.test.ts` | Passed |
| AC-061 | `src/wrapper/wrapper.integration.test.ts` | Passed |
| AC-062 | `src/wrapper/wrapper.service.test.ts`, `src/wrapper/wrapper.integration.test.ts` | Passed |

## Files Created/Modified

| File | Action | Description |
|---|---|---|
| `src/app/config.ts` | Modified | Added `getWrappersDir`, `getLogsDir`, `getWrapperPath`, `getLogPath` helpers |
| `src/app/config.test.ts` | Modified | Added tests for new path helpers |
| `src/wrapper/wrapper.types.ts` | Created | `WrapperConfig` interface, `MAX_OUTPUT_BYTES` constant |
| `src/wrapper/wrapper.errors.ts` | Created | `WrapperGenerationError` class |
| `src/wrapper/wrapper.service.ts` | Created | `WrapperService` with generate/remove/syncWrappers/buildScript |
| `src/wrapper/wrapper.service.test.ts` | Created | Unit tests for WrapperService (16 tests) |
| `src/wrapper/wrapper.integration.test.ts` | Created | Integration tests for full wrapper lifecycle (23 tests) |
| `src/cli/cli.handler.ts` | Modified | Wired WrapperService into add/update/remove/sync handlers |
| `src/crontab/sync.service.ts` | Modified | Added optional WrapperService parameter, wrapper regeneration on sync |
