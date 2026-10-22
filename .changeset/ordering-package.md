---
"@medalsocial/ordering": minor
---

New package `@medalsocial/ordering` for restaurant online ordering, starting with `@medalsocial/ordering/core`: øre formatting (`createMoney`, hand-written «149,50 kr» for NOK in Norwegian, `Intl` elsewhere), table and channel links (`parseOrderLink` / `buildOrderLink` for `?t=` and `?c=`), a per-location cart draft in `localStorage` with its order idempotency key (`createDraftStore`), the Medal API's modifier rules (`validateSelection`, `validateSelections`, `selectionMode`, `unitPriceOre`) and allergen and dietary labels in nb, en and ar. `/react` and `/next` are reserved entries. The package stays unpublished until its first release.
