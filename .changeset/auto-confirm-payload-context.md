---
"@medalsocial/sdk": minor
---

Auto-confirm `previewSummary` callbacks now receive the pending request `body`.

`AutoConfirmContext` is now a discriminated union on `capabilityId`, so narrowing gives the exact payload type for that route (`undefined` for the `DELETE` routes). Previously the callback saw only the capability, method, path, path params and idempotency key, so two replies or two connect-link creations with different payloads produced indistinguishable context — a client-level `previewSummary` could only emit boilerplate, which undermines the audit value of `user_approved: true`.

The payload is passed by reference and unmodified. New exported types: `CapabilityWriteBodies` and `CapabilityWriteRequest`.

`CapabilityConfirmer.prepare` now takes the capability and its body as a single discriminated-union argument (`prepare(request, pathParams, options)`) so the two cannot be decoupled — pairing a capability id with another route's payload is a compile error even when the id's static type is the full `CapabilityId` union.
