---
"@medalsocial/sdk": minor
---

Add the bookings resource: the bookable catalogue (`medal.bookings.listServices` / `listResources`), free slots (`availability`), and the bookings themselves (`list` / `create` / `get` / `update` / `cancel` / `reschedule` / `markNoShow`). `medal.bookings.manage.*` covers the customer-facing manage-token routes, where the workspace's cancel and reschedule windows are enforced and a cancellation is attributed to the customer rather than to staff. Money is integer øre; `bookings.list` reports `pagination.truncated` when the read window was clipped.

Every booking write is idempotent by default. The client retries 429/5xx automatically, so each booking `POST` now carries a generated `Idempotency-Key` — a retry after a gateway failure replays the original result instead of booking the slot a second time. Callers can still pass `options.idempotencyKey` to extend the guarantee across their own retries. This is exposed as a new `BaseClient.postOnce` method for resources that need the same protection.
