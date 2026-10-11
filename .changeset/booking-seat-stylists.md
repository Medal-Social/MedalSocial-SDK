---
"@medalsocial/booking": minor
---

Config `screens.seatStylists` (default `false`): when a family is seen at once, each person can ask for their own stylist («who cuts whom»), and the search seats everyone else with whoever is free at that minute. New `WizardState.seatResourceIds` and `pickSeatResource` action, kept in drafts and dropped when the basket changes. `findPartySlots` takes per-seat preferences. Built-in nb/en `stylist.party.seat*` words.

Requires `@medalsocial/meda` ^3.9.0.
