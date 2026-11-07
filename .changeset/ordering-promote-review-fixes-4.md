---
"@medalsocial/ordering": minor
---

**Breaking for sites that pass a `returnUrl` function to `createPlaceOrderRoute`:** add `siteOrigin` before upgrading. Without it, creating the route now throws a `RangeError` when the module loads. A static `returnUrl` string is unchanged.

- A `returnUrl` function's answer must be on one of the `siteOrigin` origins, or a Vipps order answers `500 NOT_CONFIGURED`. A hostile `Host` header can no longer become the address a paying guest is sent back to.
- `Checkout` keeps the guest's chosen time when the page passes a new `loadSlots` function on re-render. It reloads the slots only when the restaurant, channel, day or scheduling choice changes. A new restaurant drops the old restaurant's chosen time, and when the new restaurant doesn't offer the picked day, the first offered day is used for both the day list and the slot request.
