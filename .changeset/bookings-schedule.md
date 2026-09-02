---
"@medalsocial/sdk": minor
---

Add `medal.bookings.schedule(...)`: the dates a service can be booked on, with each date's opening window and the last start the service could occupy. It is the half `availability` cannot answer — availability returns free slots and nothing else, so a closed day, an evening past closing and a fully booked day all come back as the same empty array. A date absent from `schedule` is closed; on a listed date, compare `last_start_ts` against the clock to tell "too late today" from "full".

Also adds `created_via` to `CreateBookingInput` (`"web" | "api"`, default `api`): a workspace's own website should send `web` so its bookings can be told apart from integrations. Staff-only provenances (`dashboard`, `walk_in`) are rejected by the API with 400. Requires medal-monorepo #4449 on the server; older servers ignore the field.
