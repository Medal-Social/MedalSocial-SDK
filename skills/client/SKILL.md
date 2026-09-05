---
name: client
description: Use when instantiating the `Medal` class from `@medalsocial/sdk`, configuring auth (API key vs OAuth), setting `baseUrl`, debugging an HTTP response or `MedalApiError`, reasoning about retry behavior, or running the SDK in a browser / edge runtime. Required reading before any code that calls into the SDK at the client level.
---

# Medal Social SDK — Client

## When to load this skill

- Instantiating `new Medal(...)`.
- Choosing between an API key and an OAuth access token.
- Configuring `baseUrl`, `timeout`, or `workspaceId`.
- Debugging a 4xx / 5xx response.
- Reasoning about whether a failed request will be retried.
- Running the SDK in a browser, Cloudflare Worker, Deno, or Bun.

## Base URL — the most common pitfall

**The Medal Social API base URL is `https://io.medalsocial.com`.**

It is NOT `https://api.medalsocial.com`. Setting `baseUrl: "https://api.medalsocial.com"` returns DNS or 404 errors. The SDK defaults to the correct value when `baseUrl` is omitted — only set it explicitly when targeting a non-prod environment.

## Instantiation — token is positional

The token is the **first positional argument**, not a key on an options object:

```ts
import { Medal } from "@medalsocial/sdk";

// API key (recommended for server-side; scoped to one workspace)
const medal = new Medal("medal_xxx");

// OAuth access token (requires workspaceId — OAuth tokens span workspaces)
const medal = new Medal("oauth_access_token", {
  workspaceId: "workspace_id_here",
});
```

`new Medal({ apiKey: ... })` is wrong — there is no `apiKey` option. The constructor throws if the token is empty.

## Options

```ts
interface MedalOptions {
  baseUrl?: string;       // defaults to https://io.medalsocial.com
  timeout?: number;       // ms; default 30000
  workspaceId?: string;   // required for OAuth tokens, ignored for API keys
}
```

API keys start with `medal_` and are scoped to a single workspace — the SDK reads the workspace from the key. OAuth tokens are workspace-agnostic, so you must pass `workspaceId`.

## Auth headers

Every request gets:
- `Authorization: Bearer <token>`
- `x-workspace-id: <workspaceId>` (only if `workspaceId` was set on the constructor)
- `User-Agent: medalsocial-sdk/<version>` (best-effort — browsers reject custom User-Agent; the SDK swallows that error silently)

Per-call extras go in `RequestOptions.headers` (accepted by `get`, `post`, `postOnce`, `patch`, `delete` on `BaseClient`). The named options win over a same-named bag entry: `{ headers: { "idempotency-key": "a" }, idempotencyKey: "b" }` sends `b`. The SDK uses this itself for the customer portal's `X-Portal-Session` header — you never set that one by hand; pass the session token to `medal.portal.*` instead.

## Retry behavior

`BaseClient.request` retries on **429 and 5xx** for up to **3 attempts total**:

- If the response has a `retry-after` header (in seconds), the SDK waits that long.
- Otherwise it waits `250 * attempt` ms (so 250, 500 between the first three attempts).
- Other 4xx errors are NOT retried — they throw `MedalApiError` immediately.
- Network errors (fetch throws) are NOT retried — they bubble up.
- The request is aborted via `AbortController` after `timeout` ms. That budget covers the **whole exchange** — headers and body — per attempt. It is fixed wall-clock time: progress on the body does not extend it, so raise `timeout` if you pull responses large enough to take longer than it to arrive. Retry backoff is not charged against it.

The SDK **drains** the response body of any attempt it abandons to a retry, so the connection returns to the pool instead of being held open. The body is streamed to a sink rather than buffered, so a large error page costs no memory. A drain that fails is ignored — the retry proceeds on the status.

## Errors

Non-2xx responses throw `MedalApiError`:

```ts
import { Medal, MedalApiError } from "@medalsocial/sdk";

try {
  await medal.posts.create({ content: "hi", channel_ids: ["ch_1"] });
} catch (err) {
  if (err instanceof MedalApiError) {
    err.status;   // HTTP status code
    err.code;     // API error code (e.g. "INVALID_REQUEST") or "UNKNOWN_ERROR"
    err.message;  // error.message from the API body, or "HTTP <status>: <statusText>"
    err.details;  // optional details from the API body
  }
}
```

The `Medal` instance does **not** expose the underlying `BaseClient` — it's created as a local `const` in the constructor and only passed into the resource classes. There is no public way to read the resolved config from a `Medal` instance. If you need the same config later (for logging, custom requests), store your `MedalOptions` separately when you construct the client.

## OIDC publishing — consumers do not need a token

The package is published with provenance attestation via npm OIDC trusted publishing. Consumers do not need an `NPM_TOKEN` to install. There is no static publish token; releases run from the locked `prod` branch only via GitHub Actions.

## Runtimes

The SDK uses standard Web Fetch + `AbortController` and has no Node-only APIs, so it runs in Deno, Bun, Cloudflare Workers, and modern browsers.

**Browser usage caveat:** the Medal API does not currently support CORS for arbitrary origins — calls from browser code typically need a server-side proxy that holds the API key. Don't embed a `medal_*` key in client-side JavaScript regardless; it grants full workspace access.

**Node:** `package.json` enforces `engines.node >=24`. Older Node is blocked at install time. If you need Node 18–22 support, relax `engines` in your fork and verify against the SDK's test suite first.

**Cloudflare Workers / edge:** works out of the box; the `User-Agent` set is silently rejected (workers also disallow it) and the SDK swallows the error.
