---
"@medalsocial/ordering": patch
---

Review fixes before the first release:
- A `returnUrl` function in `createPlaceOrderRoute` now needs `siteOrigin`, checked when the route is created. Its answer must be on one of those origins, or a Vipps order answers `500 NOT_CONFIGURED`. A hostile `Host` header can no longer become the address a paying guest is sent back to.
- `Checkout` keeps the guest's chosen time when the page passes a new `loadSlots` function on re-render. It reloads the slots only when the channel, day or scheduling choice changes.
