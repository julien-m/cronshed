---
updated: 2026-03-30
---

# Stack — Cronshed

> Local CLI tool for cron job management. No cloud, no server, no UI.

## Chosen Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Bun | Native TypeScript, fast startup, built-in test runner |
| Language | TypeScript (strict) | Type safety for cron expressions and task config |
| CLI parsing | `parseArgs` (node:util) | Zero deps, native, sufficient for simple CLI |
| Storage | `tasks.json` flat file | Single-user, no concurrent writes, human-readable |
| Cron parsing | `cron-parser` | Next-execution calculation, expression validation, DST handling |
| Notifications | `cc-hub telegram send` | Already available globally, zero setup |
| File I/O | `Bun.file()` | Native Bun API, faster than node:fs |
| <!-- Dev Tooling --> | | |
| Package Manager | bun | Consistent with runtime |
| Testing | `bun:test` | Built-in, zero config, fast |
| Linter / Formatter | None | Small personal project, single dev — add Biome later if needed |

## What This Stack Does NOT Include

- **No database** — flat JSON file is sufficient for single-user
- **No server** — pure CLI, no HTTP endpoints
- **No auth** — local machine only
- **No cloud services** — everything runs locally
- **No CI/CD** — personal tool, manual deployment
- **No frontend** — terminal-only interface

## Key Constraints

- All data in `~/.cronshed/tasks.json` (or configurable path)
- Wrapper scripts in `~/.cronshed/tasks/` executed by crontab
- Crontab is the execution engine — Cronshed manages it, doesn't replace it
- `cc-hub` must be installed globally for Telegram notifications
