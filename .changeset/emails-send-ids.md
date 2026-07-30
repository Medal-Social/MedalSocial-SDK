---
"@medalsocial/sdk": minor
---

Emails API now hands out trackable send ids everywhere:

- `EmailSendResult.id` is the email send id accepted by `emails.get(id)` (it was
  previously a queue job id the status endpoint rejected), and the result now
  also types `copy_id` and `contact_id`.
- `BatchSendSummary.results` is new: a per-recipient array (request order) of
  `{ email, id, status, error }`, where `id` is the recipient's send id — batch
  sends are now trackable per recipient via `emails.get(id)`.
- `SendEmailInput` gains the already-supported `idempotency_key`, `copy_to`,
  and `copy_reply_to` fields.
- `EmailSendResult.id` is now typed `string | null` to match the wire contract.
