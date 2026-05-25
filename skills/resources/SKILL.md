---
name: resources
description: Use when calling any of the SDK resources (contacts, deals, emails, gdpr, posts, workspaces) — listing with pagination, sending transactional or batch emails, scheduling and publishing posts, recording GDPR consent or running an export workflow, fetching a contact's activity timeline — or when needing OpenAPI-derived TypeScript types or the raw OpenAPI document from `@medalsocial/sdk`.
---

# Medal Social SDK — Resources

## When to load this skill

- Calling `medal.contacts.*`, `medal.deals.*`, `medal.emails.*`, `medal.gdpr.*`, `medal.posts.*`, or `medal.workspaces.*`.
- Looking up an exact method signature or response shape.
- Building a list view that needs pagination.
- Sending a single transactional email or a bulk batch.
- Running a GDPR data-export workflow (request → poll → fetch).
- Importing contacts from a CSV-like source.
- Needing OpenAPI-derived types for a custom fetch wrapper, generated mocks, or contract tests.

## Response shapes

Most methods return one of:

- **`ApiResponse<T>`** — single-result envelope: `{ data: T }` plus optional metadata.
- **`PaginatedResponse<T>`** — list envelope: `{ data: T[], pagination: { has_more: boolean, next_cursor: string | null } }`.

**One documented exception:** `medal.gdpr.cookieConsent(input)` returns a plain `{ success: boolean, logId?: string }` directly — no `data` envelope. Don't destructure `{ data }` from it. See the GDPR section below.

Errors throw `MedalApiError` (see the `client` skill for details).

## Resource map

| Namespace | Source | Methods |
|---|---|---|
| `medal.contacts` | `src/resources/contacts.ts` | `list(opts?)`, `create(input)`, `get(id)`, `update(id, input)`, `remove(id)`, `activities(id, opts?)`, `addNote(id, { content })`, `import(contacts[])` |
| `medal.deals` | `src/resources/deals.ts` | `list(opts?)`, `create(input)`, `get(id)`, `update(id, input)`, `remove(id)` |
| `medal.emails.templates` | `src/resources/emails.ts` (`EmailTemplates`) | `list()`, `get(slug, opts?)` |
| `medal.emails` | `src/resources/emails.ts` (`Emails`) | `send(input)`, `get(id)`, `batch(input)` |
| `medal.gdpr` | `src/resources/gdpr.ts` | `requestExport()`, `listExports()`, `getExport(id)`, `recordConsent(input)`, `getConsent(email)`, `cookieConsent(input)` |
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

// Poll until ready
async function waitForExport(id: string) {
  while (true) {
    const { data: exp } = await medal.gdpr.getExport(id);
    if (exp.status === "ready") return exp;
    if (exp.status === "failed") throw new Error(`Export ${id} failed`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
}
const exp = await waitForExport(req.request_id);

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
| Building a custom client when only types are needed | Reinventing the wheel | Import from `@medalsocial/sdk/openapi-types` |
