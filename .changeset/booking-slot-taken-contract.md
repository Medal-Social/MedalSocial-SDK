---
"@medalsocial/booking": patch
---

`isSlotTaken` reads Medal's «pick another time» refusals defensively: any 409 (not only code `CONFLICT`), `details.reason` in any case, and the message prefix when there is no reason. A change of spelling on the engine side now degrades to fresh openings, never to a retry loop.
