---
'@medalsocial/booking': minor
---

The wizard can send the Google Ads click a visitor arrived with. Pass `adClick`, a function that answers `{ gclid?, gbraid?, wbraid? }` or `null`: it is asked when the booking is sent, and `POST <api>/create` forwards the answer to Medal Social as `ad_click`. The wizard reads no URL or cookie for it and does not know what the visitor agreed to, so answer `null` until they have accepted marketing. The function is asked on every send, so it must answer as soon as the page loads: `null` sends no click, and any other answer sends the click the attempt first carried (kept with the attempt in `sessionStorage`, this tab, at most an hour). An id that is not letters, digits, `-` and `_` (max 512) is left out and the booking goes ahead. `/core` exports `adClickOf` and the `BookingAdClick` type. Needs `@medalsocial/sdk` with `ad_click` on `CreateBookingInput`.
