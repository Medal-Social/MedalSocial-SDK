---
"@medalsocial/sdk": minor
---

Add `medal.ordering.orders` and `medal.ordering.table()` for restaurant online ordering. `orders.create(body, { idempotencyKey, clientIp? })` places an order under a required `Idempotency-Key` (and sends the guest's IP as `X-Medal-Client-Ip` for the per-IP rate limit), resolving `{ order_id, order_number, status }`; `orders.get()`, `orders.status()` and `orders.cancel()` read, poll and cancel it. `table(token)` resolves a table QR token to its location and label. A `422` refusal stays a `MedalApiError`; the new `isOrderingRefusal()` guard narrows its `code` to `OrderingRefusalCode` and its `details` to `{ ids?, line_index?, reason? }`. `MedalErrorCode` gains the ordering codes.
