# Implementation — 015-wrapper-protections

- **Feature:** Wrapper Protections
- **Date:** 2026-04-13
- **Status:** Implemented

---

## FR/AC to Code Mapping

| FR | Description | File(s) | @spec Anchor |
|----|-------------|---------|--------------|
| FR-086 | Flock block injection in wrapper | src/wrapper/wrapper.service.ts | @spec FR-086 |
| FR-087 | Skip log entry format | src/wrapper/wrapper.service.ts (FLOCK_SKIP_BLOCK) | @spec FR-087 |
| FR-088 | Task/CreateTaskInput/UpdateTaskInput extended | src/task/task.types.ts | @spec FR-088 |
| FR-089 | Timeout tool detection | src/wrapper/wrapper.service.ts (detectTimeoutTool) | @spec FR-089 |
| FR-090 | Timeout wrapping in wrapper | src/wrapper/wrapper.service.ts, src/wrapper/duration.ts | @spec FR-090 |
| FR-091 | timedOut field in log entry | src/wrapper/wrapper.service.ts (TIMEOUT_LOG_PRINTF) | @spec FR-091 |
| FR-092 | ConfigService get/set with validation | src/config/config.service.ts, src/config/config.repository.ts | @spec FR-092 |
| FR-093 | Config CLI commands | src/cli/handlers/config.handler.ts, src/cli/cli.handler.ts | @spec FR-093 |
| FR-094 | Auto-compute timeout from ratio | Read [`src/wrapper/wrapper.service.ts`](../../../src/wrapper/wrapper.service.ts) (`WrapperService.generate()`, `computeTimeoutFromRatio`), [`src/cli/handlers/task-crud.handler.ts`](../../../src/cli/handlers/task-crud.handler.ts) (explicit timeout only), [`src/crontab/sync.service.ts`](../../../src/crontab/sync.service.ts) (passes schedule) | @spec FR-094 |
| FR-095 | Schedule interval calculation | src/cron/schedule-interval.ts | @spec FR-095 |
| FR-096 | Short-schedule warning | src/cli/handlers/task-crud.handler.ts | @spec FR-096 |
| FR-097 | PID written to lock file | src/wrapper/wrapper.service.ts (echo $$ > lock) | @spec FR-097 |
| FR-098 | Lock hash computation | src/wrapper/wrapper.service.ts (computeLockHash) | @spec FR-098 |
| FR-099 | Safe lock file naming via SHA-256 | src/wrapper/wrapper.service.ts (computeLockHash) | @spec FR-098 |

## AC Coverage

| AC | Description | Satisfied By |
|----|-------------|-------------|
| AC-075 | Flock --nonblock on lock file | buildScript() injects flock -n 9 block |
| AC-076 | Skip entry with skipped/skippedAt/reason/pidHolder | FLOCK_SKIP_BLOCK in wrapper.service.ts |
| AC-077 | Lock released on exit (flock fd) | ) 9>"$CRONSHED_LOCK_FILE" pattern |
| AC-078 | --allow-parallel stores allowParallel=true, no flock | handleAdd parses flag, buildScript skips flock |
| AC-079 | update --allow-parallel regenerates wrapper | handleUpdate detects allowParallel change |
| AC-080 | --timeout stores value, wrapper uses timeout tool | handleAdd validates + passes to generate() |
| AC-081 | Exit 124 produces timedOut=true | TIMEOUT_LOG_PRINTF checks $_exit_code -eq 124 |
| AC-082 | Missing timeout tool throws blocking error | detectTimeoutTool() throws TimeoutToolMissingError |
| AC-083 | Short-schedule warning to stderr | handleAdd checks interval <= 60s |
| AC-084 | config set validates 0 < ratio <= 1 | ConfigService.set() validation |
| AC-085 | Invalid ratio rejected | ConfigService.set() throws InvalidConfigValueError |
| AC-086 | Auto-timeout from ratio (min 10s) | WrapperService computes from current schedule during wrapper generation; derived values are not persisted |
| AC-087 | Explicit --timeout overrides ratio | handleAdd checks explicit timeout first |
| AC-088 | config get prints value or "not set" | handleConfigGet in config.handler.ts |
| AC-089 | Lock hash is sha256(configPath:taskName) | computeLockHash() |
| AC-090 | locks/ created by wrapper mkdir -p | buildScript() includes mkdir -p $CRONSHED_LOCK_DIR |
| AC-091 | Normal entries lack skip/timeout fields | Only added conditionally in bash |
| AC-092 | Auto-timeout requires timeout tool | detectTimeoutTool() called for ratio-computed timeout |

## Files Created

| File | Purpose |
|------|---------|
| src/wrapper/duration.ts | Parse duration strings (50s, 5m, 2h) to seconds |
| src/wrapper/duration.test.ts | Unit tests for duration parser |
| src/cron/schedule-interval.ts | Compute minimum interval between cron executions |
| src/cron/schedule-interval.test.ts | Unit tests for schedule interval |
| src/config/config.types.ts | CronshedConfig interface and key mapping |
| src/config/config.repository.ts | Read/write config.json |
| src/config/config.service.ts | Config get/set with validation |
| src/config/config.service.test.ts | Unit tests for config service and repository |
| src/cli/handlers/config.handler.ts | CLI handler for config set/get |
| src/wrapper/wrapper-protections.integration.test.ts | Integration tests for flock, timeout, combined |

## Files Modified

| File | What Changed |
|------|-------------|
| src/task/task.types.ts | Added allowParallel?, timeout? to Task, CreateTaskInput, UpdateTaskInput |
| src/wrapper/wrapper.types.ts | Added allowParallel, timeout?, lockFilePath?, locksDir? to WrapperConfig |
| src/wrapper/wrapper.errors.ts | Added TimeoutToolMissingError |
| Read [`src/wrapper/wrapper.service.ts`](../../../src/wrapper/wrapper.service.ts) | Flock block, stale-lock safety before kill, timeout wrapping, timedOut, detectTimeoutTool, ratio timeout calculation, computeLockHash |
| src/wrapper/wrapper.service.test.ts | Tests for flock, timeout, lock hash, combined |
| src/cli/cli.handler.ts | Registered config command, TimeoutToolMissingError exit code, help text |
| Read [`src/cli/handlers/task-crud.handler.ts`](../../../src/cli/handlers/task-crud.handler.ts) | --allow-parallel, --timeout flags, explicit timeout persistence, dynamic ratio wrapper regeneration, short-schedule warning |
| src/task/task.service.ts | Store and update allowParallel and timeout fields |
| src/task/task.repository.ts | Backward compat comment for new fields |
| src/log/log.types.ts | Added skip/timeout fields to ExecutionLogEntry |
| src/cli/formatters/task.formatter.ts | Display Parallel/Timeout in details, NOTE column in history |
| Read [`src/crontab/sync.service.ts`](../../../src/crontab/sync.service.ts) | Pass protection fields, schedule, and configPath to syncWrappers |
| Read [`src/diagnosis/diagnosis.service.ts`](../../../src/diagnosis/diagnosis.service.ts) | Pass lock/timeout info, including dynamic ratio timeout, to buildScript for comparison |

## Design Decisions

1. **Flock graceful degradation** — The wrapper checks `command -v flock` before using it. If flock is unavailable (some macOS systems), the command runs without lock protection rather than failing.

2. **Timeout tool check at generation time** — `detectTimeoutTool()` is called during `cronshed add`/`cronshed update`, not at wrapper runtime, per spec.

3. **Lock hash uses Bun.CryptoHasher** — No shell dependency for hashing. The SHA-256 hash is computed in TypeScript and baked into the wrapper as a literal string.

4. **Config validation: 0 < ratio <= 1** — Zero is rejected (would produce 0-second timeout), 1.0 is valid (use full interval).

5. **Ratio timeout is derived, not persisted** — `default-timeout-ratio` is applied when generating wrappers and no explicit task timeout exists. Schedule updates regenerate the wrapper so the derived value follows the current cron interval.

6. **PID kill requires held flock** — `killRunningProcess()` treats an acquireable lock as stale and removes the lock file without signaling the PID, preventing reused PID termination.
