# @medalsocial/ordering

## 0.2.0

### Minor Changes

- [#308](https://github.com/Medal-Social/MedalSocial-SDK/pull/308) [`1841121`](https://github.com/Medal-Social/MedalSocial-SDK/commit/1841121649c9c6217c4b60a1dd13f6a332920863) Thanks [@alioftech](https://github.com/alioftech)! - **Breaking for sites that pass a `returnUrl` function to `createPlaceOrderRoute`:** add `siteOrigin` before upgrading. Without it, creating the route now throws a `RangeError` when the module loads. A static `returnUrl` string is unchanged.
  
  - A `returnUrl` function's answer must be on one of the `siteOrigin` origins, or a Vipps order answers `500 NOT_CONFIGURED`. A hostile `Host` header can no longer become the address a paying guest is sent back to.
  - `Checkout` keeps the guest's chosen time when the page passes a new `loadSlots` function on re-render. It reloads the slots only when the restaurant, channel, day or scheduling choice changes. A new restaurant drops the old restaurant's chosen time, and when the new restaurant doesn't offer the picked day, the first offered day is used for both the day list and the slot request.

### Patch Changes

- [#308](https://github.com/Medal-Social/MedalSocial-SDK/pull/308) [`1841121`](https://github.com/Medal-Social/MedalSocial-SDK/commit/1841121649c9c6217c4b60a1dd13f6a332920863) Thanks [@alioftech](https://github.com/alioftech)! - `CartList`: removing a line keeps keyboard and screen-reader focus in the cart — on the next line's «Fjern», the previous one for the last line, or the cart heading when the last dish goes.

## 0.1.0

### Minor Changes

- [#303](https://github.com/Medal-Social/MedalSocial-SDK/pull/303) [`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5) Thanks [@alioftech](https://github.com/alioftech)! - Delivery orders (restaurant ordering plan 5). `ordering.orders.create()` takes `delivery` (`OrderingDeliveryInput`: the verified address, the quote, floor, door code and a courier note) for `channel: 'delivery'`; the order carries `delivery_fee_ore` and `customer_eta` (`OrderingCustomerEta`), and its status `customer_eta`. The input type now requires `delivery` and Vipps for `channel: 'delivery'`, and refuses `delivery` on other channels. New refusals `QUOTE_NOT_USABLE` and `QUOTE_EXPIRED`. `@medalsocial/ordering` adds `deliveryWindowLabel()` for the order page: «Levert ca. 19:05–19:15».

- [#303](https://github.com/Medal-Social/MedalSocial-SDK/pull/303) [`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5) Thanks [@alioftech](https://github.com/alioftech)! - First public release of `@medalsocial/ordering`: restaurant online ordering for a Medal site. `/core` has the framework-free rules (money, table and channel links, the cart draft and check, modifier rules, opening hours and slots, order status words, delivery quote freshness); `/react` has `MenuList`, `ItemSheet`, `CartBar`, `CartList`, `Checkout`, `AddressCombobox`, `OrderStatus` and `ClosedNotice`; `/next` has the route handlers for the menu, locations, slots, table, placing an order, its status, the Vipps return and delivery's address lookup and price. Needs `@medalsocial/sdk` and a server-side `MEDAL_API_KEY`.

- [#303](https://github.com/Medal-Social/MedalSocial-SDK/pull/303) [`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5) Thanks [@alioftech](https://github.com/alioftech)! - Pre-orders (restaurant ordering plan 6). `ordering.orders.create()` with `timing: { kind: 'scheduled', at }` is now taken: `at` is one of the slots `ordering.slots()` returns. New refusal `SLOT_TAKEN` (the slot has gone by or is inside the prep time); `PREORDER_DISABLED` now means the location takes no pre-orders, and a slot the location does not offer is `CLOSED`. `delivery.quotes.create()` takes `scheduled_dropoff_time` (the slot, for a delivery pre-order). `@medalsocial/ordering` passes `SLOT_TAKEN` through its place-order route and says it in the guest's words (`errorSlotTaken`).

### Patch Changes

- [#303](https://github.com/Medal-Social/MedalSocial-SDK/pull/303) [`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5) Thanks [@alioftech](https://github.com/alioftech)! - More review fixes before the first release:
  - The `POST` routes stop reading a request body that is still arriving after 10 s, or that the visitor abandons. They answer `408` without calling Medal, so a slow sender can't hold a route open.
  - `Checkout` locks its fields while an order is being sent and unlocks them when the order is refused, so the order the guest sees is the one that was sent.

- [#303](https://github.com/Medal-Social/MedalSocial-SDK/pull/303) [`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5) Thanks [@alioftech](https://github.com/alioftech)! - Review fixes before the first release:
  - The address suggest and resolve routes have a lookup budget, so a script can no longer spend the site key's address lookups. The limits are `maxLookupsPerMinute` per route instance (default 600) and `maxLookupsPerClientPerMinute` per IP from the new `clientIp` option (default 30). Past them the routes answer `503 SERVICE_UNAVAILABLE` without calling Medal. A request refused for its query, body or a missing key spends nothing. A route created without `clientIp` reports through `onError` that every visitor shares one budget.
  - The browser helpers reject, rather than answer `SERVICE_UNAVAILABLE`, when the caller cancels while the response body is still arriving.
  - `Checkout` no longer asks a second time for a delivery price when the old price's refresh timer fires while the new cart's price is on its way.
  - If the site's `onPlaced` throws or returns a rejected promise, `Checkout` says the order was received (new label `placedNoRedirect`) and keeps the form locked, so it can't be sent twice.

- [#303](https://github.com/Medal-Social/MedalSocial-SDK/pull/303) [`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5) Thanks [@alioftech](https://github.com/alioftech)! - Review fixes before the first release:
  - The `POST` routes (place order, address resolve, delivery quote) no longer trust `x-forwarded-host`, `x-forwarded-proto` or `host` when checking a browser's `Origin`. The Origin must match the new `siteOrigin` option (one origin or a list), or else `request.url`'s. The forwarded origin counts only with `trustForwardedHost: true`. A `siteOrigin` entry that isn't an absolute `http(s)` URL throws a `RangeError` when the route is created.
  - A delivery quote refused by the shared `allowQuote` limiter, or by the route's own minute, no longer costs the visitor's or the route's quote budget.
  - `fetchOrderStatus` adds `?id=` before a `#fragment` in the route URL, not after it.
  - `AddressCombobox` starts a new lookup session as soon as an address is picked, so a lookup typed while the pick is still being checked never reuses the picked one's session.

- [#303](https://github.com/Medal-Social/MedalSocial-SDK/pull/303) [`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5) Thanks [@alioftech](https://github.com/alioftech)! - `Checkout` sends a delivery price that was already due when it arrived (a device clock running ahead of Medal's, or a short validity) as it is, and lets Medal decide. Before, every press of the order button asked for a new price, so a guest with a fast clock could never place a delivery order. A `QUOTE_EXPIRED` from Medal still asks for a new price for the guest to accept.

- [#303](https://github.com/Medal-Social/MedalSocial-SDK/pull/303) [`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5) Thanks [@alioftech](https://github.com/alioftech)! - Checkout: a failed slot load no longer reads as a fully booked day. When `loadSlots` rejects, the time picker says the free times could not be loaded (`slotsFailed`) and offers «Prøv igjen» (`slotsRetry`) to read the day again; «Ingen ledige tider denne dagen» (`noSlots`) is kept for an answer with no times.
- Updated dependencies [[`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5), [`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5), [`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5), [`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5), [`5433e67`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5433e67610933b4ff7efc91563acbba25bb217f5)]:
  - @medalsocial/sdk@1.19.0
