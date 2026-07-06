# Changelog — 015-wrapper-protections

## 2026-07-06 — Bugfix: P1 wrapper protection review fixes

- **Type:** Bugfix
- **Spec modified:** No (FR-086/FR-094 existing behavior restored)
- **Code modified:** Read [`src/wrapper/wrapper.service.ts`](../../../src/wrapper/wrapper.service.ts), [`src/cli/handlers/task-crud.handler.ts`](../../../src/cli/handlers/task-crud.handler.ts), [`src/crontab/sync.service.ts`](../../../src/crontab/sync.service.ts), [`src/diagnosis/diagnosis.service.ts`](../../../src/diagnosis/diagnosis.service.ts)
- **Tests modified:** Read [`src/wrapper/wrapper.service.test.ts`](../../../src/wrapper/wrapper.service.test.ts), [`src/cli/cli.integration.test.ts`](../../../src/cli/cli.integration.test.ts)
- **AC impacted:** AC-075, AC-086, AC-087, AC-092
- **Changes:** stale PID lock files are cleaned without kill when flock is free; ratio-derived timeouts are computed during wrapper generation and follow schedule updates without being persisted
- **Author:** codex

## 2026-04-13 — Initial Implementation

### Added
- **Single-instance protection** via flock (default ON, opt-out with `--allow-parallel`)
- **Timeout protection** via `gtimeout`/`timeout` (opt-in with `--timeout <duration>`)
- **Global `default-timeout-ratio` config** for proportional auto-timeout from schedule interval
- `cronshed config set <key> <value>` and `cronshed config get <key>` commands
- `--allow-parallel` flag on `cronshed add` and `cronshed update`
- `--timeout <duration>` flag on `cronshed add` and `cronshed update` (format: Ns, Nm, Nh)
- Short-schedule warning when interval <= 60s and no timeout configured
- Skip log entries with `skipped`, `skippedAt`, `reason`, `pidHolder` fields
- Timeout log entries with `timedOut: true` when exit code 124
- Lock file naming via SHA-256 hash of `configPath:taskName`
- Graceful degradation: wrapper runs without flock if flock is not installed
- Duration parser (`parseDuration`, `formatDurationForDisplay`)
- Schedule interval calculator (`scheduleToIntervalSeconds`)
- ConfigService and ConfigRepository for `~/.cronshed/config.json`
- Integration tests for flock, timeout, combined, and graceful degradation

### Changed
- `Task`, `CreateTaskInput`, `UpdateTaskInput` extended with `allowParallel?` and `timeout?`
- `WrapperConfig` extended with protection fields
- `WrapperService.generate()` and `buildScript()` now handle flock and timeout blocks
- `SyncService.sync()` passes protection fields and configPath to wrapper generation
- `ExecutionLogEntry` extended with skip and timeout fields
- Task details display now shows Parallel and Timeout status
- History table now includes NOTE column for skip/timeout indicators
- Help text updated with new flags and config command
