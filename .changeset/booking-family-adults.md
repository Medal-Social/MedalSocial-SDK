---
'@medalsocial/booking': minor
---

A second grown-up stays in the booking under a family. With `screens.adultStepper`, a logged-in parent's step 1 draws «Voksne» as the same stepper a guest's does (meda 3.13, new `who.family.adults` label in the built-in packs), with «Meg selv» as its first seat. `isGuestSeat` no longer claims `adult:2` and up, so a guest who picks two grown-ups and then logs in keeps both, a switch to another account keeps them, and a resumed draft seats its grown-ups as «Meg selv» and `adult:2` rather than as children. A calendar event whose end Medal could not give is written without `DTEND`, an instant, instead of a zero-length event (RFC 5545 wants DTEND after DTSTART). Needs `@medalsocial/meda` 3.13; peer range `^3.13.0`.
