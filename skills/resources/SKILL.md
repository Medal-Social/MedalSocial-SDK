---
name: resources
description: Use when calling any of the SDK resources (contacts, deals, emails, gdpr, posts, workspaces) or when needing OpenAPI-derived TypeScript types or the raw OpenAPI document from `@medalsocial/sdk`. Load before calling resource methods or building a custom client.
---

# Medal Social SDK — Resources

## When to load this skill

- Calling `medal.contacts.*`, `medal.deals.*`, `medal.emails.*`, `medal.gdpr.*`, `medal.posts.*`, or `medal.workspaces.*`.
- Looking up an exact method signature or response shape.
- Needing OpenAPI-derived types for a custom fetch wrapper or extension.

## Response shapes

Every method returns one of:

- **`ApiResponse<T>`** — single-result envelope: `{ data: T }` plus optional metadata.
- **`PaginatedResponse<T>`** — list envelope: `{ data: T[], pagination: ... }`.

Errors throw `MedalApiError` (see the `client` skill for details).

## Resource map

| Namespace | Source | Common methods |
|---|---|---|
| `medal.contacts` | `src/resources/contacts.ts` | `list(opts?)`, `create(input)`, `get(id)`, `update(id, input)`, `remove(id)`, `activities(id, opts?)`, `addNote(id, input)`, `import(contacts[])` |
| `medal.deals` | `src/resources/deals.ts` | `list(opts?)`, `create(input)`, `get(id)`, `update(id, input)`, `remove(id)` |
| `medal.emails.templates` | `src/resources/emails.ts` (Templates class) | `list()`, `get(slug, opts?)` |
| `medal.emails` | `src/resources/emails.ts` (Emails class) | `send(input)`, `get(id)`, `batch(input)` |
| `medal.gdpr` | `src/resources/gdpr.ts` | `requestExport()`, `listExports()`, `getExport(id)`, `recordConsent(input)`, `getConsent(email)`, `cookieConsent(input)` |
| `medal.posts` | `src/resources/posts.ts` | `list(opts?)`, `create(input)`, `get(id)`, `update(id, input)`, `remove(id)`, `schedule(id, input)`, `publish(id)`, `channels()` |
| `medal.workspaces` | `src/resources/workspaces.ts` | `list()` |

**Note on naming:** `contacts.remove(id)` is `remove`, not `delete` — `delete` is a reserved word and was avoided. Same for `deals.remove(id)`, `posts.remove(id)`.

## Examples

```ts
import { Medal } from "@medalsocial/sdk";

const medal = new Medal("medal_xxx");

// Contacts
const { data: contacts, pagination } = await medal.contacts.list({ status: "lead" });
const { data: contact } = await medal.contacts.create({
  email: "alice@example.com",
  first_name: "Alice",
});
await medal.contacts.addNote(contact.id, { body: "Followed up via email" });

// Posts — create, schedule, publish
const { data: post } = await medal.posts.create({
  content: "Hello world!",
  channel_ids: ["ch_1"],
});
await medal.posts.schedule(post.id, { scheduled_at: "2026-03-15T10:00:00Z" });
await medal.posts.publish(post.id);

// Emails — transactional templates
await medal.emails.send({
  template_slug: "welcome",
  to: "user@example.com",
  variables: { name: "Alice" },
});

// GDPR
await medal.gdpr.recordConsent({
  email: "user@example.com",
  consent_type: "marketing_email",
  granted: true,
});

// Workspaces (mainly used to inspect what an OAuth token can reach)
const { data: workspaces } = await medal.workspaces.list();
```

## OpenAPI types — for raw fetch, mocks, or custom wrappers

The package ships OpenAPI-derived types via a dedicated subpath, so you can get compile-time safety against the same contract the SDK uses, without instantiating `Medal`:

```ts
import type { paths, components } from "@medalsocial/sdk/openapi-types";

type GetContactsResponse =
  paths["/contacts"]["get"]["responses"]["200"]["content"]["application/json"];

type Contact = components["schemas"]["Contact"];
```

Use these when:

- You're building a custom fetch wrapper (e.g. in an edge function where you want zero dependencies).
- You're generating mocks for tests.
- You want to extend the SDK with a not-yet-wrapped endpoint.

## OpenAPI document — for code generation, docs, or contracts

The raw OpenAPI 3.1 document is exported too:

```ts
import openapi from "@medalsocial/sdk/openapi.json" with { type: "json" };
// or, for YAML consumers:
// "@medalsocial/sdk/openapi.yaml"
```

Useful for downstream tools (Swagger UI, schema validation, contract tests).

## Pagination

List methods that return `PaginatedResponse<T>` accept `PaginationOptions` (`limit`, `cursor`/`page` — check the type per resource). Always pass through `pagination.next_cursor` or equivalent until exhausted; do not assume the first page is the whole list.

## Anti-patterns

| Anti-pattern | Why it's wrong | Correct approach |
|---|---|---|
| `medal.contacts.delete(id)` | Method is `remove`, not `delete` (`delete` is reserved) | Use `medal.contacts.remove(id)` |
| `new Medal({ apiKey: "..." })` | Token is positional, not an option | `new Medal("medal_xxx")` |
| Manual JSON parsing of `ApiResponse` | Already returned as typed object | Destructure `{ data }` from the result |
| Building a custom client when only types are needed | Reinventing the wheel | Import from `@medalsocial/sdk/openapi-types` |
| Looping `list()` without honoring pagination cursor | Silently truncates results | Loop until `pagination.next_cursor` is empty |
