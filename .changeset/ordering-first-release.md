---
"@medalsocial/ordering": minor
---

First public release of `@medalsocial/ordering`: restaurant online ordering for a Medal site. `/core` has the framework-free rules (money, table and channel links, the cart draft and check, modifier rules, opening hours and slots, order status words, delivery quote freshness); `/react` has `MenuList`, `ItemSheet`, `CartBar`, `CartList`, `Checkout`, `AddressCombobox`, `OrderStatus` and `ClosedNotice`; `/next` has the route handlers for the menu, locations, slots, table, placing an order, its status, the Vipps return and delivery's address lookup and price. Needs `@medalsocial/sdk` and a server-side `MEDAL_API_KEY`.
