---
"@medalsocial/ordering": patch
---

More review fixes before the first release:
- The `POST` routes stop reading a request body that is still arriving after 10 s, or that the visitor abandons. They answer `408` without calling Medal, so a slow sender can't hold a route open.
- `Checkout` locks its fields while an order is being sent and unlocks them when the order is refused, so the order the guest sees is the one that was sent.
