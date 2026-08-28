---
"@medalsocial/sdk": patch
---

Make `timeout` bound the whole response, not just the headers. `fetch` settles as soon as the response headers arrive, and the client cleared its abort timer at that point — so every body read ran with no deadline at all. A server that sent headers and then stalled mid-body hung the SDK indefinitely; `timeout` only ever meant time-to-headers, despite being documented as "Request timeout in ms".

The abort signal is now held until the body is in hand. A stalled response rejects with `AbortError` at the configured timeout, and a stalled error body no longer blocks the automatic 429/5xx retry — it aborts, and the retry proceeds. Retry backoff stays outside the deadline, since that is time the client chooses to wait rather than time it spends waiting on the server.

**Behaviour change:** `timeout` is a fixed wall-clock budget per attempt, and progress on the body does not extend it. A response that takes longer than `timeout` to finish arriving now fails, where before it either hung forever or eventually succeeded. The default of 30s is ample for the JSON these endpoints return, but raise it if you pull pages large enough to take longer than that to transfer.
