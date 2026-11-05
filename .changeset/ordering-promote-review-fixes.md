---
"@medalsocial/ordering": patch
---

Review fixes before the first release:
- The `POST` routes (place order, address resolve, delivery quote) no longer trust `x-forwarded-host`, `x-forwarded-proto` or `host` when checking a browser's `Origin`. The Origin must match the new `siteOrigin` option (one origin or a list), or else `request.url`'s. The forwarded origin counts only with `trustForwardedHost: true`. A `siteOrigin` entry that isn't an absolute `http(s)` URL throws a `RangeError` when the route is created.
- A delivery quote refused by the shared `allowQuote` limiter, or by the route's own minute, no longer costs the visitor's or the route's quote budget.
- `fetchOrderStatus` adds `?id=` before a `#fragment` in the route URL, not after it.
- `AddressCombobox` starts a new lookup session as soon as an address is picked, so a lookup typed while the pick is still being checked never reuses the picked one's session.
