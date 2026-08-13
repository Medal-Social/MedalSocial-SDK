---
"@medalsocial/sdk": minor
---

Partner channel connect — new `medal.channels` resource plus channel lifecycle
webhook events, mirroring the REST surface shipped in medal-monorepo PR #4061:

- `channels.connectLinks.create/list/revoke` — mint single-use hosted connect
  links (the one-time `url` is returned exactly once; idempotent replays omit
  it), list them with `channel_type`/`status` filters, and revoke pending
  links.
- `channels.connections.list/disconnect` — inspect the workspace's channel
  connections (generic `{ id, channel_type, label, state, masked_identity,
  last_activity_at, helpdesk_connection_id }` shape) and disconnect an
  account.
- New typed webhook events `helpdesk.channel_connected` and
  `helpdesk.channel_disconnected` (`ChannelConnectedEvent` /
  `ChannelDisconnectedEvent`, payload `WebhookChannelLifecycleData`) join the
  `WebhookEvent` union returned by `verifyWebhookSignature`.
- OpenAPI 3.1 contract extended with the five `/api/v1/channels/*` operations.
