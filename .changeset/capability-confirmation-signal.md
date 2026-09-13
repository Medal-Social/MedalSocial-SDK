---
"@medalsocial/sdk": patch
---

Cancel the capability-confirmation mint when the caller aborts.

An auto-confirmed write makes two requests: it mints the `X-Capability-Confirmation` token, then sends the write. The caller's `signal` reached only the write, so aborting while the mint was in flight left the call pending until the mint answered or hit the client `timeout`. The signal now cancels the mint too, and the call rejects at once with the caller's abort reason.

`medal.capabilityConfirmations.create()` accepts `{ signal }` as an optional second argument for the explicit flow. Only the signal is accepted: the write's `idempotencyKey`, `capabilityConfirmation` and headers describe the write, not the mint.
