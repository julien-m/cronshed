# Implementation: Task Diagnosis

- **Feature:** Task Diagnosis
- **Feature Number:** 010
- **Date:** 2026-03-30
- **Status:** Implemented

---

## Requirement Mapping

| Requirement | File(s) | @spec Anchor | Status | Last Verified |
|-------------|---------|-------------|--------|---------------|
| FR-063 | `src/diagnosis/diagnosis.service.ts` | `@spec FR-063` | ✅ Implemented | 2026-03-30 |
| FR-064 | `src/diagnosis/diagnosis.service.ts` | `@spec FR-064` | ✅ Implemented | 2026-08-13 |
| FR-065 | `src/diagnosis/diagnosis.service.ts` | `@spec FR-065` | ✅ Implemented | 2026-03-30 |
| FR-066 | `src/diagnosis/diagnosis.service.ts` | `@spec FR-066` | ✅ Implemented | 2026-03-30 |
| FR-067 | `src/diagnosis/diagnosis.service.ts` | `@spec FR-067` | ✅ Implemented | 2026-03-30 |
| FR-068 | `src/diagnosis/diagnosis.types.ts` | `@spec FR-068` | ✅ Implemented | 2026-03-30 |
| FR-069 | `src/cli/cli.handler.ts` | `@spec FR-069` | ✅ Implemented | 2026-03-30 |
| FR-070 | `src/cli/cli.formatter.ts` | `@spec FR-070` | ✅ Implemented | 2026-03-30 |
| FR-071 | `src/cli/cli.handler.ts` | `@spec FR-069` | ✅ Implemented | 2026-03-30 |
| FR-072 | `src/cli/cli.handler.ts` | `@spec FR-069` | ✅ Implemented | 2026-03-30 |
| FR-073 | `src/cli/cli.handler.ts` | `@spec FR-073` | ✅ Implemented | 2026-03-31 |

---

## Acceptance Criteria Mapping

| AC | Test File | Status |
|----|-----------|--------|
| AC-001 | `src/diagnosis/diagnosis.service.test.ts`, `src/cli/cli.integration.test.ts` | ✅ |
| AC-002 | `src/cli/cli.integration.test.ts` | ✅ |
| AC-003 | `src/cli/cli.integration.test.ts` | ✅ |
| AC-004 | `src/diagnosis/diagnosis.service.test.ts` | ✅ |
| AC-005 | `src/diagnosis/diagnosis.service.test.ts` | ✅ |
| AC-006 | `src/diagnosis/diagnosis.service.test.ts` | ✅ |
| AC-007 | `src/diagnosis/diagnosis.service.test.ts` | ✅ |
| AC-008 | `src/diagnosis/diagnosis.service.test.ts` | ✅ |
| AC-009 | `src/diagnosis/diagnosis.service.test.ts` | ✅ |
| AC-010 | `src/diagnosis/diagnosis.service.test.ts` | ✅ |
| AC-011 | `src/diagnosis/diagnosis.service.test.ts` | ✅ |
| AC-012 | `src/diagnosis/diagnosis.service.test.ts` | ✅ |
| AC-013 | `src/diagnosis/diagnosis.service.test.ts`, `src/cli/cli.integration.test.ts` | ✅ |
| AC-014 | `src/cli/cli.integration.test.ts` | ✅ |
| AC-015 | `src/diagnosis/diagnosis.service.test.ts`, `src/cli/cli.integration.test.ts` | ✅ |

---

## Files Created

| File | Description |
|------|-------------|
| `src/diagnosis/diagnosis.types.ts` | DiagnosisResult, DiagnosisIssue, IssueSeverity types and check constants |
| `src/diagnosis/diagnosis.service.ts` | DiagnosisService with 5 checks: cron, command file, wrapper, crontab entry |
| `src/diagnosis/diagnosis.service.test.ts` | 22 unit tests for DiagnosisService |

## Files Modified

| File | Description |
|------|-------------|
| `src/cli/cli.handler.ts` | Added `handleDoctor` standalone command, updated help text |
| `src/cli/cli.formatter.ts` | Added `formatDiagnosisReport()` and `formatDiagnosisSummary()` |
| `src/cli/cli.integration.test.ts` | Added 11 integration tests for `cronshed doctor` |
