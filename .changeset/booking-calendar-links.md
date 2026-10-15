---
'@medalsocial/booking': minor
---

«Add to calendar» works on phones. The confirmation no longer links a `data:` file (which iPhones saved to Files, in-app browsers blocked and Android's Google Calendar cannot open): a new route `<api>/calendar/<tokens>` serves the visit as `text/calendar` in place, built entirely on the server (Medal by the bookings' manage tokens, the new `ics.*` labels, `contact.address`), and the link is chosen per device — the file on Apple devices and desktops with Google Calendar beside it, Google Calendar on Android with the file beside it. A confirmation saved before this keeps the `data:` file. Needs `@medalsocial/meda` 3.12 (`calendarAlt`, `calendarNewTab`); peer range `^3.12.0`.
