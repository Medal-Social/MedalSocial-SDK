---
name: resources
description: Use when calling any of the SDK resources (bookings, contacts, deals, emails, gdpr, posts, scan, workspaces) — listing with pagination, sending transactional or batch emails, scheduling and publishing posts, booking appointments or querying free slots, cancelling or rescheduling a booking as staff or on a customer's behalf, recording GDPR consent or running an export workflow, fetching a contact's activity timeline — or when needing OpenAPI-derived TypeScript types or the raw OpenAPI document from `@medalsocial/sdk`.
---

# Medal Social SDK — Resources

## When to load this skill

- Calling `medal.bookings.*`, `medal.contacts.*`, `medal.deals.*`, `medal.emails.*`, `medal.gdpr.*`, `medal.posts.*`, `medal.scan.*`, or `medal.workspaces.*`.
- Looking up an exact method signature or response shape.
- Building a list view that needs pagination.
- Sending a single transactional email or a bulk batch.
- Booking an appointment: reading the catalogue, querying free slots, creating a booking or party.
- Cancelling or rescheduling a booking — and deciding between the staff route and the customer manage-token route.
- Running a GDPR data-export workflow (request → poll → fetch).
- Importing contacts from a CSV-like source.
- Needing OpenAPI-derived types for a custom fetch wrapper, generated mocks, or contract tests.

## Response shapes

Most methods return one of:

- **`ApiResponse<T>`** — single-result envelope: `{ data: T }` plus optional metadata.
- **`PaginatedResponse<T>`** — list envelope: `{ data: T[], pagination: { has_more: boolean, next_cursor: string | null } }`.

**Two documented deviations:**

- `medal.gdpr.cookieConsent(input)` returns a plain `{ success: boolean, logId?: string }` directly — no `data` envelope. Don't destructure `{ data }` from it. See the GDPR section below.
- `medal.bookings.list(opts?)` returns `BookingsPage`, not `PaginatedResponse<Booking>` — its `pagination` carries an extra `truncated: boolean`. See the Bookings section below.

Errors throw `MedalApiError` (see the `client` skill for details).

## Resource map

| Namespace | Source | Methods |
|---|---|---|
| `medal.bookings` | `src/resources/bookings.ts` | `listServices(opts?)`, `listResources()`, `availability(opts)`, `list(opts?)`, `create(input, opts?)`, `get(id)`, `update(id, input, opts?)`, `cancel(id, input?, opts?)`, `reschedule(id, input, opts?)`, `markNoShow(id, opts?)` — all **staff** semantics (policy windows bypassed) |
| `medal.bookings.manage` | `src/resources/bookings.ts` (`BookingsManage`) | `get(token)`, `cancel(token, input?, opts?)`, `reschedule(token, input, opts?)` — **customer** semantics (policy windows enforced) |
| `medal.contacts` | `src/resources/contacts.ts` | `list(opts?)`, `create(input)`, `get(id)`, `update(id, input)`, `remove(id)`, `activities(id, opts?)`, `addNote(id, { content })`, `import(contacts[])` |
| `medal.deals` | `src/resources/deals.ts` | `list(opts?)`, `create(input)`, `get(id)`, `update(id, input)`, `remove(id)` |
| `medal.emails.templates` | `src/resources/emails.ts` (`EmailTemplates`) | `list()`, `get(slug, opts?)` |
| `medal.emails` | `src/resources/emails.ts` (`Emails`) | `send(input)`, `get(id)`, `batch(input)` |
| `medal.gdpr` | `src/resources/gdpr.ts` | `requestExport()`, `listExports()`, `getExport(id)`, `recordConsent(input)`, `getConsent(email)`, `cookieConsent(input)` |
| `medal.scan` | `src/resources/scan.ts` | `create(input)` (exactly one of `url`/`orgnr`/`name`; 202 async job), `get(id)`, `companies(q)` (Norwegian registry typeahead), `waitForResult(id, opts?)` (polls until done/failed; returns the job either way, throws only on deadline) |
| `medal.posts` | `src/resources/posts.ts` | `list(opts?)`, `create(input)`, `get(id)`, `update(id, input)`, `remove(id)`, `schedule(id, input)`, `publish(id)`, `channels()` |
| `medal.workspaces` | `src/resources/workspaces.ts` | `list()` |

**Note on naming:** `contacts.remove(id)` is `remove`, not `delete` — `delete` is a reserved word and was avoided. Same for `deals.remove(id)`, `posts.remove(id)`.

## Contacts

```ts
import { Medal } from "@medalsocial/sdk";
const medal = new Medal("medal_xxx");

// List with filters (paginated)
const { data: contacts, pagination } = await medal.contacts.list({ status: "lead" });

// Create
const { data: contact } = await medal.contacts.create({
  email: "alice@example.com",
  first_name: "Alice",
});

// Add a note to the contact's timeline — input is { content }, NOT { body }
await medal.contacts.addNote(contact.id, { content: "Followed up via email" });

// Fetch the activity timeline (paginated; events include notes, deals, emails, etc.)
const { data: activities } = await medal.contacts.activities(contact.id, { limit: 50 });

// Bulk import — MAX 500 contacts per call; duplicates are skipped server-side
await medal.contacts.import([
  { email: "a@x.com", first_name: "A" },
  { email: "b@x.com", first_name: "B" },
]);
```

## Posts — create, schedule, publish

```ts
// List channels first to know what channel_ids to target
const { data: channels } = await medal.posts.channels();

// Create
const { data: post } = await medal.posts.create({
  content: "Hello world!",
  channel_ids: [channels[0].id],
});

// Schedule for a future ISO 8601 timestamp
await medal.posts.schedule(post.id, { scheduled_at: "2026-06-15T10:00:00Z" });

// Or publish immediately (no schedule)
await medal.posts.publish(post.id);
```

`channels()` is the canonical way to discover what publishing destinations a workspace has connected — don't hard-code channel IDs.

## Bookings — catalogue, slots, and the two cancel/reschedule semantics

**Money is integer øre.** `amount_ore` and `price_ore` are whole øre — never divide into a float for storage or comparison, and never invent a "kroner" field. `499.90` is not representable and a rounding error in a price is a wrong invoice.

**Timestamps are asymmetric.** Responses render every timestamp as an ISO 8601 string. Requests accept *either* Unix milliseconds or an ISO string (`BookingTimestampInput = number | string`), so echoing a slot's `start_ts` straight back into `create()` is supported and is the intended flow. Don't normalise on the client.

```ts
const { data: services } = await medal.bookings.listServices();          // active-only
const { data: all } = await medal.bookings.listServices({ include_inactive: true });
const { data: resources } = await medal.bookings.listResources();        // staff / rooms / equipment

// Free slots — service_id, from_ts and to_ts are all REQUIRED; to_ts must be after from_ts
const { data: slots } = await medal.bookings.availability({
  service_id: services[0].id,
  from_ts: Date.now(),
  to_ts: Date.now() + 7 * 86_400_000,
  resource_id: resources[0].id,   // optional
});
```

Slots are computed at call time and are **not held** — a slot can be taken between `availability()` and `create()`. Handle the conflict error; don't assume a fetched slot is reserved.

**Creating is a party operation.** `items` is an array because one request books a whole family in one all-or-nothing transaction (max 50). A single appointment is just `items` of length 1.

```ts
const { data } = await medal.bookings.create(
  {
    items: [{ service_id: services[0].id, start_ts: slots[0].start_ts! }],
    contact: { phone: '+4790000000', name: 'Ida' },   // phone is the CRM dedupe key and is required
  },
  { idempotencyKey: crypto.randomUUID() },
);
data.bookings[0].manage_token;  // SHOW-ONCE
data.contact_id;
```

`manage_token` is a capability: whoever holds it can cancel or move that booking. Only its SHA-256 hash is stored, so the create response is the **only** place the plaintext token ever appears — persist it there if you need to build the customer's manage link. It is **absent** (the key is dropped, not nulled) when the response is replayed from an `Idempotency-Key`, which is why the type is `manage_token?: string`.

**A lost token cannot be recovered.** `bookings.get(id)` returns a `Booking`, which has no token field — there is nothing to re-read, and the stored hash is one-way. The only ways forward are to reschedule the booking (`reschedule` mints a fresh token) or to have staff act on it by id.

**The two semantics are picked by which namespace you call, not by an argument:**

| | `medal.bookings.cancel(id)` / `.reschedule(id, …)` | `medal.bookings.manage.cancel(token)` / `.reschedule(token, …)` |
|---|---|---|
| Who is acting | the business (your API key **is** the salon) | the customer, relayed by you |
| Policy windows | **bypassed** | **enforced** |
| Cancel attributed to | `staff` | `customer` |
| Addressed by | booking id | manage token |

Use the manage routes when you are relaying a customer's own click on the link in their confirmation email. Use the id routes for anything staff do. Reaching for the id route because "it always works" silently records a customer's cancellation as a staff one and skips the window the salon configured.

```ts
const { data: summary } = await medal.bookings.manage.get(manageToken);
if (summary.can_cancel) await medal.bookings.manage.cancel(manageToken, { reason: 'Endret plan' });
```

`can_cancel` / `can_reschedule` already apply the windows — honour them instead of re-deriving from `cancel_window_hours` and `start_ts`.

**A reschedule returns a NEW booking.** Both reschedule methods cancel the old row and insert a new one, so the result's `booking_id` is a new id and `manage_token` a newly minted token. The id and token you passed in are dead afterwards — re-store both, or the next manage link you send will 404.

**Listing carries a third pagination field.** `pagination.truncated` is separate from `has_more`: the underlying read is capped, and when the cap binds there are matching bookings that **no cursor from this call reaches**. Walking `has_more` to the end will not find them — narrow `from_ts`/`to_ts` and page again.

```ts
const page = await medal.bookings.list({ status: 'confirmed', from_ts: Date.now(), limit: 50 });
if (page.pagination.truncated) { /* window too wide — split the range */ }
```

`update(id, input)` is annotation only — `notes` (customer-visible) and `internal_notes` (staff-only); at least one is required, and `""` clears a field. It cannot move a booking or change its status.

## Emails — transactional + batch

**Single send (HTTP 202 — queued, not delivered):**

```ts
const { data: result } = await medal.emails.send({
  template_slug: "welcome",
  to: "user@example.com",
  name: "Alice",
  locale: "en",
  fallback_locale: "en",
  variables: { name: "Alice", trial_days: "14" },
  contact_id: contact.id,                // optional — links the send to a contact
});
// result.status is "queued"; poll medal.emails.get(result.id) for delivery state
```

**Templates:**

```ts
const { data: templates } = await medal.emails.templates.list();
const { data: detail } = await medal.emails.templates.get("welcome", { locale: "en" });
```

**Batch send (same template to many recipients) — MAX 100 recipients per call:**

```ts
const { data: summary } = await medal.emails.batch({
  template_slug: "newsletter-may",
  default_locale: "en",
  recipients: [
    { email: "a@x.com", name: "A", variables: { unsubscribe_token: "..." } },
    { email: "b@x.com", name: "B", locale: "fr", variables: { unsubscribe_token: "..." } },
  ],
});
// summary = { batch_id, total, queued, failed }
```

For more than 100 recipients, chunk into multiple `batch()` calls. There is no built-in chunker.

## GDPR — consent + export workflow

**Consent (per-contact):**

```ts
await medal.gdpr.recordConsent({
  email: "user@example.com",
  consent_type: "marketing_email",
  granted: true,
});
const { data: history } = await medal.gdpr.getConsent("user@example.com");
```

**Cookie consent** has a distinct return shape: `{ success: boolean, logId?: string }` — not the `ApiResponse<T>` envelope. Don't try to destructure `.data` from it.

```ts
const result = await medal.gdpr.cookieConsent({ /* ... */ });
result.success; // boolean
```

**Export workflow** — async; you initiate, then poll:

```ts
const { data: req } = await medal.gdpr.requestExport();
// req = { request_id, status }

// Poll until terminal. GdprExport.status is one of:
//   "pending" | "in_progress" | "completed" | "failed" | string
// "completed" is success; "failed" is terminal failure; anything else is still running.
async function waitForExport(id: string) {
  while (true) {
    const { data: exp } = await medal.gdpr.getExport(id);
    if (exp.status === "completed") return exp;
    if (exp.status === "failed") throw new Error(`Export ${id} failed`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
}
const exp = await waitForExport(req.request_id);
// exp.download_url and exp.expires_at are populated once completed

// Or list everything the workspace has ever exported
const { data: all } = await medal.gdpr.listExports();
```

## Pagination — concrete loop

`PaginationOptions` is `{ limit?: number, cursor?: string }`. To page through everything:

```ts
async function listAllContacts() {
  const out: Contact[] = [];
  let cursor: string | undefined;
  do {
    const page = await medal.contacts.list({ limit: 200, cursor });
    out.push(...page.data);
    cursor = page.pagination.has_more ? page.pagination.next_cursor ?? undefined : undefined;
  } while (cursor);
  return out;
}
```

`has_more` is the loop condition; `next_cursor` is what you pass on the next call. Don't loop on `next_cursor` alone — the API can return `has_more: false` with a non-null cursor when paging ends.

## OpenAPI types — for raw fetch, mocks, or custom wrappers

The package ships OpenAPI-derived types via a dedicated subpath:

```ts
import type { paths, components } from "@medalsocial/sdk/openapi-types";

type GetContactsResponse =
  paths["/contacts"]["get"]["responses"]["200"]["content"]["application/json"];

type Contact = components["schemas"]["Contact"];
```

Use these when building a custom fetch wrapper (e.g. in an edge function where you want zero dependencies), generating mocks for tests, or extending the SDK with a not-yet-wrapped endpoint.

## OpenAPI document — for codegen, docs, contracts

The raw OpenAPI 3.1 document is exported too:

```ts
// ESM import attributes (Node 24+, modern bundlers)
import openapi from "@medalsocial/sdk/openapi.json" with { type: "json" };

// or read the YAML directly from disk (Node)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const yamlPath = fileURLToPath(new URL("./node_modules/@medalsocial/sdk/openapi/medal-social.openapi.yaml", import.meta.url));
const yaml = readFileSync(yamlPath, "utf8");
```

The `with { type: "json" }` import-attribute syntax requires Node 24+ or a bundler with import-attribute support (Vite, esbuild, Webpack 5+). For older runtimes, read the JSON via `fs` instead.

## Anti-patterns

| Anti-pattern | Why it's wrong | Correct approach |
|---|---|---|
| `medal.contacts.delete(id)` | Method is `remove`, not `delete` (`delete` is reserved) | `medal.contacts.remove(id)` |
| `medal.contacts.addNote(id, { body })` | Input shape is `{ content }`, not `{ body }` | `medal.contacts.addNote(id, { content })` |
| `new Medal({ apiKey: "..." })` | Token is positional, not an option | `new Medal("medal_xxx")` |
| `medal.emails.list()` | Templates live at `medal.emails.templates.list()`; `emails.list()` doesn't exist | `medal.emails.templates.list()` |
| Treating `cookieConsent` result like `ApiResponse<T>` | Returns `{ success, logId? }` directly, not wrapped in `{ data }` | Read `result.success` directly |
| Treating `emails.send` as confirmation of delivery | API returns HTTP 202; status is `"queued"` | Poll `medal.emails.get(result.id)` for delivery state |
| `emails.batch` with > 100 recipients | API rejects; no client-side chunking | Chunk into 100-recipient batches yourself |
| `contacts.import` with > 500 contacts | API rejects | Chunk into 500-contact batches yourself |
| Hard-coded channel IDs in `posts.create` | Channels are workspace-specific | Call `posts.channels()` to discover them |
| Looping on `next_cursor` alone for pagination | Can be non-null when `has_more: false` | Loop on `pagination.has_more` |
| `medal.bookings.cancel(id)` to relay a customer's cancel | Bypasses the policy window and records `cancelled_by: 'staff'` | `medal.bookings.manage.cancel(token)` |
| Dividing `amount_ore` / `price_ore` into kroner for storage | Integer øre; a float rounds and the invoice is wrong | Keep the integer; format only at the point of display |
| Reusing the old id or manage token after a reschedule | Reschedule inserts a NEW booking and mints a NEW token | Store `result.booking_id` and `result.manage_token` |
| Expecting `manage_token` on an idempotent replay | Tokens are redacted from replayed responses | Persist it from the first response — a replay cannot give it back |
| Re-reading a booking to recover a lost `manage_token` | `Booking` has no token field and only the hash is stored — it is unrecoverable | Reschedule to mint a fresh token, or act by booking id as staff |
| `medal.bookings.update(id, {})` | Rejected by the API; now also a compile error | Pass at least one of `notes` / `internal_notes` |
| Ignoring `pagination.truncated` on `bookings.list` | Matching bookings exist that no cursor reaches | Narrow `from_ts`/`to_ts` and page again |
| Converting `start_ts` to a fixed format before sending | The API takes Unix ms **or** ISO 8601 | Pass a slot's `start_ts` straight through |
| Building a custom client when only types are needed | Reinventing the wheel | Import from `@medalsocial/sdk/openapi-types` |
