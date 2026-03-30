# Preflight Manifest

> Auto-generated from stack and specs. Editable — changes are preserved on regeneration.

## Tooling

### Bun runtime
- **check:** `bun --version`
- **expected:** >= 1.0.0
- **source:** stack (_default.md)
- **resolve:** `curl -fsSL https://bun.sh/install | bash`

### TypeScript compiler
- **check:** `bunx tsc --version`
- **expected:** >= 5.0.0
- **source:** stack (_default.md)
- **resolve:** `bun add -d typescript`

### cron-parser
- **check:** `bun -e "require('cron-parser')"`
- **expected:** installed
- **source:** stack (_default.md)
- **resolve:** `bun add cron-parser`

### cc-hub CLI
- **check:** `which cc-hub`
- **expected:** installed globally
- **source:** stack (_default.md — notifications)
- **resolve:** Install from ~/projects/cc-hub

## Authentication

> No authentication required — local-only tool.

## Tokens

> No tokens required — no external services.

## Custom

<!-- preflight:custom:start -->
<!-- Add manual checks here. Use the same ### format as above. Set source: manual -->
<!-- preflight:custom:end -->
