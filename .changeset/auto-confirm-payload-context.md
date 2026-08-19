---
"@medalsocial/sdk": patch
---

Auto-confirm `previewSummary` callbacks now receive the pending request `body`.

`AutoConfirmContext` is now a discriminated union on `capabilityId`, so narrowing gives the exact payload type for that route (`undefined` for the `DELETE` routes). Previously the callback saw only the capability, method, path, path params and idempotency key, so two replies or two connect-link creations with different payloads produced indistinguishable context — a client-level `previewSummary` could only emit boilerplate, which undermines the audit value of `user_approved: true`.

The payload is passed by reference and unmodified; a new `CapabilityWriteBodies` type is exported alongside it.
