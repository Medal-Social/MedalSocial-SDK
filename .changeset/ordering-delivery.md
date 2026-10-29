---
"@medalsocial/sdk": minor
"@medalsocial/ordering": minor
---

Delivery orders (restaurant ordering plan 5). `ordering.orders.create()` takes `delivery` (`OrderingDeliveryInput`: the verified address, the quote, floor, door code and a courier note) for `channel: 'delivery'`; orders and their status carry `delivery_fee_ore` and `customer_eta` (`OrderingCustomerEta`). New refusals `QUOTE_NOT_USABLE` and `QUOTE_EXPIRED`. `@medalsocial/ordering` adds `deliveryWindowLabel()` for the order page: «Levert ca. 19:05–19:15».
