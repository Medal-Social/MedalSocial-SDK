---
"@medalsocial/sdk": patch
---

`PortalSession.expires_at_iso` is optional in the type. The API always returns it, but session objects that TypeScript code builds or mocks against the 1.11 shape keep compiling.
