---
"@medalsocial/booking": minor
---

Config `party.adultTogether` (default `false`): a party with a grown-up in it starts «Samtidig», side by side, and goes back to «Rett etter hverandre» when the grown-up leaves it. It stops deciding once the parent picks a mode or a party slot, and a party with a named stylist stays one after another, including a stylist a link names after the party is seated («Første ledige» gives «Samtidig» back). A restored draft keeps a mode the parent picked; one the default picked stays the default's. New optional `WizardState.partyModeChosen` and `WizardDraft.partyModeChosen`.
