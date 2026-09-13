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
  autoConfirmCapabilities?: { previewSummary: (ctx) => string }; // OFF by default — see the resources skill
}
```

API keys start with `medal_` and are scoped to a single workspace — the SDK reads the workspace from the key. OAuth tokens are workspace-agnostic, so you must pass `workspaceId`.

## Auth headers

Every request gets:
- `Authorization: Bearer <token>`
- `x-workspace-id: <workspaceId>` (only if `workspaceId` was set on the constructor)
- `User-Agent: medalsocial-sdk/<version>` (best-effort — browsers reject custom User-Agent; the SDK swallows that error silently)

Per-call extras go in `RequestOptions.headers` (accepted by `get`, `post`, `postOnce`, `put`, `patch`, `delete` on `BaseClient`). The named options win over a same-named bag entry: `{ headers: { "idempotency-key": "a" }, idempotencyKey: "b" }` sends `b`. The SDK uses this itself for the customer portal's `X-Portal-Session` header — you never set that one by hand; pass the session token to `medal.portal.*` instead. Bag keys are lower-cased before the protected names (`content-type`, the named options) are applied, so capitalisation cannot smuggle a duplicate past them. `retry: false` sends a request exactly once (no 429/5xx retry) on every verb (`post`, `put`, `patch`, `delete`) — used by `portal.login.verify`, `portal.logout` and `portal.deleteMe`, where the first attempt may have consumed the code or revoked the session and a retry would misreport success as failure, and by `portal.updateMe`, where a `marketing_consent` change records a consent event a retry would repeat.

## Retry behavior

`BaseClient.request` retries on **429 and 5xx** for up to **3 attempts total**:

- If the response has a `retry-after` header, the SDK waits that long. **Both wire
  forms are parsed** — delay-seconds and HTTP-date — and a date already in the
  past clamps to zero rather than going negative.
- Otherwise it waits an exponential backoff spread ±25%: ~250 ms, then ~500 ms.
  The jitter is deliberate — without it every client knocked back by one 503
  returns in lock-step and hits the recovering server as a single wave.
  `backoffDelayMs(attempt, random?)` and `parseRetryAfterMs(value, now?)` are
  exported so both rules can be asserted rather than assumed.
- Other 4xx errors are NOT retried — they throw `MedalApiError` immediately.
- A **network** failure (fetch throws a `TypeError`: DNS, TLS, reset, offline) is
  retried only when repeating the request cannot duplicate anything — a `GET`, or
  a write that carries an `Idempotency-Key`. An unkeyed `POST` is sent exactly
  once and throws `MedalNetworkError`.
- The request is aborted via `AbortController` after `timeout` ms. That budget covers the **whole exchange** — headers and body — per attempt. It is fixed wall-clock time: progress on the body does not extend it, so raise `timeout` if you pull responses large enough to take longer than it to arrive. Retry backoff is not charged against it. A timeout throws `MedalTimeoutError`.
- `RequestOptions.signal` merges YOUR cancellation into the same controller, and
  it also wakes a retry out of its backoff. Aborting rejects with your own abort
  reason, never with `MedalTimeoutError` — cancelling is not a Medal failure.

The SDK **drains** the response body of any attempt it abandons to a retry, so the connection returns to the pool instead of being held open. The body is streamed to a sink rather than buffered, so a large error page costs no memory. A drain that fails is ignored — the retry proceeds on the status.

## Errors

Three classes, one base. `MedalError` is the base of all of them, so a single
clause covers every failure the SDK raises:

| Class | `code` | When |
|-------|--------|------|
| `MedalApiError` | the API's `error.code` | A 4xx/5xx response |
| `MedalTimeoutError` | `TIMEOUT` | The per-attempt deadline elapsed |
| `MedalNetworkError` | `NETWORK` | No response was produced at all |

```ts
import { Medal, MedalApiError, MedalError, MedalTimeoutError } from "@medalsocial/sdk";

try {
  await medal.posts.create({ content: "hi", channel_ids: ["ch_1"] });
} catch (err) {
  if (err instanceof MedalApiError) {
    err.status;       // HTTP status code
    err.code;         // API error code — a MedalErrorCode, e.g. "VALIDATION_ERROR"
    err.message;      // error.message from the API body, or "HTTP <status>: <statusText>"
    err.details;      // optional details from the API body
    err.requestId;    // X-Request-ID of the failing response — quote it to support
    err.retryAfterMs; // parsed Retry-After, or null
  } else if (err instanceof MedalError) {
    err.code;         // "TIMEOUT" | "NETWORK"
  }
}
```

Branch on `code`, never on `message`. `MedalErrorCode` is a union of the codes
the API throws today widened with `string`, so a code Medal adds later still
type-checks — handle an unknown one as a generic failure of its HTTP status.

The `Medal` instance does **not** expose the underlying `BaseClient` — it's created as a local `const` in the constructor and only passed into the resource classes. There is no public way to read the resolved config from a `Medal` instance. If you need the same config later (for logging, custom requests), store your `MedalOptions` separately when you construct the client.

## OIDC publishing — consumers do not need a token

The package is published with provenance attestation via npm OIDC trusted publishing. Consumers do not need an `NPM_TOKEN` to install. There is no static publish token; releases run from the locked `prod` branch only via GitHub Actions.

## Runtimes

The SDK uses standard Web Fetch + `AbortController` and has no Node-only APIs, so it runs in Deno, Bun, Cloudflare Workers, and modern browsers.

**Browser usage caveat:** the `/api/v1` routes answer `Access-Control-Allow-Origin: *`, so a browser *can* call them — which is exactly why you must not: the only credential the SDK sends is the API key, and a `medal_*` key in client-side JavaScript grants full workspace access to anyone who reads the bundle. Keep the key on a server (a thin proxy or your own backend) and call the SDK from there. The one browser-shaped surface is the customer portal, and even there the site's *server* holds the key and the session cookie.

**Node:** `package.json` declares `engines.node >=22`; CI runs the unit suite on 22 and 24. The client uses only `fetch`, `AbortController`, `WritableStream` and Web Crypto (`crypto.subtle`, `crypto.randomUUID`) — nothing newer than Node 20 — but Node 20 reached end-of-life in April 2026 and the SDK's toolchain (pnpm 11 and the release tooling) needs 22.13+, so 22 is the floor that is certified. Both active LTS lines (22 and 24) install cleanly.

**Cloudflare Workers / edge:** works out of the box; the `User-Agent` set is silently rejected (workers also disallow it) and the SDK swallows the error.
