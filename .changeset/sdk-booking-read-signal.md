---
"@medalsocial/sdk": minor
---

`bookings.listServices`, `listResources`, `availability` and `schedule` (and `bookings.services.list` / `bookings.resources.list`) take an optional `{ signal }` (`BookingReadOptions`). Aborting it cancels the request, its retries and any `Retry-After` wait, so a caller with a deadline ends the whole read instead of only its own wait.
