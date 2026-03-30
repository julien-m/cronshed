# Preflight Report

> Generated: 2026-03-30T00:00:00Z | Mode: full | Duration: 2s

## Summary

| Category | Total | Pass | Auto-resolved | Failed | Blocked |
|----------|-------|------|---------------|--------|---------|
| Tooling | 4 | 3 | 0 | 1 | 0 |
| Authentication | 0 | 0 | 0 | 0 | 0 |
| Tokens | 0 | 0 | 0 | 0 | 0 |
| Custom | 0 | 0 | 0 | 0 | 0 |
| **Total** | **4** | **3** | **0** | **1** | **0** |

## Verdict: PARTIAL

> 1 dependency not yet installed. Run `bun add cron-parser` to resolve.

### Auto-resolved

_None_

### Blocked (human action required)

_None_

## Details

### Tooling

| Check | Status | Command | Output |
|-------|--------|---------|--------|
| Bun runtime | PASS | `bun --version` | 1.3.9 |
| TypeScript compiler | PASS | `bunx tsc --version` | 5.9.3 |
| cron-parser | FAIL | `bun -e "require('cron-parser')"` | Not installed |
| cc-hub CLI | PASS | `which cc-hub` | /Users/julienm/.bun/bin/cc-hub |

### Authentication

| Check | Status | Command | Duration |
|-------|--------|---------|----------|

### Tokens

| Check | Status | Command | Duration |
|-------|--------|---------|----------|

### Custom

| Check | Status | Command | Duration |
|-------|--------|---------|----------|
