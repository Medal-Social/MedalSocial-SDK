---
"@medalsocial/booking": patch
---

Clamp the bookable window to `fromTs + MAX_RANGE_MS` on both the client clock and the availability route parser, so a `rangeDays: 62` ask that crosses a DST fall-back (about 62 × 24h + 1h) is accepted instead of 400ing with «Range must not exceed 62 days». Genuinely oversized ranges (past a one-hour DST overshoot) still 400.
