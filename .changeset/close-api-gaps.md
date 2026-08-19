---
"@medalsocial/sdk": minor
---

Close remaining gaps between the SDK and the Medal Social public API for partner channel-connect integrations:

- **Helpdesk message delivery state** — `ConversationMessage` now exposes `delivery_status` (`pending | sent | delivered | failed`, typed as a union) and `delivery_error`, both `null` for inbound messages and internal notes. Documents that a `201` from `helpdesk.replies.create` means *accepted*, not delivered.
- **Webhook delivery correlation** — `WebhookDelivery` now exposes `resource_id`, `conversation_id`, `message_id`, `connection_ref`, `channel`, and `channel_connection_id`. All are nullable and fail closed to `null` when no canonical event exists (test pings, aged-out events); deliveries never carry payload bodies.
- **Capability confirmations** — new `medal.capabilityConfirmations.create()` resource for `POST /api/v1/capability-confirmations`, plus the typed `CapabilityId` union / `CAPABILITY_IDS` and `CAPABILITY_ROUTES` exports. An opt-in `autoConfirmCapabilities: { previewSummary }` client option (and per-call `{ autoConfirm }`) mints the `Idempotency-Key` + `X-Capability-Confirmation` pair for confirmable writes. Defaults to OFF.
