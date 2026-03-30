# .specs — Cronshed

> Specification registry for Cronshed. All artifacts produced by LiveSpec are indexed here.
>
> Last updated: 2026-03-30 (007-execution-history)

---

## System Files

| Document | Description |
|---|---|
| [spec-system.md](spec-system.md) | Universal spec rules (read first) |
| [constitution.md](constitution.md) | Architecture principles |
| [project.md](project.md) | Project profile (vision, users, constraints) |
| [stacks/_default.md](stacks/_default.md) | Current tech stack |
| [testing/strategy.md](testing/strategy.md) | Testing strategy |
| [changelog.md](changelog.md) | Global changelog |
| [roadmap.md](roadmap.md) | Feature backlog (MVP / Post-MVP / Future) |

---

## Design

| Document | Description |
|---|---|
| [design/](design/) | UI mockups and screen references |
| [design/changelog.md](design/changelog.md) | Design change history |

---

## Features

<!-- readme:features:start -->
| # | Feature | Status | Created | Updated | Spec |
|---|---|---|---|---|---|
| 001 | Task Manifest & CRUD | Implemented | 2026-03-30 | 2026-03-30 | [spec](features/001-task-manifest/spec.md) |
| 002 | Command Path Resolution | Implemented | 2026-03-30 | 2026-03-30 | [spec](features/002-command-path-resolution/spec.md) |
| 003 | Crontab Sync | Implemented | 2026-03-30 | 2026-03-30 | [spec](features/003-crontab-sync/spec.md) |
| 004 | Auto-Sync | Implemented | 2026-03-30 | 2026-03-30 | [spec](features/004-auto-sync/spec.md) |
| 005 | Wrapper Script Generation | Implemented | 2026-03-30 | 2026-03-30 | [spec](features/005-wrapper-script-generation/spec.md) |
| 006 | Task Listing & Status | Implemented | 2026-03-30 | 2026-03-30 | [spec](features/006-task-listing-status/spec.md) |
| 007 | Execution History | Implemented | 2026-03-30 | 2026-03-30 | [spec](features/007-execution-history/spec.md) |
<!-- readme:features:end -->

---

## Architecture Decisions

<!-- readme:decisions:start -->
| ADR | Decision | Date | Status |
|---|---|---|---|
| [ADR-001](stacks/decisions/ADR-001-flat-json-over-sqlite.md) | Flat JSON file over SQLite | 2026-03-30 | Accepted |
| [ADR-002](stacks/decisions/ADR-002-cron-parser-over-manual.md) | cron-parser over manual parsing | 2026-03-30 | Accepted |
<!-- readme:decisions:end -->

---

## Recent Activity

> Latest entries from [changelog.md](changelog.md).

<!-- readme:activity:start -->
| Date | Type | Description |
|---|---|---|
| 2026-03-30 | Feature | [007] Implemented: Execution History — 5 stories, 13 AC, 10 FR, 223 tests |
| 2026-03-30 | Feature | [006] Implemented: Task Listing & Status — 5 stories, 12 AC, 11 FR, 193 tests |
| 2026-03-30 | Feature | [005] Implemented: Wrapper Script Generation — 6 stories, 13 AC, 11 FR, 39 tests |
| 2026-03-30 | Feature | [004] Implemented: Auto-Sync — 4 stories, 8 AC, 7 FR, 131 tests |
| 2026-03-30 | Feature | [003] Implemented: Crontab Sync — 3 stories, 12 AC, 9 FR, 31 tests |
| 2026-03-30 | Spec | [001] Spec created: Task Manifest & CRUD — 5 stories, 15 AC, 8 FR |
| 2026-03-30 | Setup | LiveSpec initialized |
<!-- readme:activity:end -->

---

*Maintained automatically by LiveSpec commands. Do not remove section markers.*
