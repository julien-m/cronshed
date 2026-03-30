# .specs — Cronshed

> Specification registry for Cronshed. All artifacts produced by LiveSpec are indexed here.
>
> Last updated: 2026-03-30 (003-crontab-sync)

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
| 2026-03-30 | Feature | [003] Implemented: Crontab Sync — 3 stories, 12 AC, 9 FR, 31 tests |
| 2026-03-30 | Spec | [001] Spec created: Task Manifest & CRUD — 5 stories, 15 AC, 8 FR |
| 2026-03-30 | Setup | LiveSpec initialized |
<!-- readme:activity:end -->

---

*Maintained automatically by LiveSpec commands. Do not remove section markers.*
