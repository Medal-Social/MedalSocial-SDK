---
"@medalsocial/sdk": minor
---

Guarantee an `Idempotency-Key` on every non-idempotent write, not just bookings.

`BaseClient.request` retries 429 and 5xx three times. A POST whose transaction
committed on the server before the gateway failed was therefore submitted
again — and an unkeyed write does not merely miss deduplication, it skips the
server's idempotency machinery entirely and runs the handler a second time.
Twelve write methods went out unkeyed and now mint a key once per logical call,
outside the retry loop, so every attempt carries the same value:

- `posts.create`
- `contacts.create`, `contacts.addNote`, `contacts.import`
- `emails.send`, `emails.batch`
- `deals.create`
- `scan.create`
- `helpdesk.replies.create`
- `webhooks.create`
- `channels.connectLinks.create`
- `gdpr.requestExport`

A caller-supplied `idempotencyKey` still always wins, and a capability
confirmation keeps the key it was minted with — the confirmation is bound to
that key, so it is reused rather than replaced.

Methods that previously took no per-request options now accept an optional
`RequestOptions` argument (`posts.create`, `contacts.create`,
`contacts.addNote`, `contacts.import`, `emails.send`, `emails.batch`,
`deals.create`, `scan.create`, `gdpr.requestExport`). This is additive — every
existing call compiles unchanged.

Left deliberately unkeyed, each for a stated reason on the method:
`posts.schedule`, `posts.publish`, `gdpr.recordConsent`, `gdpr.cookieConsent`,
`webhooks.test`, and `capabilityConfirmations.create`.
