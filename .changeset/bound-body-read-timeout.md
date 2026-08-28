---
"@medalsocial/sdk": patch
---

Make `timeout` bound the whole response, not just the headers. `fetch` settles as soon as the response headers arrive, and the client cleared its abort timer at that point — so every body read ran with no deadline at all. A server that sent headers and then stalled mid-body hung the SDK indefinitely; `timeout` only ever meant time-to-headers, despite being documented as "Request timeout in ms".

The abort signal is now held until the body is in hand. A stalled response rejects with `AbortError` at the configured timeout, and a stalled error body no longer blocks the automatic 429/5xx retry — it aborts, and the retry proceeds. The backoff delay stays outside the deadline, since that is time the client chooses to wait rather than time it spends waiting on the server.

**Behaviour change:** a response whose body takes longer than `timeout` to finish streaming now fails where it previously hung (or, if it eventually completed, succeeded). Slow-but-progressing responses are unaffected — the budget covers the whole exchange, per attempt, and defaults to 30s. Raise `timeout` if you stream large payloads.
