---
"@medalsocial/sdk": patch
---

Drain the response body before retrying a 429/5xx. The retry branch abandoned the response without reading it, and undici keeps a socket out of its connection pool until the body is consumed — so a retry storm opened a fresh connection per attempt, exactly when the server was least able to absorb them. Against a local server returning large 5xx bodies, 24 requests cost 17 TCP connections before this change and 2 after.

The body is read and discarded rather than cancelled: `res.body?.cancel()` releases the socket too, but by destroying the connection instead of returning it to the pool, which is the churn this fixes. This affects every resource, since they all share `BaseClient.request`.
