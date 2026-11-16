---
'@medalsocial/sdk': minor
---

`bookings.create` accepts `ad_source` (`BookingAdSourceInput`: `{ network: 'google' | 'meta', campaign? }`), the ad the booking came from as the site read it off its own landing link. It is not a click id and not read from a cookie, so it can be sent for every visitor. Medal Social counts the booking for that network in the Ads report. A value of another shape is ignored, never a 400.
