---
"@medalsocial/booking": minor
---

Config `screens.disabledNext` (default `false`): on the multi-select service step (`party.maxServicesPerPerson` > 1), «Neste» is drawn disabled (meda's `selection.disableUntilReady`) until every seated person has a service, instead of staying pressable and doing nothing. Needs `@medalsocial/meda` 3.15; peer range `^3.15.0`.
