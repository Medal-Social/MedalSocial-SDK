# Medal Social SDK

TypeScript SDK for the [Medal Social](https://medalsocial.com) API. Manage posts, emails, contacts, deals, helpdesk conversations, webhooks, company/site scans, and GDPR compliance programmatically.

## Install

```bash
npm install @medalsocial/sdk
# or
pnpm add @medalsocial/sdk
```

## Quick Start

```ts
import { Medal } from '@medalsocial/sdk';

const medal = new Medal('medal_xxx');

// Create and schedule a social post
const { data: post } = await medal.posts.create({
  content: 'Hello from the Medal Social SDK!',
  channel_ids: ['ch_1'],
});
await medal.posts.schedule(post.id, { scheduled_at: '2026-03-15T10:00:00Z' });

// Send a transactional email
await medal.emails.send({
  template_slug: 'welcome',
  to: 'user@example.com',
  variables: { name: 'John' },
});

// Manage contacts
const { data: contactRef } = await medal.contacts.create({
  email: 'john@example.com',
  first_name: 'John',
  status: 'lead',
});
const { data: contact } = await medal.contacts.get(contactRef.id);
```

## Authentication

Two authentication methods are supported:

### API Key (recommended for server-side)

Create an API key in your workspace settings. Keys are prefixed with `medal_` and scoped to a single workspace.

```ts
const medal = new Medal('medal_xxx');

// With options
const medal = new Medal('medal_xxx', {
  baseUrl: 'https://io.medalsocial.com', // default
  timeout: 30000, // default, in ms
});
```

### OAuth Access Token

For OAuth integrations, pass the access token and the target workspace ID:

```ts
const medal = new Medal('oauth_access_token', {
  workspaceId: 'workspace_id', // required for OAuth
});
```

OAuth tokens are obtained through the Medal Social OAuth flow (`/api/auth/oauth2/authorize`). The `workspaceId` is required because OAuth tokens can access multiple workspaces.

## Resources

### Posts

```ts
// List connected channels
const { data: channels } = await medal.posts.channels();

// Create a post
const { data } = await medal.posts.create({
  type: 'social',       // 'social' | 'newsletter' | 'blog'
  content: 'Hello!',
  channel_ids: ['ch_1'],
});

// Get post with per-channel variants
const { data: post } = await medal.posts.get(data.id);
console.log(post.variants); // platform-specific status, permalinks

// Update a draft
await medal.posts.update(data.id, { content: 'Updated!' });

// Schedule or publish
await medal.posts.schedule(data.id, { scheduled_at: '2026-03-15T10:00:00Z' });
await medal.posts.publish(data.id);

// List posts
const posts = await medal.posts.list({ status: 'draft', type: 'social', limit: 50 });

// Delete
await medal.posts.remove(data.id);
```

### Emails

```ts
// Send transactional email
const { data: sent } = await medal.emails.send({
  template_slug: 'welcome',
  to: 'user@example.com',
  name: 'John',
  locale: 'en',
  variables: { company: 'Acme' },
  contact_id: 'c_123', // optional: link to a contact
});

// Check delivery status
const { data: status } = await medal.emails.get(sent.id);
console.log(status.status); // 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked'

// Batch send (max 100 recipients)
const { data: batch } = await medal.emails.batch({
  template_slug: 'newsletter',
  default_locale: 'en',
  recipients: [
    { email: 'a@test.com', name: 'Alice', variables: { code: 'A1' } },
    { email: 'b@test.com', name: 'Bob' },
  ],
});
console.log(batch.batch_id, batch.total, batch.queued, batch.failed);

// Templates
const { data: templates } = await medal.emails.templates.list();
const { data: template } = await medal.emails.templates.get('welcome', {
  locale: 'ar',
  fallback_locale: 'en',
});
```

### Contacts

```ts
// CRUD
const { data: created } = await medal.contacts.create({
  email: 'john@example.com',
  first_name: 'John',
  last_name: 'Doe',
  company: 'Acme',
  job_title: 'CTO',
  status: 'lead',
  label_ids: ['lbl_1'],
  custom_fields: { source: 'website' },
});

const { data: contact } = await medal.contacts.get(created.id);
const { data: updated } = await medal.contacts.update(created.id, { status: 'customer' });
const { data: removed } = await medal.contacts.remove(created.id);
console.log(updated.success, removed.success);

// List with filters
const contacts = await medal.contacts.list({
  status: 'lead',
  email_status: 'subscribed',
  label_ids: ['lbl_1'],
  search: 'john',
  limit: 50,
});

// Activity timeline
const activities = await medal.contacts.activities('contact_id', { limit: 20 });

// Add a note
const { data: note } = await medal.contacts.addNote('contact_id', { content: 'Follow up next week' });
console.log(note.id);

// Bulk import (max 500)
const { data: result } = await medal.contacts.import([
  { email: 'a@test.com', first_name: 'Alice' },
  { email: 'b@test.com', first_name: 'Bob' },
]);
console.log(result.added, result.skipped);
```

### Deals

```ts
const { data: created } = await medal.deals.create({
  title: 'Enterprise Partnership',
  value: 50000,
  currency: 'USD',
  brand_name: 'Acme Corp',
  contact_id: 'c_123',
  notes: 'Initial outreach',
});
const { data: deal } = await medal.deals.get(created.id);

const { data: updated } = await medal.deals.update(deal.id, { status: 'won' });
const { data: unlinked } = await medal.deals.update(deal.id, { contact_id: null }); // unlink contact

const deals = await medal.deals.list({ status: 'open', search: 'Acme' });
const { data: removed } = await medal.deals.remove(deal.id);
console.log(updated.success, unlinked.success, removed.success);
```

### Bookings

Money is always **integer øre** (`amount_ore`, `price_ore`) — never a float, never kroner. Timestamps come back as ISO 8601 strings; on the way in, either Unix milliseconds or an ISO string is accepted.

```ts
// Catalogue + free slots
const { data: services } = await medal.bookings.listServices();
const { data: resources } = await medal.bookings.listResources();
const { data: slots } = await medal.bookings.availability({
  service_id: services[0].id,
  from_ts: Date.now(),
  to_ts: Date.now() + 7 * 86_400_000,
  resource_id: resources[0].id,     // optional — defaults to every capable resource
});

// Book a party — all items succeed or none do (max 50)
const { data: created } = await medal.bookings.create(
  {
    items: [
      { service_id: services[0].id, start_ts: slots[0].start_ts! },
      { service_id: services[0].id, start_ts: slots[1].start_ts!, booked_for_name: 'Ida', booked_for_birth_year: 2018 },
    ],
    contact: { phone: '+4790000000', email: 'ida@example.com', name: 'Ida Hansen' },
    notes: 'Bursdag',
  },
  { idempotencyKey: crypto.randomUUID() },   // optional — see the note below
);
// created.bookings[i].manage_token is returned EXACTLY ONCE (only its hash is
// stored, and an idempotent replay omits it) — persist it for the manage link.
// It is UNRECOVERABLE if lost: `Booking` has no token field, so re-reading the
// booking gives you nothing. Reschedule to mint a fresh one, or act by id.

// Staff actions — policy windows are bypassed, cancels attributed to staff
const { data: booking } = await medal.bookings.get(created.bookings[0].id);
await medal.bookings.update(booking.id, { internal_notes: 'Allergisk mot parfyme' });
await medal.bookings.cancel(booking.id, { reason: 'Sykdom' });
const { data: moved } = await medal.bookings.reschedule(booking.id, {
  new_start_ts: '2026-09-02T09:00:00.000Z',
  new_resource_id: resources[0].id,
});
// moved.booking_id is a NEW id with a NEW manage_token — the old booking is cancelled
await medal.bookings.markNoShow(moved.booking_id);

// Listing — check `truncated`: when true, matching bookings exist that no
// cursor reaches, so narrow the from_ts/to_ts window
const page = await medal.bookings.list({ status: 'confirmed', from_ts: Date.now(), limit: 50 });
console.log(page.pagination.has_more, page.pagination.next_cursor, page.pagination.truncated);
```

**Customer actions go through `medal.bookings.manage`**, keyed by the manage token instead of the booking id. This is not the same route with a different lookup key: the workspace's cancel/reschedule windows are **enforced**, and the cancel is attributed to the customer. Use it to relay a customer's own click on the link in their confirmation email.

```ts
const { data: summary } = await medal.bookings.manage.get(manageToken);
if (summary.can_cancel) await medal.bookings.manage.cancel(manageToken, { reason: 'Endret plan' });
if (summary.can_reschedule) {
  const { data } = await medal.bookings.manage.reschedule(manageToken, {
    new_start_ts: '2026-09-02T09:00:00.000Z',
  });
  console.log(data.booking_id, data.manage_token); // old token stops working
}
```

`can_cancel` / `can_reschedule` already apply the policy windows — honour them rather than re-deriving from `cancel_window_hours`.

**Booking writes are idempotent by default.** The SDK retries 429/5xx automatically, so every booking `POST` (`create`, `cancel`, `reschedule`, `markNoShow`, and both `manage` writes) carries a generated `Idempotency-Key` — a retry after a gateway failure replays the original result instead of booking the slot twice. Supply your own `options.idempotencyKey` to extend that guarantee across *your* retries too: the server remembers a key for 24 hours, keyed by `(key, workspace, method + path)`.

`update(id, input)` requires at least one of `notes` / `internal_notes`; `update(id, {})` is a compile error, matching the API's own 400.

### GDPR

```ts
// Consent management
await medal.gdpr.recordConsent({
  email: 'user@example.com',
  consent_type: 'marketing_email', // | 'analytics_tracking' | 'third_party_sharing'
  granted: true,
  source: 'signup_form',
});

const { data: consents } = await medal.gdpr.getConsent('user@example.com');

// Data exports
const { data: exp } = await medal.gdpr.requestExport();
const { data: exports } = await medal.gdpr.listExports();
const { data: status } = await medal.gdpr.getExport(exp.request_id);
console.log(status.download_url); // available when status is 'completed'

// Cookie consent (website integration)
await medal.gdpr.cookieConsent({
  domain: 'example.com',
  consentStatus: 'granted',
  consentTimestamp: new Date().toISOString(),
  cookiePreferences: {
    necessary: { allowed: true },
    analytics: { allowed: true },
    marketing: { allowed: false },
  },
});
```

### Scan

```ts
// Find the company in the Norwegian registry (typeahead)
const { data: hits } = await medal.scan.companies('Eksempel Bygg');

// Queue a scan — exactly one of url / orgnr / name
const { data: job } = await medal.scan.create({ orgnr: hits[0].orgnr });

// Poll until it settles (~30 s; done or failed)
const finished = await medal.scan.waitForResult(job.id);
if (finished.status === 'done' && finished.result) {
  console.log(finished.result.nettskaar, finished.result.subScores);
}
```

### Helpdesk

```ts
// List/search conversations
const conversations = await medal.helpdesk.conversations.list({
  status: 'open',                    // 'open' | 'snoozed' | 'closed'
  assignee_user_id: 'user_1',
  requester: 'jane@example.com',     // match visitor name/email
  query: 'refund',                   // free-text search
  channels: ['widget', 'whatsapp'],  // channel filter
  limit: 50,
});

// Read one conversation + its messages
const { data: conversation } = await medal.helpdesk.conversations.get('conv_id');
const messages = await medal.helpdesk.conversations.messages('conv_id', { limit: 50 });

// Assign / snooze / close
await medal.helpdesk.conversations.update('conv_id', { assignee_user_id: 'user_1' });
await medal.helpdesk.conversations.update('conv_id', { status: 'closed', assignee_user_id: null });

// Reply as an operator (see "Helpdesk bridge" below for idempotency)
const { data: reply } = await medal.helpdesk.replies.create(
  {
    conversation_id: 'conv_id',
    body: 'Thanks for reaching out — on it!',
    author_name: 'Support Bot',    // optional display name
    message_type: 'chat',          // or 'note' for an internal note
  },
  { idempotencyKey: crypto.randomUUID() },
);
```

**A `201` from `replies.create` means accepted, not delivered.** The channel hand-off happens asynchronously afterwards. Each message carries `delivery_status` (`pending` | `sent` | `delivered` | `failed`) and `delivery_error`, both `null` for inbound messages and internal notes (neither is ever sent to a channel):

```ts
const { data: messages } = await medal.helpdesk.conversations.messages('conv_id');
for (const message of messages) {
  if (message.delivery_status === 'failed') {
    console.error(message.id, message.delivery_error);
  }
}
```

Subscribe to `helpdesk.message_delivery_updated` for the same values pushed instead of polled.

### Webhooks

```ts
// Create an endpoint. The signing secret is returned EXACTLY ONCE — store it
// securely immediately; you cannot retrieve it again.
const { data: endpoint } = await medal.webhooks.create(
  {
    name: 'Helpdesk bridge',
    url: 'https://example.com/medal/webhook', // must be https
    event_types: ['helpdesk.message_received', 'helpdesk.conversation_status_changed'],
    channels: ['widget'],                     // optional channel filter
  },
  { idempotencyKey: crypto.randomUUID() },
);
console.log(endpoint.secret); // whsec_… — shown only in this response

// Manage endpoints
const { data: endpoints } = await medal.webhooks.list();
const { data: one } = await medal.webhooks.get(endpoint.id);
await medal.webhooks.update(endpoint.id, { enabled: false });
await medal.webhooks.delete(endpoint.id);

// Observe deliveries + send a signed test event
const { data: deliveries } = await medal.webhooks.deliveries(endpoint.id, { limit: 20 });
await medal.webhooks.test(endpoint.id); // queues a 'test.ping' delivery
```

Failed deliveries retry with exponential backoff (up to 6 attempts) before being dead-lettered.

`deliveries()` returns the most recent attempts only — it takes a `limit` and is **not** cursor-paginated. A delivery's `id` is the same value sent as the `X-Medal-Delivery-Id` and `Idempotency-Key` headers on the outbound request, so you can join your own receiving log to this listing exactly. Deliveries **never carry payload bodies** (payloads can contain customer PII); instead each one exposes correlation fields — `resource_id`, `conversation_id`, `message_id`, `connection_ref`, `channel`, `channel_connection_id` — that let you look the subject up through the regular API. All six are nullable and **fail closed to `null`** when no canonical event exists for the delivery (e.g. `test.ping` deliveries, or events that have aged out of retention), so always null-check them.

### Channels (partner connect)

Mint hosted connect links that let an external person — e.g. a partner's operator, with no Medal account — attach a channel account (today `telegram_inbox`) to the workspace's helpdesk, then track and disconnect the resulting connections. Requires the `channel.connect.manage` scope; OAuth callers additionally need the workspace `admin` role for the writes.

```ts
// Mint a single-use hosted connect link. `data.url` carries the one-time link
// token EXACTLY ONCE — an idempotent replay (same Idempotency-Key) omits it,
// so store it immediately (or revoke and mint a new link if lost).
const { data: link } = await medal.channels.connectLinks.create(
  {
    channel_type: 'telegram_inbox',
    label: 'Acme support',                              // shown on the hosted page
    redirect_url: 'https://partner.example.com/done',   // optional, https only
  },
  { idempotencyKey: crypto.randomUUID() },
);
console.log(link.url); // send this to the person who should connect

// Track links (tokens are never returned) and revoke unused ones
const { data: links } = await medal.channels.connectLinks.list({ status: 'pending' });
await medal.channels.connectLinks.revoke(link.id);

// List the workspace's channel connections and disconnect one
const { data: connections } = await medal.channels.connections.list();
// state: 'connecting' | 'active' | 'disconnected' | 'disabled'
await medal.channels.connections.disconnect(connections[0].id);

// Both listings are cursor-paginated (limit defaults to 50, capped at 100)
let cursor: string | undefined;
do {
  const page = await medal.channels.connections.list({ limit: 100, cursor });
  for (const connection of page.data) console.log(connection.id, connection.state);
  cursor = page.pagination.has_more ? page.pagination.next_cursor ?? undefined : undefined;
} while (cursor);
```

Filters (`channel_type`, `status`) are applied **within** each page, so a page may hold fewer than `limit` items while `pagination.has_more` is still `true` — drive the loop off `has_more`, never off the item count.

When the person completes the hosted sign-in, the link flips to `consumed` and your webhook endpoint receives `helpdesk.channel_connected` (subscribe via the Webhooks resource above); disconnects emit `helpdesk.channel_disconnected` with a `reason`. Inbound messages on the connected account then flow into the helpdesk — consume them via `helpdesk.message_received` and reply with `medal.helpdesk.replies.create`.

### Capability confirmations

Medal's confirmable write routes require **both** an `Idempotency-Key` and an `X-Capability-Confirmation` token whenever the calling credential holds the capability scope *directly* — which is the case for every correctly-scoped partner key and OAuth grant. (API keys carrying only legacy scopes are exempt.) Affected routes and their capability ids:

| Capability id | Route |
|---|---|
| `channel.connect_link.create.execute` | `POST /api/v1/channels/connect-links` |
| `channel.connect_link.revoke.execute` | `DELETE /api/v1/channels/connect-links/{id}` |
| `channel.connection.disconnect.execute` | `DELETE /api/v1/channels/connections/{id}` |
| `helpdesk.conversation.reply.execute` | `POST /api/v1/helpdesk/replies` |
| `helpdesk.conversation.update.execute` | `PATCH /api/v1/helpdesk/conversations/{id}` |
| `helpdesk.webhook.create.execute` | `POST /api/v1/webhooks` |
| `helpdesk.webhook.update.execute` | `PATCH /api/v1/webhooks/{id}` |
| `helpdesk.webhook.delete.execute` | `DELETE /api/v1/webhooks/{id}` |

These are exported as `CAPABILITY_IDS` (a typed union via `CapabilityId`) and `CAPABILITY_ROUTES`.

#### Explicit flow

```ts
const idempotencyKey = crypto.randomUUID();

const { data: confirmation } = await medal.capabilityConfirmations.create({
  capability_id: 'channel.connect_link.create.execute',
  idempotency_key: idempotencyKey,   // the token is bound to this exact key
  preview_summary: 'Mint a Telegram connect link for Acme Support',
  user_approved: true,               // a human on your side approved this action
});

const { data: link } = await medal.channels.connectLinks.create(
  { channel_type: 'telegram_inbox', label: 'Acme Support' },
  { idempotencyKey, capabilityConfirmation: confirmation.confirmation_token },
);
```

For an id-bound route, pass `path_params` so the token binds to the concrete path:

```ts
const { data: confirmation } = await medal.capabilityConfirmations.create({
  capability_id: 'channel.connection.disconnect.execute',
  path_params: { id: connectionId },
  idempotency_key: idempotencyKey,
  preview_summary: `Disconnect ${connectionId} — approved by ${operator.email}`,
  user_approved: true,
});

await medal.channels.connections.disconnect(connectionId, {
  idempotencyKey,
  capabilityConfirmation: confirmation.confirmation_token,
});
```

Tokens expire within 15 minutes and are single-purpose: bound to the workspace, the auth subject, the method + path, the capability's required scopes, and the idempotency key.

#### Auto-confirm (opt-in, off by default)

If your integration already gates these writes behind a real human approval, let the SDK mint both halves for you:

```ts
const medal = new Medal(process.env.MEDAL_API_KEY, {
  autoConfirmCapabilities: {
    previewSummary: (ctx) => {
      // `ctx` is a discriminated union on `capabilityId` — narrowing gives you
      // the exact request payload type, so the summary can describe the
      // specific action rather than just the route.
      switch (ctx.capabilityId) {
        case 'channel.connect_link.create.execute':
          return `${operator.email} approved a ${ctx.body.channel_type} connect link for "${ctx.body.label}"`;
        case 'helpdesk.conversation.reply.execute':
          return `${operator.email} approved replying to ${ctx.body.conversation_id}: "${ctx.body.body}"`;
        default:
          // DELETE routes have no body; identify them by path instead.
          return `${operator.email} approved ${ctx.method} ${ctx.path}`;
      }
    },
  },
});

// Both headers are minted and attached automatically.
const { data: link } = await medal.channels.connectLinks.create({
  channel_type: 'telegram_inbox',
  label: 'Acme Support',
});
```

The callback receives `{ capabilityId, method, path, pathParams, idempotencyKey, body }`. `body` is the exact object you passed to the SDK method, by reference and unmodified — treat it as read-only, since mutating it would change what is actually sent. Prefer a payload-aware summary: `"Reply to conv_1: 'Refund issued'"` is an audit record, `"POST /api/v1/helpdesk/replies"` is not. The server caps `preview_summary` at 4000 characters, so summarise the payload rather than serialising it wholesale.

> **Read before enabling.** Every minted token carries `user_approved: true`, which asserts to Medal that *a human on your side approved that specific action*, and the `previewSummary` you return is retained as the audit record of what they approved. Enable it only on code paths where that is genuinely true — never to rubber-stamp unattended writes. Returning a blank summary throws rather than asserting an approval with no description.

Per-call control:

```ts
// Opt in for one call only (client default stays off)
await medal.webhooks.delete(endpointId, {
  autoConfirm: { previewSummary: () => `${operator.email} approved removing ${endpointId}` },
});

// Opt out of a client-level default for one call
await medal.webhooks.delete(endpointId, { autoConfirm: false });
```

Auto-confirm never overrides what you supply: if a call already carries both `idempotencyKey` and `capabilityConfirmation`, nothing is minted. If it carries only `idempotencyKey`, that key is reused when binding the token.

### Workspaces

```ts
const { data: workspaces } = await medal.workspaces.list();
console.log(workspaces); // [{ id, name, slug }]
```

## Helpdesk bridge

Build a two-way bridge: receive helpdesk events on a webhook, and reply through the API.

Every delivery is signed. The `X-Medal-Signature` header carries `sha256=<base64(HMAC-SHA256("{timestamp}.{rawBody}", secret))>`, where `timestamp` is the `X-Medal-Timestamp` header (Unix ms). Use `verifyWebhookSignature` to authenticate the delivery and get a fully typed event back — it recomputes the HMAC with Web Crypto (works in Node.js 18+, Deno, Bun, Cloudflare Workers) and rejects stale timestamps (default tolerance 5 minutes).

```ts
import { Medal, verifyWebhookSignature, WebhookVerificationError } from '@medalsocial/sdk';

const medal = new Medal(process.env.MEDAL_API_KEY);

// Example: a fetch-style handler (Cloudflare Workers, Hono, Next.js route, …).
// IMPORTANT: verify against the RAW body string — do not JSON.parse first.
export async function handleWebhook(request: Request): Promise<Response> {
  const payload = await request.text();

  let event;
  try {
    event = await verifyWebhookSignature({
      payload,
      timestamp: request.headers.get('X-Medal-Timestamp') ?? '',
      signature: request.headers.get('X-Medal-Signature') ?? '',
      secret: process.env.MEDAL_WEBHOOK_SECRET, // the whsec_… from webhooks.create
    });
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return new Response(`Invalid webhook: ${err.code}`, { status: 401 });
    }
    throw err;
  }

  switch (event.type) {
    case 'helpdesk.message_received': {
      const { conversation, message } = event.data;
      // Reply with an idempotency key so retried deliveries never double-post.
      // The X-Medal-Delivery-Id header (== event.id) is a perfect key.
      await medal.helpdesk.replies.create(
        {
          conversation_id: conversation.id,
          body: `Thanks! We received: "${message.body}"`,
          author_name: 'Bridge Bot',
        },
        { idempotencyKey: `reply:${event.id}` },
      );
      break;
    }
    case 'helpdesk.conversation_status_changed':
      console.log(event.data.previousStatus, '→', event.data.status);
      break;
    case 'helpdesk.conversation_assigned':
      console.log('assigned to', event.data.assigneeUserId);
      break;
    case 'test.ping':
      break; // sent by medal.webhooks.test()
  }

  return new Response('ok', { status: 200 }); // 2xx acknowledges the delivery
}
```

Event types: `helpdesk.conversation_created`, `helpdesk.conversation_assigned`, `helpdesk.conversation_status_changed`, `helpdesk.message_received`, `helpdesk.message_sent`, `helpdesk.message_delivery_updated`, `helpdesk.channel_connected`, `helpdesk.channel_disconnected`, and `test.ping`. All are discriminated on `event.type` — TypeScript narrows `event.data` automatically in a `switch`.

Channel lifecycle events (`helpdesk.channel_connected` / `helpdesk.channel_disconnected`) fire when a channel account is attached to or removed from the workspace — e.g. via a partner connect link (see the Channels resource above). Their `data` is channel-generic: `channel`, `channelConnectionId`, `channel_type`, `connection_ref`, `label`, `masked_identity`, and (disconnect only) `reason` — one of `api_disconnect`, `user_revoked`, `member_disconnect`.

Notes:

- **Idempotency**: deliveries are retried on failure, so make your handler idempotent. Deduplicate on `event.id` (also sent as the `X-Medal-Delivery-Id` and `Idempotency-Key` request headers). When replying via `medal.helpdesk.replies.create`, always pass an `idempotencyKey` — it is required for capability-scoped tokens.
- **Respond fast**: return a 2xx within 10 seconds; do slow work asynchronously.
- **Secret handling**: the endpoint secret is returned only by `webhooks.create`. If lost, delete the endpoint and create a new one.

## Error Handling

All API errors throw `MedalApiError` with structured error details:

```ts
import { Medal, MedalApiError } from '@medalsocial/sdk';

try {
  await medal.contacts.get('bad_id');
} catch (err) {
  if (err instanceof MedalApiError) {
    console.log(err.status);  // 404
    console.log(err.code);    // 'NOT_FOUND'
    console.log(err.message); // 'Contact not found'
    console.log(err.details); // field-level validation errors (if any)
  }
}
```

## Retries

The SDK automatically retries on `429` (rate limited) and `5xx` errors, up to 3 attempts with linear backoff. The `Retry-After` header is respected when present.

## Rate Limits

| Endpoint | Rate | Burst |
|----------|------|-------|
| Read (GET) | 300/min | 100 |
| Write (POST/PATCH/DELETE) | 60/min | 30 |
| Email send | 100/min | 50 |
| Email batch | 10/min | 5 |
| Contact import | 5/min | 3 |
| GDPR export | 5/hour | 2 |

## Pagination

List endpoints use cursor-based pagination:

```ts
let cursor: string | undefined;
do {
  const page = await medal.contacts.list({ limit: 100, cursor });
  console.log(page.data);
  cursor = page.pagination.next_cursor ?? undefined;
} while (cursor);
```

## OpenAPI 3.1

The SDK publishes a validated OpenAPI 3.1 contract for the API surface covered by the typed client.

```ts
import type { OpenApiComponents, OpenApiOperations, OpenApiPaths } from '@medalsocial/sdk';
import type { paths } from '@medalsocial/sdk/openapi-types';
```

Package artifacts:

- `@medalsocial/sdk/openapi.yaml` - source OpenAPI 3.1 YAML document
- `@medalsocial/sdk/openapi.json` - bundled JSON document generated during build
- `@medalsocial/sdk/openapi-types` - generated TypeScript contract types

Validate the contract locally:

```bash
pnpm openapi:check
```

## Runtime Support

Node.js 18+ and modern browsers. Uses native `fetch` — no polyfills required.

## License

Apache-2.0
