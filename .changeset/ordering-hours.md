---
"@medalsocial/sdk": minor
---

Add `medal.ordering.locations()` and `medal.ordering.slots()` for restaurant online ordering. `locations()` lists every ordering location with its address, payment methods, how many days ahead it takes orders, and each channel's state right now (open, or closed with a reason and the next opening time). `slots()` lists the pickup or delivery slots of one location, channel and service date; a blank location, unknown channel or malformed date throws `RangeError` before any request.
