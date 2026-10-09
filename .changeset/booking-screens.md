---
"@medalsocial/booking": minor
---

Config `screens`: opt-in screen features, every switch off by default. `recap` puts meda's `BookingRecap` above the details step (day, hours, who, stylist, total, «Endre», and a swap to another stylist free at the same minute when «first available» picked one); `soonest` and `dayFullness` turn on the time step's «Ledig snart» row and day marks; `summaryDetail` and `hideDisabledNext` give the bar a second line and a hint in place of a dead «Neste»; `firstAvailableFaces` and `stylistEdgeFade` draw «Første ledige» as the stylists' faces and fade the phone row; `guestParty` lets a guest book children and themselves together (step 1 opens with one child seated, in the server render too); `childMenuFirst` moves the grown-ups' groups below a child's age divider. New `wizard.summaryParts`, built-in nb/en words for every new key, and `screenLabels` returns every key required.

Requires `@medalsocial/meda` ^3.7.0.
