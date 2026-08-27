---
"@medalsocial/sdk": minor
---

Add the bookings resource: the bookable catalogue (`medal.bookings.listServices` / `listResources`), free slots (`availability`), and the bookings themselves (`list` / `create` / `get` / `update` / `cancel` / `reschedule` / `markNoShow`). `medal.bookings.manage.*` covers the customer-facing manage-token routes, where the workspace's cancel and reschedule windows are enforced and a cancellation is attributed to the customer rather than to staff. Money is integer øre; `bookings.list` reports `pagination.truncated` when the read window was clipped.
