---
"@medalsocial/sdk": minor
"@medalsocial/ordering": minor
---

Pre-orders (restaurant ordering plan 6). `ordering.orders.create()` with `timing: { kind: 'scheduled', at }` is now taken: `at` is one of the slots `ordering.slots()` returns. New refusal `SLOT_TAKEN` (the slot has gone by or is inside the prep time); `PREORDER_DISABLED` now means the location takes no pre-orders, and a slot the location does not offer is `CLOSED`. `delivery.quotes.create()` takes `scheduled_dropoff_time` (the slot, for a delivery pre-order). `@medalsocial/ordering` passes `SLOT_TAKEN` through its place-order route and says it in the guest's words (`errorSlotTaken`).
