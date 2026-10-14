---
'@medalsocial/booking': minor
---

«Add to calendar» works on phones. The confirmation no longer links a `data:` file (which iPhones saved to Files, in-app browsers blocked and Android's Google Calendar cannot open): a new route `<api>/calendar/<tokens>` serves the visit as `text/calendar` in place, built from Medal by the bookings' manage tokens, and the link is chosen per device — the file on Apple devices and desktops with Google Calendar beside it, Google Calendar on Android with the file beside it. A confirmation saved before this keeps the `data:` file. Needs `@medalsocial/meda` 3.12 (`calendarAlt`).
