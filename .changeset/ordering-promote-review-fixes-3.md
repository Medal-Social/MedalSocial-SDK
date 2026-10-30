---
"@medalsocial/ordering": patch
---

Review fixes before the first release:
- The address suggest and resolve routes have a lookup budget, so a script can no longer spend the site key's address lookups. The limits are `maxLookupsPerMinute` per route instance (default 120) and `maxLookupsPerClientPerMinute` per IP from the new `clientIp` option (default 30). Past them the routes answer `503 SERVICE_UNAVAILABLE` without calling Medal.
- The browser helpers reject, rather than answer `SERVICE_UNAVAILABLE`, when the caller cancels while the response body is still arriving.
- `Checkout` no longer asks a second time for a delivery price when the old price's refresh timer fires while the new cart's price is on its way.
- If the site's `onPlaced` throws, `Checkout` says the order was received (new label `placedNoRedirect`) and keeps the form locked, so it can't be sent twice.
