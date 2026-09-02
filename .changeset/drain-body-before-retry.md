---
"@medalsocial/sdk": patch
---

Drain the response body before retrying a 429/5xx. The retry branch abandoned the response without consuming it, and undici keeps a socket out of its connection pool until the body is consumed — so a retry storm opened a fresh connection per attempt, exactly when the server was least able to absorb them. Against a local server returning large 5xx bodies, 24 requests cost 17 TCP connections before this change and 2 after.

The body is piped to a sink rather than cancelled or buffered. `res.body?.cancel()` releases the socket too, but by destroying the connection instead of returning it to the pool — the same churn this fixes. Reading it into a string with `res.text()` would return the socket, but materialises an error page that is then thrown away: draining a 64 MB body that way costs ~235 MB of RSS, against ~1 MB streamed. Responses with no stream to pipe fall back to `text()`.

This affects every resource, since they all share `BaseClient.request`.
