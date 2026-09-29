---
"@medalsocial/sdk": patch
---

`login.verify` and `login.vipps.verifyLink` now return `PortalSessionResponse`, a `PortalSession` whose `expires_at_iso` is always a string. Callers reading the response need no guard, and `PortalSession` itself keeps the field optional for 1.11-shaped objects.
