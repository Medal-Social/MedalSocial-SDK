---
'@medalsocial/sdk': minor
---

`bookings.create` accepts `ad_click` (`BookingAdClickInput`: `{ gclid?, gbraid?, wbraid? }`), the Google Ads click the visitor arrived with. Send it only once the visitor has agreed to marketing. Each id is letters, digits, `-` and `_`, at most 512 characters; any other value is a 400.
