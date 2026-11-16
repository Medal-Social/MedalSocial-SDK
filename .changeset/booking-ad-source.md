---
'@medalsocial/booking': minor
---

The wizard can say which ad a booking came from without a click id. Pass `adSource`, a function that answers `{ network: 'google' | 'meta', campaign? }` or `null`, read by the site off its own landing link (`utm_source` and `utm_campaign` of a paid link). The wizard reads no URL, cookie or storage for it, so it needs no marketing consent and can be answered for every visitor. `POST <api>/create` forwards it to Medal Social as `ad_source`, which counts the booking for that network. A campaign name of another shape is left out and the booking goes ahead. `/core` exports `adSourceOf` and the `BookingAdSource` type. Needs `@medalsocial/sdk` with `ad_source` on `CreateBookingInput`.
