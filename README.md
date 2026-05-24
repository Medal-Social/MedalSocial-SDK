# Medal Social SDK

TypeScript SDK for the [Medal Social](https://medalsocial.com) API. Manage posts, emails, contacts, deals, and GDPR compliance programmatically.

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

### Workspaces

```ts
const { data: workspaces } = await medal.workspaces.list();
console.log(workspaces); // [{ id, name, slug }]
```

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
