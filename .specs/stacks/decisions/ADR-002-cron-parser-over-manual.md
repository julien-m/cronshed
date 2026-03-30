# ADR-002: cron-parser over manual cron expression parsing

- **Date:** 2026-03-30
- **Status:** Accepted
- **Context:** Cronshed needs to validate cron expressions and calculate next execution times. Cron syntax has many edge cases (DST transitions, leap years, day-of-week vs day-of-month interaction, non-standard extensions).
- **Decision:** Use the `cron-parser` npm package for cron expression validation and next-execution calculation.
- **Alternatives considered:**
  - **Manual parsing:** Full control, zero deps, but cron syntax edge cases are notoriously tricky. DST handling alone would take significant effort to get right.
  - **`croner`:** Lighter alternative, but less mature for next-execution calculation.
  - **`node-cron`:** More of a scheduler than a parser — we only need parsing, not execution.
- **Consequences:**
  - (+) Battle-tested handling of edge cases (DST, leap years, ranges, steps)
  - (+) Reliable next-execution calculation
  - (+) Small dependency footprint
  - (-) External dependency — but well-maintained and widely used
  - (-) Must stay updated if cron syntax extensions are needed
