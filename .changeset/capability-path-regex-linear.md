---
"@medalsocial/sdk": patch
---

Capability route templates resolve in linear time. The `{name}` placeholder pattern no longer lets a run of `{` characters backtrack quadratically (CodeQL `js/polynomial-redos`); every well-formed route resolves exactly as before.
