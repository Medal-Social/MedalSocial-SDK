---
"@medalsocial/sdk": minor
---

Add `medal.bookings.schedule(...)`: the dates a service can be booked on, with each date's opening window and the last start the service could occupy. It is the half `availability` cannot answer — availability returns free slots and nothing else, so a closed day, an evening past closing and a fully booked day all come back as the same empty array. A date absent from `schedule` is closed; on a listed date, compare `last_start_ts` against the clock to tell "too late today" from "full".
