---
"@medalsocial/sdk": minor
---

Cursor pagination on the `medal.channels` listings, closing a gap against the
REST surface (both endpoints already accepted `limit`/`cursor` server-side, but
the SDK sent neither and dropped the response's `pagination` envelope):

- `channels.connectLinks.list()` now accepts `limit` and `cursor` alongside the
  existing `channel_type` / `status` filters (`ListConnectLinksOptions` extends
  `PaginationOptions`), and returns `PaginatedResponse<ConnectLink>`.
- `channels.connections.list()` now accepts `PaginationOptions` and returns
  `PaginatedResponse<ChannelConnection>`.
- Both surface `pagination.has_more` / `pagination.next_cursor` exactly as
  `helpdesk.conversations.list` and the other paginated resources do. `limit`
  defaults to 50 server-side and is capped at 100.
- Note that both endpoints filter **within** the page (connect-link
  `channel_type`/`status`, and non-projectable connection rows), so a page can
  hold fewer than `limit` items while `has_more` is still `true` — page off
  `has_more`, not the item count.
- OpenAPI 3.1 contract updated: `listChannelConnectLinks` and
  `listChannelConnections` gain the `limit`/`cursor` query parameters and now
  respond with `PaginatedResponse_ConnectLink` /
  `PaginatedResponse_ChannelConnection`.

Existing calls keep working — the new options are optional and the response
gains a field rather than losing one.
