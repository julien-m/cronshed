# cronshed

> Full visibility into your cron jobs — execution history, error tracking, next-run calculation, and Telegram alerts on failure.

`crontab -l` is opaque. **cronshed** replaces it with a structured task manifest and a rich CLI so you always know what's running, when it last ran, and whether it failed.

---

## Install

```bash
bun install
```

Make the CLI available system-wide (optional):

```bash
ln -s $(pwd)/index.ts /usr/local/bin/cronshed
```

---

## Quick start

```bash
# Add a task
cronshed add backup-db --schedule "0 2 * * *" --command "/scripts/backup.sh"

# List tasks with status
cronshed list

# Show full details for a task
cronshed get backup-db

# View the last 10 executions
cronshed history backup-db

# Run a task immediately
cronshed run backup-db
```

---

## Commands

| Command | Description |
|---------|-------------|
| `add <name> --schedule '<cron>' --command '<cmd>'` | Add a new task |
| `list [--tag <tag>] [--json]` | List all tasks with status |
| `get <name> [--json]` | Show full task details |
| `update <name> [--schedule] [--command] [--notify\|--no-notify] [--tag] [--untag]` | Update a task |
| `remove <name>` | Delete a task |
| `pause <name>` | Pause a task (removes from crontab) |
| `resume <name>` | Resume a paused task |
| `history <name> [--limit N] [--json]` | Show execution history |
| `tags [--json]` | List all tags with task counts |
| `sync [--dry-run] [--clear]` | Sync tasks to crontab |
| `doctor [name] [--json]` | Diagnose task configuration issues |
| `import [--dry-run] [--prefix <name>]` | Import existing crontab entries |
| `rotate [name] [--max-age <days>] [--max-entries <N>] [--dry-run]` | Rotate execution logs |
| `run <name> [--json]` | Run a task immediately with live output |

Use `--no-sync` on any mutation command to skip the automatic crontab sync.

---

## Features

- **Task manifest** — `tasks.json` is the single source of truth, human-readable and editable
- **Execution history** — every run is logged to a `.jsonl` file (timestamp, exit code, stdout, stderr, duration)
- **Status enrichment** — `list` shows last run time, exit code, next scheduled run, and status
- **Failure notifications** — add `--notify` to a task; failures trigger a Telegram alert via `cc-hub`
- **Task groups** — tag tasks with `--tag <name>` and filter with `list --tag <name>`
- **Diagnosis** — `doctor` checks wrapper presence, crontab sync state, and recent failures
- **Import** — bring existing crontab entries under cronshed management
- **Log rotation** — `rotate` removes old entries by age or count
- **Dry-run mode** — preview sync changes or rotation results before applying

---

## Data directory

By default, data is stored in `~/.cronshed/`:

```
~/.cronshed/
├── tasks.json          # task manifest
├── wrappers/           # generated bash wrapper scripts
│   └── <task>.sh
└── logs/               # execution logs (JSON Lines)
    └── <task>.jsonl
```

Override with the `CRONSHED_HOME` environment variable.

---

## Development

```bash
# Run tests
bun test

# Type check
bun run typecheck
```

