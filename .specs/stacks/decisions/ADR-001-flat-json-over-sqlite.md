# ADR-001: Flat JSON file over SQLite

- **Date:** 2026-03-30
- **Status:** Accepted
- **Context:** Cronshed needs persistent storage for task definitions, execution history, and configuration. The tool is single-user, local-only, with no concurrent write scenarios.
- **Decision:** Use a flat `tasks.json` file as the sole data store instead of SQLite (via `bun:sqlite`).
- **Alternatives considered:**
  - **SQLite (`bun:sqlite`):** Powerful, supports queries, but overkill for a flat task list. Adds complexity for reads (need SQL), binary file not human-inspectable, harder to debug manually.
  - **YAML:** Human-readable but requires a parser dependency. JSON is native to Bun.
- **Consequences:**
  - (+) Human-readable — users can inspect and hand-edit `tasks.json`
  - (+) Zero dependencies — `JSON.parse`/`JSON.stringify` are built-in
  - (+) Simple backup — just copy the file
  - (+) Easy debugging — `cat tasks.json | jq .`
  - (-) No query capabilities — must filter in-memory (acceptable at single-user scale)
  - (-) No transactional writes — risk of corruption on crash (mitigated by atomic write pattern: write to temp file, then rename)
  - (-) History will grow unbounded in one file — may need rotation later if history exceeds thousands of entries
