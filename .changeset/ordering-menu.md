---
"@medalsocial/sdk": minor
---

Add `medal.ordering.menu()` for restaurant online ordering. It reads the menu a guest can order from on one channel (dine-in, takeaway or delivery), optionally at a future pickup or delivery time, with typed categories, dishes, allergens, dietary labels and modifier groups. Pass back the `etag` from an earlier call as `ifNoneMatch` and an unchanged menu resolves `{ notModified: true }` instead of downloading again. Also adds `BaseClient.getConditional()` and the `ORDERING_NOT_ENABLED` error code.
