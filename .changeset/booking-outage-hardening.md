---
"@medalsocial/booking": patch
---

Outage hardening after a production incident where the DST hour pushed the widest booking window past the routes' 62 × 24 h range guard, so every unseeded service answered 400 between 00:00 and 01:00 for eight weeks of nights.

- The read routes admit the widest window a valid config can build, DST hour included. One module (`core/range.ts`, exporting `MAX_RANGE_DAYS` and `MAX_RANGE_MS`) owns the bound for the config schema, `parseRange` and the catalogue cache horizon.
- «Prøv igjen» re-reads the openings, the stylists and the hours, seeded ones included. If the business day has moved on, it starts a fresh window from now. A party keeps the visits that answered and asks only for the ones that failed.
- Medal's `in_past`, `outside_horizon` and `off_grid` refusals take the slot-taken path (fresh openings, back to the time step) rather than an endless «Prøv en gang til».
- Every answer ≥ 400 is logged through the site's logger with the route (a fixed label for malformed or unmatched paths), method, status and error code. The message is never logged, and neither are the rate limiter's own 429s. `onEvent` gains `{ type: 'read_error', endpoint, status }`, once per failure.
- Catalogue and calendar reads give up after 4 s per attempt and 8 s in total, instead of the SDK's 30 s × 3 with an uncapped `Retry-After`. The deadline aborts the SDK call itself, so nothing more is sent upstream.
- A booking that happened is never answered as a failure because a cache could not be expired.
- A pending booking resumes on browsers without `AbortSignal.timeout` (Safari < 16).
