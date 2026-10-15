---
'@medalsocial/booking': minor
---

The redesign's remaining screens, each behind a `config.screens` switch (all off by default): `adultStepper` (grown-ups as a number beside the children, so two grown-ups book together), `compactHeader` (one line of crumbs carrying the answers, no title over the question), `serviceSearch` (a search field on a grown-up's list), `bookedHero` (the confirmation with a large day leaf, calendar and directions buttons and until when a change is free) and `desktopPanel` (a sticky «your appointment» panel beside the step from `lg` up). New config: `contact.mapsUrl` and `policy.freeChangeHours`. Fixes a restored guest party coming back with every person after the first as a child. Needs `@medalsocial/meda` 3.11.
