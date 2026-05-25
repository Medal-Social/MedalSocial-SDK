---
name: client
description: Use when instantiating the `Medal` class from `@medalsocial/sdk`, configuring auth or the base URL, choosing between API key and OAuth tokens, debugging an HTTP response, or reasoning about retry behavior. Load before writing any code that calls into the SDK at the client level.
---

# Medal Social SDK — Client

## When to load this skill

- Instantiating `new Medal(...)`.
- Choosing between an API key and an OAuth access token.
- Configuring `baseUrl`, `timeout`, or `workspaceId`.
- Debugging a 4xx / 5xx response.
- Reasoning about whether a failed request will be retried.

## Base URL — common pitfall

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

## Auth

The SDK sets `Authorization: Bearer <token>` on every request. If `workspaceId` is set, it also sends `x-workspace-id: <workspaceId>`. It also sets a `User-Agent` (best-effort — browsers reject custom User-Agent and the SDK swallows that error silently).

## Retry behavior

`BaseClient.request` retries on **429 and 5xx** for up to **3 attempts total**:

- If the response has a `retry-after` header (in seconds), the SDK waits that long.
- Otherwise it waits `250 * attempt` ms (so 250, 500 between the first three attempts).
- Other 4xx errors are NOT retried — they throw immediately.
- Network errors (fetch throws) are NOT retried — they bubble up.
- The request is aborted via `AbortController` after `timeout` ms.

The SDK does **not** drain the response body between retries — if you observe a connection leak in long-running processes, that's worth investigating.

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

## OIDC publishing — consumers do not need a token

The package is published with provenance attestation via npm OIDC trusted publishing. Consumers do not need an `NPM_TOKEN` to install. There is no static publish token; releases run from the locked `prod` branch only via GitHub Actions.

## Runtimes

The SDK uses standard Web Fetch + `AbortController`. Works in Node.js (≥18), Deno, Bun, Cloudflare Workers, and modern browsers. No Node-only APIs.
