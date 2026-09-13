# Medal Social SDK

TypeScript SDK for the [Medal Social](https://medalsocial.com) API. Manage posts, emails, contacts, deals, helpdesk conversations, webhooks, company/site scans, and GDPR compliance programmatically.

## Install

```bash
npm install @medalsocial/sdk
# or
pnpm add @medalsocial/sdk
```

No runtime dependencies. The optional `@medalsocial/sdk/pilot` entry (zod tool
schemas for agents) needs `zod` 4, declared as an **optional peer** — install it
only if you import that entry:

```bash
pnpm add zod
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

// List posts — status is the closed PostStatus set; date filters take Unix ms or ISO 8601
const posts = await medal.posts.list({
  status: 'scheduled',
  type: 'social',
  platforms: ['linkedin', 'x'],
  scheduled_from: '2026-07-01T00:00:00Z',
  scheduled_to: Date.now() + 7 * 86_400_000,
  query: 'launch',
  limit: 50,
});

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

// List with filters — status is 'lead' | 'subscriber' | 'customer' | 'churned'
const contacts = await medal.contacts.list({
  status: 'lead',
  email_status: 'subscribed',
  label_ids: ['lbl_1'],
  search: 'john',
  limit: 50,
});

// "The contact for this e-mail": exact match, not a fuzzy search
const { data: [byEmail] } = await medal.contacts.list({ email: 'john@example.com' });

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

// Move it along the pipeline: draft → negotiating → offer_sent → signed → completed | declined
const { data: updated } = await medal.deals.update(deal.id, { status: 'signed' });
const { data: unlinked } = await medal.deals.update(deal.id, { contact_id: null }); // unlink contact

const deals = await medal.deals.list({
  status: 'negotiating',
  search: 'Acme',
  contact_id: 'c_123',
  min_value: 25000,
  close_date_from: '2026-07-01T00:00:00Z', // Unix ms or ISO 8601
  close_date_to: Date.now() + 30 * 86_400_000,
});
const { data: removed } = await medal.deals.remove(deal.id);
console.log(updated.success, unlinked.success, removed.success);
```

A deal always starts at `draft`; `status` is only accepted on `update`, and only the six values above — anything else is a `400`. **Dates are asymmetric:** `start_date` / `end_date` are *sent* as ISO 8601 (or `YYYY-MM-DD`) strings but come *back* as Unix milliseconds (`number | null`), so `new Date(deal.end_date)` is the right call on the way out.

**`value` is in MAJOR currency units** — `50000` is fifty thousand kroner, not
five hundred — and decimals are accepted (`1999.5`). This is the opposite
convention from bookings, where money is integer **øre** (`amount_ore`,
`price_ore`), and a deal carries no minor-unit field at all: if you use both
surfaces, convert explicitly (`value = amount_ore / 100`). `currency` is one of
`USD` / `EUR` / `GBP` / `NOK`; anything else is a `400`.

### Bookings

Money is always **integer øre** (`amount_ore`, `price_ore`) — never a float, never kroner. Timestamps come back as ISO 8601 strings; on the way in, either Unix milliseconds or an ISO string is accepted.

```ts
// Catalogue + free slots (services.list() / resources.list() are the same calls)
const { data: services } = await medal.bookings.services.list();
const { data: resources } = await medal.bookings.resources.list();
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
// "How many bookings did our website bring in?" — created_via filters the WHOLE column
const fromSite = await medal.bookings.list({ created_via: 'web', from_ts: monthStart, to_ts: monthEnd });
console.log(page.pagination.has_more, page.pagination.next_cursor, page.pagination.truncated);
```

#### The day, and what needs a human

```ts
// The salon's operating summary for ONE local date. date_key is the WORKSPACE's
// calendar date (yyyymmdd), so a caller in another zone still reads the salon's
// day; omit it for today.
const { data: today } = await medal.bookings.today();
today.remaining;                 // appointments still to come
today.closed_for_today;          // past the last opening window of a day that DID open
today.next_gap?.start_ts;        // next free stretch, as an instant
today.revenue.total_ore;         // integer øre, split in revenue.by_provider
today.truncated;                 // a source hit its cap, so the counts are floors

// Open items a human has to act on. NOT a page: `truncated` is a read budget,
// not a cursor, and `total` is exact only while it is false.
const attention = await medal.bookings.attention();
for (const item of attention.data) {
  // No prose crosses the wire — render the sentence from `kind`
  // (payment_failed | payment_released | payment_partial_capture |
  //  waitlist_offer_expiring | event_consent_missing | booking_attachment |
  //  no_show_today) and the ids/amounts on the item.
  render(item.kind, item.booking_id, item.amount_ore, item.deadline_at);
}
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

**Booking writes are idempotent by default.** The SDK retries 429/5xx automatically, so every booking `POST` (`create`, `cancel`, `reschedule`, `markNoShow`, `payment.start`, and the `manage` writes) carries a generated `Idempotency-Key` — a retry after a gateway failure replays the original result instead of booking the slot twice. Supply your own `options.idempotencyKey` to extend that guarantee across *your* retries too: the server remembers a key for 24 hours, keyed by `(key, workspace, method + path)`.

`update(id, input)` requires at least one of `notes` / `internal_notes`; `update(id, {})` is a compile error, matching the API's own 400.

#### Persons, relations and events

`medal.bookings.persons` are the children, pets, or employees a contact books for — no login of their own. `medal.bookings.relations` links two contacts directionally (guardian, employer, partner, and so on). `medal.bookings.events` are arrangementer — scheduled group sessions bookings register against.

```ts
// Persons a contact books for (active-only unless include_inactive)
const { data: persons } = await medal.bookings.persons.list(contact.id);

// Add a person under a contact
const { data: person } = await medal.bookings.persons.create({
  contact_id: contact.id,
  name: 'Ola',
  birth_year: 2018,
  relation_type: 'guardian',
});

// Events in a date range (yyyy-mm-dd, inclusive) — one month, optionally one host
const { data: events } = await medal.bookings.events.list({
  from: '2026-09-01',
  to: '2026-09-30',
  host_id: resources[0].id,   // optional
});

// Register a child for an arrangement
const { data: registration } = await medal.bookings.events.register(events[0].event_id, {
  guardian: { name: 'Kari Hansen', email: 'kari@example.no', phone: '+4790000000' },
  child: { name: 'Nora', birth_year: 2020 },
  service_id: services[0].id,
  consent_accepted: true,           // must be literally true — 400 otherwise
  consent_version: '2026-09',       // optional — your own label for the wording shown
  return_url: 'https://example.no/retur',   // only needed if the service requires payment
});
// registration.booking carries event_id / event_order; registration.manage_token is
// SHOW-ONCE like CreatedBooking.manage_token (omitted entirely on an idempotent replay).
// registration.contact_id / registration.person_id are the guardian's contact and the
// child's ContactPerson, created or reused. registration.payment is null when the
// service needs no payment, otherwise the same show-once redirect payment.start returns.
// A payment failure does not undo the registration — check registration.payment_error
// and retry with bookings.payment.start(registration.booking.id, ...) rather than
// registering again.

// An arrangement's roster, ordered by event_order (cancelled rows included)
const { data: roster } = await medal.bookings.events.registrations(events[0].event_id);
roster.registrations[0]?.participant_name;   // read from the live person, not a snapshot
roster.truncated;                            // true past 300 rows — event_order is no longer trustworthy

// Hosts — where an arrangement is held. A landing page resolves one by `slug`
// instead of putting the host id in the URL.
const { data: hosts } = await medal.bookings.events.hosts.list();
// Find-or-create BY NAME: 201 when a row was inserted, 200 when an existing host
// matched — and a matched host comes back UNCHANGED, so a corrected address sent
// here is dropped.
const { data: host } = await medal.bookings.events.hosts.create({
  name: 'Sol barnehage',
  address: 'Solveien 1',
  note: 'inngang B, ring på',
});
// …which is why correcting one has its own route. `null` erases; `retired: true`
// retires the host (events already point at it, so it is never deleted).
await medal.bookings.events.hosts.update(host.id, { address: 'Solveien 2', note: null });

// Remove an arrangement DAY — the one delete on this surface. OAuth callers need
// the workspace `admin` role. A completed day is 422; a day with any
// non-cancelled registration is 409 (cancel those first, which releases each
// participant's place and payment hold).
const { data: removed } = await medal.bookings.events.remove(events[0].event_id);
removed.mode; // 'hard' = the row is gone; 'soft' = kept as a tombstone for cancelled registrations
```

#### Payments

`medal.bookings.payment` takes a Vipps payment on a booking as the business; `medal.bookings.manage.payment` does the same on the customer's behalf, keyed by the manage token. `Booking.payment_mode` (and `ManageSummary.payment_mode`) says what the booking requires — `payment_status: 'none'` cannot tell "owes nothing" from "has not paid yet".

```ts
const { data: started } = await medal.bookings.payment.start(booking.id, {
  return_url: 'https://example.no/retur',
  terms_accepted: true,          // must be literally true — 400 otherwise
  terms_version: '2026-09',
});
// Hand started.redirect_url to the Vipps Widget SDK UNCHANGED. It is SHOW-ONCE:
// payment.get() never returns it, and the payment behind it expires in 10 minutes.

const { data: payment } = await medal.bookings.payment.get(booking.id);
payment.state;        // created | authorized | captured | cancelled | refunded | failed | expired
payment.captured_ore; // integer øre — a Vipps payment stays AUTHORIZED after a capture,
                      // so the aggregates, not `state`, say what actually moved
```

**Never trust the return redirect.** The customer can close the tab, hit back, or edit the URL — the outcome reaches you through Medal. Poll on your return page, or read the booking's `payment_status`.

Prepay, end to end, in four calls:

```ts
const { data: slots } = await medal.bookings.availability({ service_id, from_ts, to_ts });
const { data: created } = await medal.bookings.create({
  items: [{ service_id, start_ts: slots[0].start_ts! }],
  contact: { phone: '+4790000000', name: 'Ida' },
});
const { data: started } = await medal.bookings.payment.start(created.bookings[0].id, {
  return_url: 'https://example.no/retur',
  terms_accepted: true,
});
// …hand started.redirect_url to the Vipps Widget SDK, then on your return page:
const payment = await medal.bookings.payment.waitForSettlement(created.bookings[0].id);
if (payment.state !== 'authorized' && payment.state !== 'captured') {
  return renderRetry(payment.failure_code);
}
```

`waitForSettlement` resolves for **every** settled state (`authorized`,
`captured`, `cancelled`, `refunded`, `failed`, `expired`) — branch on `state`,
not on whether it threw. It throws only when the deadline passes with the
customer still in the wallet (default ten minutes, the payment's own lifetime),
and a `404` (no payment on the booking) propagates unchanged.
`medal.bookings.manage.payment.waitForSettlement(manageToken)` is the
customer-side twin and polls once a second, because that route has its own
`apiBookingPoll` bucket.

The customer must accept your terms **before** a payment is initiated: `terms_accepted: true` is required by the type *and* by the API, and a request without it leaves no payment (and no consent record) behind. A `return_url` your workspace's own sites do not vouch for answers **422**, not 400 — the URL parses, it is just not yours. Starting a second payment while one is live answers **409**, and `payment.get(...)` on a booking with no payment yet answers **404**, exactly as an unknown booking does.

### Customer portal

Self-service for the workspace's own customers: they sign in with an e-mailed one-time code, then see and change their profile, list their bookings, export their data, or erase their account. The API key needs `read:portal` and `write:portal`.

The session token is a **bearer credential for one contact**. Your site's server exchanges the code for it and keeps it in an **HttpOnly cookie on the site's own domain** — never hand it to the browser, and never let the browser call Medal directly. Session-bound methods take the token as their first argument and send it as `X-Portal-Session`.

```ts
// 1. Send the code. Always { status: 'sent' } — enumeration-safe, so "sent" does
//    not confirm the address belongs to a contact.
//    locale is 'no' | 'en' — the API refuses 'nb' with a 400.
await medal.portal.login.start({ email: 'ida@example.com', locale: 'no' });

// 2. Exchange the code the customer typed. Wrong, burned and expired codes all
//    answer 401 PORTAL_CODE_INVALID.
const { data: session } = await medal.portal.login.verify({ email: 'ida@example.com', code: '123456' });
// -> set an HttpOnly, Secure, SameSite cookie holding session.session_token,
//    expiring at session.expires_at (Unix ms)

// 3. Session-bound calls, from your server, with the token read back from the cookie
const { data: me } = await medal.portal.me(session.session_token);
// me.persons (the contact's bookings.persons) and me.labels (the workspace's own
// words for the person concept, e.g. { person: 'Barn', persons: 'Barn' }) are new
const { data: bookings } = await medal.portal.myBookings(session.session_token);
// bookings.upcoming[i].manage_token is set while the booking is still manageable —
// it opens your site's manage page (medal.bookings.manage.*); past bookings carry null
await medal.portal.updateMe(session.session_token, {
  phone: '+4790000000',
  family: [{ name: 'Ola', birth_year: 2018 }],   // replaces the whole list
  marketing_consent: true,                        // recorded as a marketing_email consent, source 'portal'
});
const { data: exported } = await medal.portal.exportMyData(session.session_token); // GDPR Art. 15, synchronous
await medal.portal.logout(session.session_token);     // 204 — revokes this session only
// …or, when the customer asks to be forgotten (terminal — the session is revoked, a later
// logout() would answer 401 PORTAL_SESSION_INVALID):
await medal.portal.deleteMe(session.session_token);   // GDPR Art. 17 — 204
```

`401 PORTAL_SESSION_REQUIRED` (header missing) and `401 PORTAL_SESSION_INVALID` (unknown, expired or revoked) both mean "sign in again" — clear the cookie and send the customer back to step 1. `403 FORBIDDEN` means the key lacks the portal scopes; `429 RATE_LIMITED` applies per address and per caller on `login.start`.

Bind the token once instead of passing it to every method — the flat,
session-first methods are unchanged, this is additive:

```ts
const me = medal.portal.session(session.session_token);
const { data: profile } = await me.profile();
const { data: bookings } = await me.bookings();
await me.update({ phone: '+4790000000' });
const { data: exported } = await me.export();
await me.logout();       // …or me.delete() for GDPR Art. 17
```

It exists because the flat form takes the token **first**
(`updateMe(session, patch)`), so a swapped pair type-checks whenever both are
strings.

None of the portal calls carries an `Idempotency-Key`: the two login routes cannot duplicate anything, and the session routes are either reads or terminal.

#### Log in with Vipps

Two server calls; the middle leg is the customer's browser.

```ts
// 1. Your server starts the flow and redirects the customer to the wallet.
//    return_url must be an https URL under one of the workspace's own sites —
//    400 INVALID_RETURN_URL otherwise. 503 VIPPS_NOT_CONFIGURED means this
//    deployment has no Vipps login: fall back to the e-mail code.
const { data: start } = await medal.portal.login.vipps.start({
  return_url: 'https://salon.no/min-side',
});
redirect(start.authorize_url);        // never cache it — it carries a one-time state

// 2. Vipps sends the customer to Medal's callback, which redirects back to your
//    return_url with ?grant=… — or ?vipps=needs_email_login / ?vipps=failed,
//    on which you fall back to medal.portal.login.start(...).

// 3. Your server exchanges the grant. Single-use: a second exchange answers
//    404 GRANT_NOT_FOUND, which is also the answer for an expired grant.
const { data: session } = await medal.portal.login.vipps.exchange({ grant });
// -> same HttpOnly cookie as the e-mail flow; session.expires_at_iso is the ISO twin
```

**Portal booking timestamps are Unix milliseconds** (`start_ts`, `end_ts`) with
ISO twins beside them (`start_ts_iso`, `end_ts_iso`) — unlike
`/api/v1/bookings/*`, where `start_ts` is an ISO string. The SDK types what each
endpoint actually returns rather than normalising one into the other.

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

// Cookie consent (server-to-server, from your own backend).
// `domain` must be one your workspace's registered sites vouch for, or the
// call is refused with 403. Never call this from a browser — it uses your
// workspace API key. Browser-side consent goes to /api/cookie-consent/public
// with the site's public `pk_consent_*` key instead.
await medal.gdpr.cookieConsent({
  event: 'preferences_saved',
  consentId: 'CID-00001234',
  domain: 'example.com',
  categories: {
    essential: true,
    analytics: true,
    marketing: false,
    functional: true,
  },
  policyVersion: '2.1',
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
  channels: ['widget', 'whatsapp'],  // channel filter (the closed HelpdeskChannel set)
  limit: 50,
});

// Triage: what has nobody picked up yet? `assigned: false` is the question
// `assignee_user_id` cannot ask; `chat_type` narrows personal-account
// channels (Telegram) to DMs, groups or broadcast channels.
const unowned = await medal.helpdesk.conversations.list({ assigned: false, chat_type: 'group' });

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

**Upstream deletions.** When the customer deletes a message on the external channel (Telegram today), the message is kept as a *tombstone* so the thread still reads in order: `externally_deleted_at` carries the Unix-ms timestamp of the deletion, `body` is empty and any attachment has been erased. Mirror the deletion in your own store rather than treating it as a blank message; the push-side signal is the `helpdesk.message_deleted` webhook event, whose payload deliberately carries an empty body too.

#### Linking a thread to a CRM contact

A partner usually knows which external user is which customer, and Medal cannot
derive it — Telegram exposes no e-mail, hides phone numbers, and usernames are
mutable. So the link is yours to assert:

```ts
// Exactly one of contact_id or email; an email resolves through the CRM's own
// find-or-create, so you do not have to pre-create contacts.
const { data: linked } = await medal.helpdesk.conversations.linkContact(conversationId, {
  email: 'ida@example.no',
});
linked.conversations_updated;  // the link is stored on the SENDER, so it reaches
                               // their older threads too
linked.previous_contact_id;    // set when this replaced an existing link

// Reversing a mistake is idempotent: a thread with no contact answers unlinked: false
const { data: unlinked } = await medal.helpdesk.conversations.unlinkContact(conversationId);
```

A group thread — or a channel with no stable sender — answers
`422 CONVERSATION_NOT_LINKABLE`. Both routes are confirmable writes: a
capability-scoped credential needs an `X-Capability-Confirmation` (see below).

### Webhooks

```ts
// Create an endpoint. The signing secret is returned EXACTLY ONCE — store it
// securely immediately; you cannot retrieve it again.
const { data: endpoint } = await medal.webhooks.create(
  {
    name: 'Helpdesk bridge',
    url: 'https://example.com/medal/webhook', // must be https
    // Typed as SubscribableWebhookEventType[] — a typo is a compile error, not a runtime 400
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

| Capability id | Route | SDK method |
|---|---|---|
| `channel.connect_link.create.execute` | `POST /api/v1/channels/connect-links` | `channels.connectLinks.create` |
| `channel.connect_link.revoke.execute` | `DELETE /api/v1/channels/connect-links/{id}` | `channels.connectLinks.revoke` |
| `channel.connection.disconnect.execute` | `DELETE /api/v1/channels/connections/{id}` | `channels.connections.disconnect` |
| `compliance.gdpr.export.execute` | `POST /api/v1/gdpr/export` | `gdpr.requestExport` |
| `content.post.draft.create` | `POST /api/v1/posts` | `posts.create` |
| `content.post.publish.execute` | `POST /api/v1/posts/{id}/publish` | `posts.publish` |
| `content.post.schedule.execute` | `POST /api/v1/posts/{id}/schedule` | `posts.schedule` |
| `crm.contact.note.create.execute` | `POST /api/v1/contacts/{id}/notes` | `contacts.addNote` |
| `deals.deal.create.execute` | `POST /api/v1/deals` | `deals.create` |
| `deals.deal.update.execute` | `PATCH /api/v1/deals/{id}` | `deals.update` |
| `email.campaign.send.execute` | `POST /api/v1/emails` **and** `POST /api/v1/emails/batch` | `emails.send`, `emails.batch` |
| `helpdesk.conversation.link_contact.execute` | `PUT /api/v1/helpdesk/conversations/{id}/contact` | `helpdesk.conversations.linkContact` |
| `helpdesk.conversation.reply.execute` | `POST /api/v1/helpdesk/replies` | `helpdesk.replies.create` |
| `helpdesk.conversation.unlink_contact.execute` | `DELETE /api/v1/helpdesk/conversations/{id}/contact` | `helpdesk.conversations.unlinkContact` |
| `helpdesk.conversation.update.execute` | `PATCH /api/v1/helpdesk/conversations/{id}` | `helpdesk.conversations.update` |
| `helpdesk.webhook.create.execute` | `POST /api/v1/webhooks` | `webhooks.create` |
| `helpdesk.webhook.update.execute` | `PATCH /api/v1/webhooks/{id}` | `webhooks.update` |
| `helpdesk.webhook.delete.execute` | `DELETE /api/v1/webhooks/{id}` | `webhooks.delete` |

`CAPABILITY_IDS` (a typed union via `CapabilityId`) and `CAPABILITY_ROUTES` cover
those **and** the confirmable API capabilities this SDK has no method for yet —
`ai.text.generate`, `channel.telegram_sync_config.update.execute`,
`content.post.media.attach.execute`, `email.draft.create.execute`,
`flows.enrollment.create.execute`, `image.generation.execute`,
`media.generated_asset.save.execute` and the two `site.sanity.document.*` ids.
They are valid input to `medal.capabilityConfirmations.create(...)`, so a route
you call with `fetch` can still be confirmed through the SDK.

Two ids map to **more than one route** (`email.campaign.send.execute` and
`ai.text.generate`). The mint refuses those without an explicit `api_path`
(`400 CAPABILITY_API_PATH_REQUIRED`) — the SDK sends it for you, and
`CAPABILITY_ROUTES[id].alternate_path_templates` names the others.

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

Auto-confirm reaches every resource that owns a confirmable route: `channels`,
`helpdesk`, `webhooks`, `contacts`, `deals`, `emails`, `gdpr` and `posts`. (It
used to be wired into only the first three, so a capability-scoped key calling
`deals.update` got a `428` with no way to satisfy it.)

### Workspaces

```ts
const { data: workspaces } = await medal.workspaces.list();
console.log(workspaces); // [{ id, name, slug }]
```

## Naming

`remove` and `delete` are aliases wherever both read naturally —
`contacts.remove(id)` / `contacts.delete(id)`, `deals`, `posts`, `webhooks`,
`bookings.events` — and the domain verbs keep a `delete` alias too
(`channels.connectLinks.revoke` / `.delete`,
`channels.connections.disconnect` / `.delete`). Pick whichever reads better at
the call site; they are the same request.

The bookings catalogue is available both ways for the same reason:
`bookings.services.list()` ≡ `bookings.listServices()`, and
`bookings.resources.list()` ≡ `bookings.listResources()`.

Every write takes an optional trailing `options` (`RequestOptions`): an
`idempotencyKey`, a `capabilityConfirmation`, `autoConfirm`, `retry: false`,
extra `headers`, or a `signal`.

## Helpdesk bridge

Build a two-way bridge: receive helpdesk events on a webhook, and reply through the API.

Every delivery is signed. The `X-Medal-Signature` header carries `sha256=<base64(HMAC-SHA256("{timestamp}.{rawBody}", secret))>`, where `timestamp` is the `X-Medal-Timestamp` header (Unix ms). Use `verifyWebhookSignature` to authenticate the delivery and get a fully typed event back — it recomputes the HMAC with Web Crypto, so it runs on Node.js, Deno, Bun and Cloudflare Workers alike and rejects stale timestamps (default tolerance 5 minutes).

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

A call can fail three ways, and each has a type:

| Class | `code` | When |
|-------|--------|------|
| `MedalApiError` | the API's `error.code` | The API answered with a 4xx/5xx |
| `MedalTimeoutError` | `TIMEOUT` | The per-attempt deadline elapsed |
| `MedalNetworkError` | `NETWORK` | The request never produced a response (DNS, TLS, reset, offline) |

All three extend `MedalError`, so one clause covers every failure the SDK
raises. Cancelling through your own `AbortSignal` is *not* one of them — that
rejects with your abort reason, unchanged.

```ts
import { Medal, MedalApiError, MedalError, MedalTimeoutError } from '@medalsocial/sdk';

try {
  await medal.contacts.get('bad_id');
} catch (err) {
  if (err instanceof MedalApiError) {
    console.log(err.status);       // 404
    console.log(err.code);         // 'NOT_FOUND' — a MedalErrorCode
    console.log(err.message);      // 'Contact not found'
    console.log(err.details);      // field-level validation errors (if any)
    console.log(err.requestId);    // 'req_…' from X-Request-ID — quote this to support
    console.log(err.retryAfterMs); // 42000 on a 429, else null
  } else if (err instanceof MedalTimeoutError) {
    console.log(err.timeoutMs);
  } else if (err instanceof MedalError) {
    console.log(err.code);         // 'NETWORK'
  }
}
```

Branch on `code`, never on `message`: the message is prose, the code is the
contract. `MedalErrorCode` is exported as a union of the codes the API throws
today (`IDEMPOTENCY_IN_PROGRESS`, `CAPABILITY_CONFIRMATION_REQUIRED`,
`PORTAL_CODE_INVALID`, `INVALID_RETURN_URL`, …) widened with `string`, so a code
Medal adds later still type-checks — treat an unknown one as a generic failure
of its HTTP status. The full list also ships in the OpenAPI document as
`x-medal-error-codes`.

## Retries

`429` and `5xx` are retried up to 3 attempts, and so is a network failure on a
request that is safe to repeat — a `GET`, or a write that carries an
`Idempotency-Key` (every `create`, `send`, `publish`, `schedule` and booking
action mints one). An unkeyed `POST` is sent exactly once: "the connection
dropped" says nothing about whether the write committed.

The wait between attempts is a server-specified `Retry-After` when there is one
(both wire forms: delay-seconds and HTTP-date), otherwise an exponential backoff
— 250 ms, then 500 ms — spread ±25% so a fleet knocked back by one 503 does not
return in lock-step.

Pass `{ retry: false }` on a call whose first attempt may have succeeded even
though the response was lost (a one-time code, a logout, an erasure).

### Cancelling

Every method takes an optional `signal`, merged with the client's own timeout.
It also interrupts a retry that is waiting out its backoff, so an abandoned call
stops costing time immediately:

```ts
const controller = new AbortController();
const page = medal.contacts.list({ status: 'lead' }, { signal: controller.signal });
// …user navigated away
controller.abort();
```

## Rate Limits

Every bucket is keyed **per credential** (per API key, or per OAuth user), and
they are separate buckets: a busy return page cannot starve the salon's own
staff reads. A `429` carries `Retry-After`, which the SDK honours automatically
and also exposes as `MedalApiError.retryAfterMs`.

| Bucket | Routes | Rate | Burst |
|--------|--------|------|-------|
| `apiRead` | every `GET` not listed below | 300/min | 100 |
| `apiWrite` | every `POST` / `PATCH` / `PUT` / `DELETE` not listed below | 60/min | 30 |
| `apiEmailSend` | `POST /emails` | 100/min | 50 |
| `apiEmailBatch` | `POST /emails/batch` | 10/min | 5 |
| `apiImport` | `POST /contacts/import` | 5/min | 3 |
| `apiGdprExport` | `POST /gdpr/export` | 5/hour | 2 |
| `apiScanRequest` | `POST /scan` (front door) | 120/min | 60 |
| `apiScanCreate` | `POST /scan` (charged only when a crawl really starts) | 15/min | 30 |
| `apiScanRead` | `GET /scan/{id}`, `GET /scan/companies` | 1200/min | 300 |
| `apiBookingPoll` | `GET /bookings/manage/{token}/payment` | 600/min | 200 |
| `apiPortalLoginStart` | `POST /portal/login/start` | 60/min | 20 |
| `apiPortalLoginVerify` | `POST /portal/login/verify` | 60/min | 20 |
| `apiPortalVippsStart` | `POST /portal/vipps/start` | 60/min | 20 |
| `apiPortalVippsExchange` | `POST /portal/vipps/exchange` | 60/min | 20 |
| `apiPortalVippsCallback` | `GET /portal/vipps/callback` (browser, keyed per client IP) | 300/min | 100 |
| `apiPortalExport` | `POST /portal/me/export` | 60/hour | 10 |
| `apiConnectLinkMint` | `POST /channels/connect-links` | 10/hour | 5 |
| `apiCookieConsent` | `POST /api/cookie-consent` | 600/min | 1200 |
| `oauthIntrospect` | OAuth token introspection | 600/min | 200 |

The customer-facing buckets (`apiBookingPoll`, `apiPortal*`, `apiScan*`) are
keyed per API key too — and one site key serves every visitor — so they bound
the **site's aggregate** volume, not one visitor's. `apiBookingPoll` is why
`bookings.manage.payment.waitForSettlement(...)` polls once a second by default
while the booking-id twin waits 2.5 s on the shared `apiRead` bucket.

### Scopes and role floors

A scope says what a credential may do; an OAuth credential additionally inherits
the **workspace role of the user who granted it**, and some routes refuse below a
floor. A workspace API key is an admin-minted credential and is never held to the
role floor.

| Surface | Scope | OAuth role floor |
|---------|-------|------------------|
| Posts, contacts, deals, e-mails, bookings, helpdesk reads/replies | the route's own `*.read` / `*.manage` scope | member |
| `webhooks.*` (read and write) | `helpdesk.webhook.manage` | **admin** |
| `channels.connectLinks.*`, `channels.connections.disconnect` | `channel.connect.manage` | **admin** |
| `bookings.events.remove` | `write:bookings` | **admin** |
| `gdpr.requestExport`, `gdpr.listExports`, `gdpr.getExport` | `compliance.gdpr.export` | **owner** |

A credential below the floor answers `403 FORBIDDEN`.

## Pagination

Most list endpoints have an `iter()` twin that walks the pages for you:

```ts
for await (const contact of medal.contacts.iter({ status: 'lead' })) {
  await sync(contact);
}
```

`iter()` exists on `contacts`, `deals`, `posts`, `helpdesk.conversations`,
`channels.connectLinks` and `channels.connections`. Pages are fetched lazily —
`break` and the next one is never requested — and the loop is driven off
`pagination.has_more`, which matters because several filters are applied
**within** a page: a page can hold fewer rows than `limit`, or none at all,
while more pages remain. A hand-rolled loop that stops on a short page silently
drops the rest.

`list()` is unchanged if you want the raw page:

```ts
let cursor: string | undefined;
do {
  const page = await medal.contacts.list({ limit: 100, cursor });
  console.log(page.data);
  cursor = page.pagination.next_cursor ?? undefined;
} while (cursor);
```

`bookings.list()` deliberately has no `iter()`: its page also carries
`pagination.truncated`, which says matching bookings exist that **no cursor
reaches** (narrow `from_ts` / `to_ts`), and an iterator would hide that.

Use `paginate(fetchPage)` — exported from the package — to get the same walk over
any paginated call the SDK does not wrap yet.

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

Node.js 22+ (see `engines.node`; the unit suite runs on 22 and 24 in CI) and modern browsers. Uses native `fetch` — no polyfills required. The client itself only needs `fetch`, `AbortController`, `WritableStream` and Web Crypto, but Node 20 reached end-of-life in April 2026 and the SDK's own toolchain (pnpm 11, `changesets`, `secretlint`, `lint-staged`) needs 22.13+, so 22 is the floor the SDK certifies.

The individual helpers only need Web Crypto and `fetch`, so they also run on Deno, Bun and Cloudflare Workers.

## License

Apache-2.0
