---
"@medalsocial/booking": patch
---

The time step's «now» starts at the seed window (`slots.fromTs`) for the server render and the first client paint, so a deferred chunk no longer hydrates on a later clock (React #418). It then follows the wall clock every minute, so a wizard left open across midnight stops calling yesterday «I dag».
