---
name: shed
description: Reference for the shed CLI (cronshed) — cron job management with execution history, error tracking, next-run calculation, and Telegram alerts. Use when working with cron jobs, task scheduling, or the shed command.
---

# shed CLI Reference

> Full visibility into your cron jobs — execution history, error tracking, next-run calculation, and Telegram alerts on failure.

**Binary:** `shed`
**Runtime:** Bun
**Data directory:** `~/.cronshed/` (override with `$CRONSHED_HOME`)

```
~/.cronshed/
├── tasks.json          # task manifest (single source of truth)
├── wrappers/           # generated bash wrapper scripts
│   └── <task>.sh
└── logs/               # execution logs (JSON Lines)
    └── <task>.jsonl
```

---

## Quick Start

```bash
# Add a task
shed add backup-db --schedule "0 2 * * *" --command "/scripts/backup.sh"

# List tasks with status
shed list

# Show full details
shed get backup-db

# View execution history
shed history backup-db

# Run immediately
shed run backup-db

# Diagnose issues
shed doctor
```

---

## Commands

### Task CRUD

#### `add <name> --schedule '<cron>' --command '<cmd>'`

Create a new task.

| Flag | Description |
|------|-------------|
| `--schedule <cron>` | Cron expression (required) |
| `--command <cmd>` | Command to execute (required) |
| `--notify` | Enable Telegram alerts on failure |
| `--tag <tag>` | Add tag (repeatable) |
| `--no-sync` | Skip automatic crontab sync |

```bash
shed add cleanup --schedule "*/30 * * * *" --command "echo cleanup" --notify --tag maintenance
```

#### `update <name>`

Update task properties. At least one option required.

| Flag | Description |
|------|-------------|
| `--schedule <cron>` | New cron expression |
| `--command <cmd>` | New command |
| `--notify` | Enable notifications |
| `--no-notify` | Disable notifications |
| `--tag <tag>` | Add tag (repeatable) |
| `--untag <tag>` | Remove tag (repeatable) |
| `--no-sync` | Skip automatic crontab sync |

```bash
shed update backup-db --schedule "0 3 * * *" --notify --tag database
```

#### `remove <name>`

Delete a task and its wrapper. Logs are preserved.

| Flag | Description |
|------|-------------|
| `--no-sync` | Skip automatic crontab sync |

#### `pause <name>`

Pause a task (removes from crontab, keeps in manifest).

| Flag | Description |
|------|-------------|
| `--no-sync` | Skip automatic crontab sync |

#### `resume <name>`

Resume a paused task.

| Flag | Description |
|------|-------------|
| `--no-sync` | Skip automatic crontab sync |

---

### Task Queries

#### `list`

List all tasks with enriched status (last run, exit code, next run).

| Flag | Description |
|------|-------------|
| `--tag <tag>` | Filter by tag |
| `--json` | JSON output |

#### `get <name>`

Show full task details.

| Flag | Description |
|------|-------------|
| `--json` | JSON output |

#### `history <name>`

Show execution history (most recent first).

| Flag | Description |
|------|-------------|
| `--limit <N>` | Number of entries (default: 10) |
| `--json` | JSON output |

#### `tags`

List all tags with task counts.

| Flag | Description |
|------|-------------|
| `--json` | JSON output |

---

### Operations

#### `sync`

Synchronize task manifest to system crontab.

| Flag | Description |
|------|-------------|
| `--dry-run` | Show diff without applying |
| `--clear` | Remove all cronshed entries from crontab |

#### `doctor [name]`

Diagnose task issues (wrapper presence, crontab sync state, recent failures).

| Flag | Description |
|------|-------------|
| `--json` | JSON output |

Exit code 1 if issues found. Without `[name]`, checks all tasks.

#### `import`

Import existing crontab entries into cronshed.

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview without creating |
| `--prefix <name>` | Add prefix to imported task names |

#### `rotate [name]`

Rotate execution logs.

| Flag | Description |
|------|-------------|
| `--max-age <days>` | Remove entries older than N days (default: 30) |
| `--max-entries <N>` | Keep only last N entries (default: 100) |
| `--dry-run` | Preview removals |
| `--json` | JSON output |

Without `[name]`, rotates all tasks.

#### `run <name>`

Execute a task immediately with live output streaming.

| Flag | Description |
|------|-------------|
| `--json` | JSON summary output (`{taskName, exitCode, durationMs}`) |

Exit code matches the task's exit code.

---

## Universal Flags

| Flag | Scope | Description |
|------|-------|-------------|
| `--no-sync` | Mutations (add, update, remove, pause, resume) | Skip automatic crontab sync |
| `--json` | Queries + some ops (list, get, history, tags, doctor, rotate, run) | Machine-readable output |
| `--dry-run` | sync, import, rotate | Preview changes without applying |
| `-h`, `--help` | All | Show help |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (task not found, already exists, state violations) |
| 2 | Bad input (invalid cron, missing arguments, invalid names/tags) |
| 3 | Config/filesystem error (permissions, corrupted file, crontab access) |

On error: stdout is always empty. Do not parse stdout on non-zero exit.

---

## Conventions

- **Task names:** lowercase kebab-case (`a-z0-9-`)
- **Tag names:** lowercase kebab-case
- **Cron expressions:** standard 5-field format (minute hour day month weekday)
- **Command paths:** supports `./`, `../`, `~/`, `/` prefixes — resolved and validated
- **Auto-sync:** mutations automatically sync to crontab unless `--no-sync`
- **Notifications:** failures trigger Telegram alerts via `cc-hub telegram send` when `--notify` is set

---

## Data Model

```typescript
interface Task {
  id: string;
  name: string;           // lowercase kebab-case
  schedule: string;       // cron expression
  command: string;        // resolved command path
  status: 'active' | 'paused';
  notify: boolean;
  tags: string[];
  createdAt: string;      // ISO 8601
  updatedAt?: string;     // ISO 8601
}
```

---

## Examples

```bash
# Add a task with notifications and tags
shed add db-backup --schedule "0 2 * * *" --command "~/scripts/backup.sh" --notify --tag database --tag critical

# List only database tasks
shed list --tag database

# Check health of all tasks
shed doctor

# Preview what sync would do
shed sync --dry-run

# Import existing crontab with prefix
shed import --prefix legacy --dry-run

# Rotate logs older than 7 days
shed rotate --max-age 7

# Run a task and capture JSON result
shed run db-backup --json
```
