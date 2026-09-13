# @medalsocial/sdk

## 1.11.0

### Minor Changes

- [#148](https://github.com/Medal-Social/MedalSocial-SDK/pull/148) [`efd89a2`](https://github.com/Medal-Social/MedalSocial-SDK/commit/efd89a2ddb2174d0dd98796a5aef107e50a3696a) Thanks [@adaadev](https://github.com/adaadev)! - Correct the status enums the API never accepted, type deal dates as the Unix milliseconds the API returns, add the three missing webhook events, expose every list filter the API accepts, close the remaining string-typed enums, support Node 22+, and derive the version metadata from `package.json`.
  
  **Corrections — the previous values could never succeed against the API (a `400 VALIDATION_ERROR` in every case), so these are fixes rather than breaks, even where TypeScript now rejects code that used to compile:**
  
  - `DealStatus` is `draft | negotiating | offer_sent | signed | completed | declined`. Six of the eight values the SDK, the OpenAPI document and the basic example advertised (`open`, `won`, `lost`, `proposal_sent`, `on_hold`, `churned`) were refused by `deals.update`, and `deals.list({ status: 'won' })` silently returned an empty page.
  - `ContactStatus` is `lead | subscriber | customer | churned`. `prospect` and `archived` were refused by create, update, import and the list filter; `subscriber` could not be typed at all. The Pilot `createContact` tool schema moves to the same set.
  - `PortalLoginStartInput.locale` is `PortalLocale` (`no | en`). The README and JSDoc told integrators to send `nb`, which the API refuses.
  - `Deal.start_date` / `Deal.end_date` are `number | null` — Unix milliseconds — which is what the wire has always carried. They are still *sent* as ISO 8601 / `YYYY-MM-DD` strings on create and update.
  - `CreateWebhookInput.event_types` / `UpdateWebhookInput.event_types` are `SubscribableWebhookEventType[]` and the `channels` filters are `HelpdeskChannel[]`; the API rejects any other string, so a typo is now a compile error instead of a runtime `400`.
  
  **Additive:**
  
  - `WebhookEvent` gains `MessageDeletedEvent` (`helpdesk.message_deleted`), `ConversationContactLinkedEvent` and `ConversationContactUnlinkedEvent` — the three server events the union was missing — plus `WebhookEventType` (`WebhookEvent['type']`) and `SubscribableWebhookEventType` for exhaustiveness checks. `WebhookConversationSnapshot` carries the `contactLinkSource`, `contactLinkedAt`, `chatType` and `chatTitle` fields the server includes, and its `status` (like the top-level `channel` and the message snapshot's `deliveryStatus`) is now the closed union the REST types already use. `ConversationStatusChangedEvent.data` types the optional `reason: "message_reopened"` the server sets when a customer message reopens a thread.
  - `ConversationMessage.externally_deleted_at` (`number | null`): the Unix-ms timestamp of an upstream deletion — the message is kept as a tombstone with an empty `body` — which the API has been returning alongside the `helpdesk.message_deleted` event.
  - List filters the API already accepted: `deals.list` takes `close_date_from` / `close_date_to` / `min_value` / `company_name` / `contact_id` / `stage`; `contacts.list` takes `email` (exact match); `posts.list` takes `scheduled_from` / `scheduled_to` / `published_from` / `published_to` / `platforms` / `query`; `bookings.list` takes `created_via`; `helpdesk.conversations.list` takes `chat_type` and `assigned` (including `assigned: false`, the triage question `assignee_user_id` cannot ask). `TimestampInput` (`number | string`) is the shared type for the date filters.
  - Closed unions where the API has closed enums: `PostStatus`, `PostVariantStatus`, `EmailSendStatus`, `HelpdeskChannel`, `HelpdeskChatType`, `ContactLinkSource`; `ContactAddress` replaces `Record<string, string>` (the keys are camelCase, `postalCode` included, and the API rejects any other key); `ImportContactInput.status` is `ContactStatus`. `Conversation` carries the `contact_link_source`, `contact_linked_at`, `chat_type` and `chat_title` fields the API returns.
  - `engines.node` is `>=22` (was `>=24`, which refused Node 22 LTS — active until October 2027 — at install time under `engine-strict`). Nothing in the client needs a runtime newer than Node 20 (only `fetch`, `AbortController`, `WritableStream` and Web Crypto), but Node 20 reached end-of-life on 2026-04-30 and the SDK's own toolchain (pnpm 11, `changesets`, `secretlint`, `lint-staged`) needs 22.13+, so 22 is the floor the SDK certifies; CI now runs the unit suite on Node 22 and 24.
  - The `User-Agent` header reports the real package version (it was pinned to `1.0.0` since 1.0.0) and links to this repository; `src/version.ts`, `jsr.json` and the OpenAPI document's `info.version` (stuck at `1.1.7`) are now written from `package.json` by `scripts/sync-version.mjs` during `pnpm run version`, and a test fails on drift.

- [#148](https://github.com/Medal-Social/MedalSocial-SDK/pull/148) [`efd89a2`](https://github.com/Medal-Social/MedalSocial-SDK/commit/efd89a2ddb2174d0dd98796a5aef107e50a3696a) Thanks [@adaadev](https://github.com/adaadev)! - Cover the confirmable write registry, add the missing bookings/portal routes, and make the OpenAPI gate able to see drift (audit SDK-B)
  
  **Action required if you import `@medalsocial/sdk/pilot`:** `zod` moved from a
  runtime dependency to an **optional peer** dependency, so it is no longer
  installed for you. Add it to your own dependencies (`pnpm add zod`). Nothing else
  in the package touches zod, so every other consumer now installs one fewer
  package.
  
  New:
  
  - `bookings.today()` and `bookings.attention()` — the salon's operating summary
    for one local date, and the open items that need a human.
  - `bookings.events.hosts.{list,create,update}` and
    `bookings.events.remove(id)` / `.delete(id)` (OAuth callers need the workspace
    `admin` role).
  - `portal.login.vipps.{start,exchange}` — "Log in with Vipps".
  - `helpdesk.conversations.{linkContact,unlinkContact}` — bind a thread's sender
    to a CRM contact, or reverse it.
  - `iter()` on `contacts`, `deals`, `posts`, `helpdesk.conversations`,
    `channels.connectLinks` and `channels.connections`, plus the exported
    `paginate(fetchPage)` — auto-paging driven off `has_more`, so a short filtered
    page no longer ends the walk early.
  - `bookings.payment.waitForSettlement(id)` and its manage-token twin — the
    return-page poll, with the settled states and the ten-minute payment lifetime
    already known.
  - `portal.session(token)` — a bound scope (`profile()`, `update()`, `bookings()`,
    `export()`, `delete()`, `logout()`) so the token is supplied once instead of
    positionally on six methods.
  - `MedalTimeoutError` (code `TIMEOUT`) and `MedalNetworkError` (code `NETWORK`),
    both extending a new `MedalError` base, so one `catch` clause covers every
    failure the SDK raises. `MedalApiError` now carries `requestId` (from
    `X-Request-ID`) and `retryAfterMs`. `MedalErrorCode` is exported.
  - `RequestOptions.signal` — your own cancellation, merged with the client's
    timeout; it also wakes a retry out of its backoff.
  - `bookings.services.list()` / `bookings.resources.list()` namespaces, and
    `remove`/`delete` aliases across contacts, deals, posts, webhooks,
    bookings.events, connect links and connections. Every write now takes an
    optional trailing `RequestOptions`.
  
  Fixed:
  
  - `autoConfirmCapabilities` silently did nothing outside channels, helpdesk and
    webhooks. `CAPABILITY_IDS` / `CAPABILITY_ROUTES` now mirror all 27 confirmable
    API capabilities, the confirmer is wired into `contacts`, `deals`, `emails`,
    `gdpr` and `posts`, and the two ids with several routes send the explicit
    `api_path` the mint requires.
  - `posts.publish` and `posts.schedule` go out with an `Idempotency-Key`. Without
    one, the retry of a publish that had already committed met the status guard and
    answered `400` — a success reported as a failure.
  - Retries: exponential backoff spread ±25% (a fleet knocked back by one 503 no
    longer returns in lock-step), `Retry-After` parsed in both wire forms
    (delay-seconds **and** HTTP-date), and a network failure retried on requests
    that are safe to repeat (a `GET`, or a write carrying an idempotency key).
  - Portal bookings now carry the fields the endpoint really answers:
    `start_ts_iso`, `end_ts_iso`, `payment_mode`, `payment_status`, and the ISO
    twins on exported consents.
  
  Type corrections — these reject values the API already refused with a `400`, so
  they are corrections rather than breaks, but they can fail a build that was
  sending the refused value:
  
  - `CreateDealInput.currency` / `UpdateDealInput.currency` / `Deal.currency` are
    now `DealCurrency` (`USD` | `EUR` | `GBP` | `NOK`), the list the API validates
    against. The pilot tool schema is narrowed to match.
  - `channel_type` on connect links and connections is now `ChannelType`
    (`telegram_inbox` | `linkedin`) — the server resolves it through its connect
    adapter registry and refuses anything else.
  - `Deal.value` is documented as MAJOR currency units (50000 is fifty thousand
    kroner), the opposite convention from bookings' integer øre.
  
  Internal:
  
  - `scripts/assert-openapi-sdk-coverage.mjs` no longer compares the SDK to a
    hand-written table of itself — the reason six bookings routes, two portal
    routes and several wrong enums shipped green. It derives the operation list
    from the document and diffs it against a committed snapshot of the Medal API's
    published surface; 11 tests drive its failure paths.
  - `src/devices/**` is gone. It was never exported from any entry point, so no
    consumer could reach it, and it shipped to JSR with neither tests nor coverage.

- [#148](https://github.com/Medal-Social/MedalSocial-SDK/pull/148) [`efd89a2`](https://github.com/Medal-Social/MedalSocial-SDK/commit/efd89a2ddb2174d0dd98796a5aef107e50a3696a) Thanks [@adaadev](https://github.com/adaadev)! - Add `medal.bookings.events.register(id, input)`: a guardian registering a child for an arrangement. It lands as a `Booking` with `event_id`/`event_order` set, and starts a Vipps payment when the arrangement's service requires one — `payment` carries the same show-once redirect `bookings.payment.start` does, and is `null` when nothing is owed. A payment failure does not undo the registration: the booking is still created and `payment_error` says what to retry, so poll or retry the payment on the returned booking rather than registering again. `consent_accepted: true` is required, mirroring `StartBookingPaymentInput.terms_accepted`; `consent_version`/`consent_text` carry your own copy of the wording. The result also carries `contact_id`/`person_id` — the guardian's contact and the child's `ContactPerson`, created or reused.
  
  Add `medal.bookings.events.registrations(id)`: an arrangement's roster, ordered by `event_order`. Cancelled registrations are returned, not filtered — the event's `registered_count` answers the capacity question separately. Capped at 300 rows; `truncated: true` means the ordering can no longer be trusted.
  
  Also adds an optional `host_id` filter to `medal.bookings.events.list(...)`.
  
  Requires a Medal Social API deployment that supports arrangement registrations; older API deployments 404 on the new endpoints.

### Patch Changes

- [#152](https://github.com/Medal-Social/MedalSocial-SDK/pull/152) [`5064db0`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5064db0f498155508db66f35f7a7bbf2c5f1acb0) Thanks [@adaadev](https://github.com/adaadev)! - Cancel the capability-confirmation mint when the caller aborts.
  
  An auto-confirmed write makes two requests: it mints the `X-Capability-Confirmation` token, then sends the write. The caller's `signal` reached only the write, so aborting while the mint was in flight left the call pending until the mint answered or hit the client `timeout`. The signal now cancels the mint too, and the call rejects at once with the caller's abort reason.
  
  `medal.capabilityConfirmations.create()` accepts `{ signal }` as an optional second argument for the explicit flow. Only the signal is accepted: the write's `idempotencyKey`, `capabilityConfirmation` and headers describe the write, not the mint.

- [#148](https://github.com/Medal-Social/MedalSocial-SDK/pull/148) [`efd89a2`](https://github.com/Medal-Social/MedalSocial-SDK/commit/efd89a2ddb2174d0dd98796a5aef107e50a3696a) Thanks [@adaadev](https://github.com/adaadev)! - Close the last advisory and take the safe dev-tooling upgrades.
  
  `js-yaml` reaches the tree only through `@commitlint/cli` and
  `openapi-typescript`, so it moves by override to 4.3.2 (GHSA-2883-xcg3-v3hh).
  Nine devDependencies take their current minor/patch. No runtime dependency
  changes.

- [#148](https://github.com/Medal-Social/MedalSocial-SDK/pull/148) [`efd89a2`](https://github.com/Medal-Social/MedalSocial-SDK/commit/efd89a2ddb2174d0dd98796a5aef107e50a3696a) Thanks [@adaadev](https://github.com/adaadev)! - Fix the Pilot plugin manifest's API host, correct the documented Node version,
  and stop publishing the whole repository to JSR.
  
  - `plugin.toml` granted network access to `api.medalsocial.com`, but the client
    calls `https://io.medalsocial.com` — so a Pilot plugin loading this manifest
    had permission for a host the SDK never contacts, and none for the host it
    does. Its `version` was also frozen at `1.0.0`.
  - The README's Runtime Support section advertised Node.js 18+ while
    `engines.node` is `>=24`.
  - `jsr.json` declared no `publish` scope, so `jsr publish` shipped 108 files —
    including all eight CI workflows, `.changeset/`, `CLAUDE.md`, the lockfile,
    the test suite and `.vscode`. Now 50.

- [#148](https://github.com/Medal-Social/MedalSocial-SDK/pull/148) [`efd89a2`](https://github.com/Medal-Social/MedalSocial-SDK/commit/efd89a2ddb2174d0dd98796a5aef107e50a3696a) Thanks [@adaadev](https://github.com/adaadev)! - Fix `gdpr.cookieConsent()` sending a body the API rejects.
  
  Through 1.10.0 the method was typed with a `consentStatus` / `consentTimestamp` / `cookiePreferences` body. `POST /api/cookie-consent` has never accepted that shape — called exactly as typed, it answered `400 Invalid event`. The unit test only asserted that `domain` survived serialisation, a field both shapes share, so the drift never showed.
  
  `CookieConsentInput` is now the endpoint's real contract: `event` (`preferences_saved` | `preferences_revoked` | `banner_displayed` | `preferences_expired`), `consentId`, `domain`, a flat `categories` object of booleans (`essential`, `analytics`, `marketing`, `functional`), plus optional `visitorId`, `ipAddress`, `userAgent`, `consentText`, `policyVersion` and a numeric `timestamp`. The return type is the new `CookieConsentResult`. `CookieConsentEvent`, `CookieConsentCategories` and `CookieConsentResult` are exported; `CookieCategoryConsent` is kept but deprecated — it only ever described the shape that did not work.
  
  Also fixed: `MedalApiError` now carries the message from routes that answer `{ success: false, error: "why" }` rather than the `/api/v1/` `{ error: { code, message } }` envelope. Those previously surfaced as `HTTP 403: Error`, so a caller could not tell an unowned domain from a bad key.
  
  The Pilot `recordCookieConsent` tool schema and the README example move to the same shape, and a new test compares the serialised request against a fixture replayed through the endpoint's own validator, so the two cannot drift apart again silently.
  
  Typed as a patch because the old shape could not succeed against the API; any call written to it was already failing.

- [#152](https://github.com/Medal-Social/MedalSocial-SDK/pull/152) [`5064db0`](https://github.com/Medal-Social/MedalSocial-SDK/commit/5064db0f498155508db66f35f7a7bbf2c5f1acb0) Thanks [@adaadev](https://github.com/adaadev)! - Keep the Pilot plugin manifest's version in step with the package.
  
  [#142](https://github.com/Medal-Social/MedalSocial-SDK/issues/142) corrected `plugin.toml`'s `version`, frozen at `1.0.0` until then, by editing it by hand, so the very next release left it behind again: the 1.11.0 version bump moved `package.json`, `jsr.json`, `src/version.ts` and the OpenAPI document, but not the manifest. `scripts/sync-version.mjs` now writes the `[plugin]` table's `version` as well, and `pnpm run version:check` fails when it drifts.

## 1.10.0

### Minor Changes

- [#135](https://github.com/Medal-Social/MedalSocial-SDK/pull/135) [`a7c7e2b`](https://github.com/Medal-Social/MedalSocial-SDK/commit/a7c7e2b3900174f87a876884c62892aecf93ee31) Thanks [@alioftech](https://github.com/alioftech)! - Add `medal.bookings.payment.{start,get}` and `medal.bookings.manage.payment.{start,get}`: Vipps payments on a booking, as the business or on the customer's behalf. `start` reserves the booking's amount and returns a one-time wallet redirect URL — hand it to the Vipps Widget SDK unchanged, and learn the outcome from `get` or the booking's `payment_status`, never from the browser's return redirect. `terms_accepted: true` is required: the customer must actively accept your terms before a payment is initiated. `get` returns the newest attempt only and throws a 404 `MedalApiError` when the booking has no payment yet.
  
  Also adds `payment_mode` to `Booking` and `ManageSummary` (`"none" | "reserve" | "prepay"`, frozen when the booking was made) and `payment` to `BookingService` (the per-service requirement; `null` means "follow the workspace rule"). Requires a Medal Social API deployment that supports booking payments; older API deployments omit these fields.

## 1.9.0

### Minor Changes

- [#132](https://github.com/Medal-Social/MedalSocial-SDK/pull/132) [`e195985`](https://github.com/Medal-Social/MedalSocial-SDK/commit/e19598510110d31d70d9c3c84ec03befb6c7cfd4) Thanks [@alioftech](https://github.com/alioftech)! - bookings: `persons`, `relations` and `events` resources; `booked_for_person_id` on booking items and rows.
  
  portal: `persons` and `labels` on the profile.

## 1.8.0

### Minor Changes

- [#127](https://github.com/Medal-Social/MedalSocial-SDK/pull/127) [`1224467`](https://github.com/Medal-Social/MedalSocial-SDK/commit/12244678b9e07b688f7fdc9f40f18519bcb083c9) Thanks [@alioftech](https://github.com/alioftech)! - Add `medal.portal.*` for customer-portal sessions: e-mail code login (`login.start`/`login.verify`), `me`/`updateMe`, `myBookings`, `exportMyData`, `deleteMe`, `logout`. Session-bound calls send the `X-Portal-Session` header; `RequestOptions.headers` is now supported on every verb.

### Patch Changes

- [#130](https://github.com/Medal-Social/MedalSocial-SDK/pull/130) [`f7aad5b`](https://github.com/Medal-Social/MedalSocial-SDK/commit/f7aad5b5315a35b99ebef2b88ffafca8c3dd4ef2) Thanks [@alioftech](https://github.com/alioftech)! - `retry: false` is now honoured by `patch` and `delete` as well as `post` (it was silently ignored on those verbs), and `medal.portal.updateMe` is sent exactly once because a `marketing_consent` change records a consent event that a retry would repeat.

## 1.7.0

### Minor Changes

- [#119](https://github.com/Medal-Social/MedalSocial-SDK/pull/119) [`c4dbbb6`](https://github.com/Medal-Social/MedalSocial-SDK/commit/c4dbbb6a30c54eb84e0649ead303a6d69aef0118) Thanks [@alioftech](https://github.com/alioftech)! - Add the bookings resource: the bookable catalogue (`medal.bookings.listServices` / `listResources`), free slots (`availability`), and the bookings themselves (`list` / `create` / `get` / `update` / `cancel` / `reschedule` / `markNoShow`). `medal.bookings.manage.*` covers the customer-facing manage-token routes, where the workspace's cancel and reschedule windows are enforced and a cancellation is attributed to the customer rather than to staff. Money is integer øre; `bookings.list` reports `pagination.truncated` when the read window was clipped.
  
  Every booking write is idempotent by default. The client retries 429/5xx automatically, so each booking `POST` now carries a generated `Idempotency-Key` — a retry after a gateway failure replays the original result instead of booking the slot a second time. Callers can still pass `options.idempotencyKey` to extend the guarantee across their own retries. This is exposed as a new `BaseClient.postOnce` method for resources that need the same protection.

- [#119](https://github.com/Medal-Social/MedalSocial-SDK/pull/119) [`c4dbbb6`](https://github.com/Medal-Social/MedalSocial-SDK/commit/c4dbbb6a30c54eb84e0649ead303a6d69aef0118) Thanks [@alioftech](https://github.com/alioftech)! - Add `medal.bookings.schedule(...)`: the dates a service can be booked on, with each date's opening window and the last start the service could occupy. It is the half `availability` cannot answer — availability returns free slots and nothing else, so a closed day, an evening past closing and a fully booked day all come back as the same empty array. A date absent from `schedule` is closed; on a listed date, compare `last_start_ts` against the clock to tell "too late today" from "full".
  
  Also adds `created_via` to `CreateBookingInput` (`"web" | "api"`, default `api`): a workspace's own website should send `web` so its bookings can be told apart from integrations. Staff-only provenances (`dashboard`, `walk_in`) are rejected by the API with 400. Requires a server that understands the field; older servers ignore it.

- [#119](https://github.com/Medal-Social/MedalSocial-SDK/pull/119) [`c4dbbb6`](https://github.com/Medal-Social/MedalSocial-SDK/commit/c4dbbb6a30c54eb84e0649ead303a6d69aef0118) Thanks [@alioftech](https://github.com/alioftech)! - Guarantee an `Idempotency-Key` on every non-idempotent write, not just bookings.
  
  `BaseClient.request` retries 429 and 5xx three times. A POST whose transaction
  committed on the server before the gateway failed was therefore submitted
  again — and an unkeyed write does not merely miss deduplication, it skips the
  server's idempotency machinery entirely and runs the handler a second time.
  Twelve write methods went out unkeyed and now mint a key once per logical call,
  outside the retry loop, so every attempt carries the same value:
  
  - `posts.create`
  - `contacts.create`, `contacts.addNote`, `contacts.import`
  - `emails.send`, `emails.batch`
  - `deals.create`
  - `scan.create`
  - `helpdesk.replies.create`
  - `webhooks.create`
  - `channels.connectLinks.create`
  - `gdpr.requestExport`
  
  A caller-supplied `idempotencyKey` still always wins, and a capability
  confirmation keeps the key it was minted with — the confirmation is bound to
  that key, so it is reused rather than replaced.
  
  Methods that previously took no per-request options now accept an optional
  `RequestOptions` argument (`posts.create`, `contacts.create`,
  `contacts.addNote`, `contacts.import`, `emails.send`, `emails.batch`,
  `deals.create`, `scan.create`, `gdpr.requestExport`). This is additive — every
  existing call compiles unchanged.
  
  Left deliberately unkeyed, each for a stated reason on the method:
  `posts.schedule`, `posts.publish`, `gdpr.recordConsent`, `gdpr.cookieConsent`,
  `webhooks.test`, and `capabilityConfirmations.create`.

### Patch Changes

- [#119](https://github.com/Medal-Social/MedalSocial-SDK/pull/119) [`c4dbbb6`](https://github.com/Medal-Social/MedalSocial-SDK/commit/c4dbbb6a30c54eb84e0649ead303a6d69aef0118) Thanks [@alioftech](https://github.com/alioftech)! - Make `timeout` bound the whole response, not just the headers. `fetch` settles as soon as the response headers arrive, and the client cleared its abort timer at that point — so every body read ran with no deadline at all. A server that sent headers and then stalled mid-body hung the SDK indefinitely; `timeout` only ever meant time-to-headers, despite being documented as "Request timeout in ms".
  
  The abort signal is now held until the body is in hand. A stalled response rejects with `AbortError` at the configured timeout, and a stalled error body no longer blocks the automatic 429/5xx retry — it aborts, and the retry proceeds. Retry backoff stays outside the deadline, since that is time the client chooses to wait rather than time it spends waiting on the server.
  
  **Behaviour change:** `timeout` is a fixed wall-clock budget per attempt, and progress on the body does not extend it. A response that takes longer than `timeout` to finish arriving now fails, where before it either hung forever or eventually succeeded. The default of 30s is ample for the JSON these endpoints return, but raise it if you pull pages large enough to take longer than that to transfer.

- [#119](https://github.com/Medal-Social/MedalSocial-SDK/pull/119) [`c4dbbb6`](https://github.com/Medal-Social/MedalSocial-SDK/commit/c4dbbb6a30c54eb84e0649ead303a6d69aef0118) Thanks [@alioftech](https://github.com/alioftech)! - Drain the response body before retrying a 429/5xx. The retry branch abandoned the response without consuming it, and undici keeps a socket out of its connection pool until the body is consumed — so a retry storm opened a fresh connection per attempt, exactly when the server was least able to absorb them. Against a local server returning large 5xx bodies, 24 requests cost 17 TCP connections before this change and 2 after.
  
  The body is piped to a sink rather than cancelled or buffered. `res.body?.cancel()` releases the socket too, but by destroying the connection instead of returning it to the pool — the same churn this fixes. Reading it into a string with `res.text()` would return the socket, but materialises an error page that is then thrown away: draining a 64 MB body that way costs ~235 MB of RSS, against ~1 MB streamed. Responses with no stream to pipe fall back to `text()`.
  
  This affects every resource, since they all share `BaseClient.request`.

## 1.6.0

### Minor Changes

- [#97](https://github.com/Medal-Social/MedalSocial-SDK/pull/97) [`a144eff`](https://github.com/Medal-Social/MedalSocial-SDK/commit/a144eff961d7660b22744586faf0a1c4d4932654) Thanks [@alioftech](https://github.com/alioftech)! - Auto-confirm `previewSummary` callbacks now receive the pending request `body`.

  `AutoConfirmContext` is now a discriminated union on `capabilityId`, so narrowing gives the exact payload type for that route (`undefined` for the `DELETE` routes). Previously the callback saw only the capability, method, path, path params and idempotency key, so two replies or two connect-link creations with different payloads produced indistinguishable context — a client-level `previewSummary` could only emit boilerplate, which undermines the audit value of `user_approved: true`.

  The payload is passed by reference and unmodified. New exported types: `CapabilityWriteBodies` and `CapabilityWriteRequest`.

  `CapabilityConfirmer.prepare` now takes the capability and its body as a single discriminated-union argument (`prepare(request, pathParams, options)`) so the two cannot be decoupled — pairing a capability id with another route's payload is a compile error even when the id's static type is the full `CapabilityId` union.

- [#97](https://github.com/Medal-Social/MedalSocial-SDK/pull/97) [`a144eff`](https://github.com/Medal-Social/MedalSocial-SDK/commit/a144eff961d7660b22744586faf0a1c4d4932654) Thanks [@alioftech](https://github.com/alioftech)! - Cursor pagination on the `medal.channels` listings, closing a gap against the
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

- [#97](https://github.com/Medal-Social/MedalSocial-SDK/pull/97) [`a144eff`](https://github.com/Medal-Social/MedalSocial-SDK/commit/a144eff961d7660b22744586faf0a1c4d4932654) Thanks [@alioftech](https://github.com/alioftech)! - Close remaining gaps between the SDK and the Medal Social public API for partner channel-connect integrations:

  - **Helpdesk message delivery state** — `ConversationMessage` now exposes `delivery_status` (`pending | sent | delivered | failed`, typed as a union) and `delivery_error`, both `null` for inbound messages and internal notes. Documents that a `201` from `helpdesk.replies.create` means _accepted_, not delivered.
  - **Webhook delivery correlation** — `WebhookDelivery` now exposes `resource_id`, `conversation_id`, `message_id`, `connection_ref`, `channel`, and `channel_connection_id`. All are nullable and fail closed to `null` when no canonical event exists (test pings, aged-out events); deliveries never carry payload bodies.
  - **Capability confirmations** — new `medal.capabilityConfirmations.create()` resource for `POST /api/v1/capability-confirmations`, plus the typed `CapabilityId` union / `CAPABILITY_IDS` and `CAPABILITY_ROUTES` exports. An opt-in `autoConfirmCapabilities: { previewSummary }` client option (and per-call `{ autoConfirm }`) mints the `Idempotency-Key` + `X-Capability-Confirmation` pair for confirmable writes. Defaults to OFF.

- [#100](https://github.com/Medal-Social/MedalSocial-SDK/pull/100) [`fc5ae53`](https://github.com/Medal-Social/MedalSocial-SDK/commit/fc5ae5321ac4a3b6d5e0fc6a835adfa3735ab704) Thanks [@alioftech](https://github.com/alioftech)! - Add the scan resource: queue and poll Nettsjekk company/site scans (`medal.scan.create` / `get` / `waitForResult`) and search the Norwegian company registry (`medal.scan.companies`).

## 1.5.0

### Minor Changes

- [#93](https://github.com/Medal-Social/MedalSocial-SDK/pull/93) [`cd82918`](https://github.com/Medal-Social/MedalSocial-SDK/commit/cd82918362ff0b705e7745e8cf33418ee76aa545) Thanks [@alioftech](https://github.com/alioftech)! - Partner channel connect — new `medal.channels` resource plus channel lifecycle
  webhook events, mirroring the REST surface:

  - `channels.connectLinks.create/list/revoke` — mint single-use hosted connect
    links (the one-time `url` is returned exactly once; idempotent replays omit
    it), list them with `channel_type`/`status` filters, and revoke pending
    links.
  - `channels.connections.list/disconnect` — inspect the workspace's channel
    connections (generic `{ id, channel_type, label, state, masked_identity,
last_activity_at, helpdesk_connection_id }` shape) and disconnect an
    account.
  - New typed webhook events `helpdesk.channel_connected` and
    `helpdesk.channel_disconnected` (`ChannelConnectedEvent` /
    `ChannelDisconnectedEvent`, payload `WebhookChannelLifecycleData`) join the
    `WebhookEvent` union returned by `verifyWebhookSignature`.
  - OpenAPI 3.1 contract extended with the five `/api/v1/channels/*` operations.

## 1.4.0

### Minor Changes

- [#89](https://github.com/Medal-Social/MedalSocial-SDK/pull/89) [`2b84b85`](https://github.com/Medal-Social/MedalSocial-SDK/commit/2b84b851b7c5aae2d95017fe760de87e9c248199) Thanks [@adaadev](https://github.com/adaadev)! - Emails API now hands out trackable send ids everywhere:

  - `EmailSendResult.id` is the email send id accepted by `emails.get(id)` (it was
    previously a queue job id the status endpoint rejected), and the result now
    also types `copy_id` and `contact_id`.
  - `BatchSendSummary.results` is new: a per-recipient array (request order) of
    `{ email, id, status, error }`, where `id` is the recipient's send id — batch
    sends are now trackable per recipient via `emails.get(id)`.
  - `SendEmailInput` gains the already-supported `idempotency_key`, `copy_to`,
    and `copy_reply_to` fields.
  - `EmailSendResult.id` is now typed `string | null` to match the wire contract.

- [#89](https://github.com/Medal-Social/MedalSocial-SDK/pull/89) [`2b84b85`](https://github.com/Medal-Social/MedalSocial-SDK/commit/2b84b851b7c5aae2d95017fe760de87e9c248199) Thanks [@adaadev](https://github.com/adaadev)! - Security and toolchain refresh — zero open vulnerability alerts:

  - All five open Dependabot alerts fixed by lifting the supply-chain override
    pins to patched releases: `js-yaml` 4.3.0, `fast-uri` 3.1.4, `linkify-it`
    5.0.2, `brace-expansion` 5.0.9 (plus refreshed `ajv`, `dompurify`,
    `markdown-it`, `minimatch`, `picomatch`, `rollup`, `yaml` pins).
    `pnpm audit` is clean.
  - `zod` upgraded 3 → 4 (the SDK's only runtime dependency). Zod is used
    solely by the `@medalsocial/sdk/pilot` tool schemas; they now use the
    zod-4 idioms (`z.email()`, two-argument `z.record()`). Consumers passing
    those schemas into zod-3-only tooling should upgrade that tooling; modern
    AI SDKs accept zod 4 via Standard Schema.
  - Dev toolchain to latest: TypeScript 6.0, Biome 2 (config migrated), knip 6,
    redocly 2.42, commitlint/changesets/secretlint/lint-staged patch bumps.
    No public API changes from the toolchain.

## 1.3.0

### Minor Changes

- Add helpdesk + webhooks support (helpdesk bridge).

  **`medal.helpdesk.*`** — read and drive helpdesk conversations:

  - `conversations.list({ status, assignee_user_id, requester, query, channels, limit, cursor })` — cursor-paginated list/search (`channels` serialized as CSV)
  - `conversations.get(id)` / `conversations.messages(id, { limit, cursor })`
  - `conversations.update(id, { status, assignee_user_id })` — assign (`null` unassigns), snooze, close
  - `replies.create({ conversation_id, body, message_type, author_name }, { idempotencyKey })` — operator replies and internal notes

  **`medal.webhooks.*`** — manage outbound webhook endpoints:

  - `list()`, `create(input, opts)`, `get(id)`, `update(id, input)`, `delete(id)`, `deliveries(id, { limit })`, `test(id)`
  - `create` returns the signing `secret` exactly once — store it immediately

  **Webhook event verification** — new `verifyWebhookSignature({ payload, timestamp, signature, secret, toleranceMs })` authenticates `X-Medal-Signature` deliveries (HMAC-SHA256 over `"{timestamp}.{payload}"`, constant-time compare via Web Crypto, 5-minute replay tolerance by default) and returns a typed `WebhookEvent` discriminated union (`helpdesk.conversation_created`, `helpdesk.conversation_assigned`, `helpdesk.conversation_status_changed`, `helpdesk.message_received`, `helpdesk.message_sent`, `helpdesk.message_delivery_updated`, `test.ping`). Throws `WebhookVerificationError` with a machine-readable `code` on failure. Works in Node.js 18+, Deno, Bun, Cloudflare Workers, and browsers.

  **Client** — `BaseClient.post/patch` now accept per-request `RequestOptions` with `idempotencyKey`, sent as the `Idempotency-Key` header (required for capability-scoped tokens on helpdesk replies and webhook creation).

## 1.2.1

### Patch Changes

- [#69](https://github.com/Medal-Social/MedalSocial-SDK/pull/69) [`14fbad3`](https://github.com/Medal-Social/MedalSocial-SDK/commit/14fbad32b1702da15d8697a573ac3bc11b83bc42) Thanks [@alioftech](https://github.com/alioftech)! - Ship TanStack Intent agent skills (`skills/client`, `skills/resources`) with the package. Consumers running `npx @tanstack/intent install` now get versioned usage guidance for the `Medal` class, base URL, auth, retry behavior, and all six resources written into their agent config.

## 1.2.0

### Minor Changes

- [#63](https://github.com/Medal-Social/MedalSocial-SDK/pull/63) [`737c0f6`](https://github.com/Medal-Social/MedalSocial-SDK/commit/737c0f601fdbb96065e4c048810c8d09e9e609fa) Thanks [@alioftech](https://github.com/alioftech)! - Ship a validated OpenAPI 3.1 contract for the public SDK surface, generated TypeScript contract types, package exports for YAML/JSON contract artifacts, and CI drift checks between the SDK resources and OpenAPI operations.

## 1.1.7

### Patch Changes

- [#55](https://github.com/Medal-Social/MedalSocial-SDK/pull/55) [`0dbccbd`](https://github.com/Medal-Social/MedalSocial-SDK/commit/0dbccbd485d15c7132d6ac50882502449ebda963) Thanks [@alioftech](https://github.com/alioftech)! - chore(deps): security batch — clear 17 Dependabot alerts (8 high, 9 medium) via pnpm.overrides. Bumps fast-uri, glob, minimatch, picomatch, rollup, ajv, brace-expansion, js-yaml, markdown-it, mdast-util-to-hast, vite (5.x and 6.x), yaml.

## 1.1.6

### Patch Changes

- [#51](https://github.com/Medal-Social/MedalSocial-SDK/pull/51) [`94e45a8`](https://github.com/Medal-Social/MedalSocial-SDK/commit/94e45a805aa5c3af289400514367a828e7dba05f) Thanks [@alioftech](https://github.com/alioftech)! - Lock SDK at 100% test coverage. The vitest config now enforces 100% lines/branches/functions/statements thresholds against `src/**` (with type-only files in `src/types/**` and `src/devices/**` excluded since they emit no runtime). Added a focused test for the `createMedalClient` factory covering the default path, option forwarding (baseUrl + workspaceId header), and the empty-token guard. No public API changes.

## 1.1.5

### Patch Changes

- [#47](https://github.com/Medal-Social/MedalSocial-SDK/pull/47) [`8a40869`](https://github.com/Medal-Social/MedalSocial-SDK/commit/8a408697b9fb3c69e0c05d4465e369d2bcc45d12) Thanks [@alioftech](https://github.com/alioftech)! - fix: point package.json `main` / `module` / `types` / `exports` at the actual build output paths

  `tsup src/index.ts pilot/index.ts` mirrors the input directory structure under `dist/`, so the bundles ship at `dist/src/index.{js,mjs,d.ts}` and `dist/pilot/index.{js,mjs,d.ts}`. The package.json was pointing the root entry at `dist/index.{js,mjs,d.ts}` which never existed. TypeScript could often resolve via legacy fallbacks, but bundlers that follow the `exports` map strictly (Turbopack, esbuild via `@opennextjs/cloudflare`, etc.) failed to find the module — the named imports got tree-shaken to `void 0` in deployed Cloudflare Workers, surfacing as `TypeError: (void 0) is not a constructor` at runtime.

  This is the minimal-diff fix: just update the paths to point at where the files actually land. A future change could flatten the build to `dist/index.*` for cleaner public paths, but that requires a tsup config change.

  Also adds a `verify:paths` script (`scripts/verify-package-paths.mjs`) wired into `prepublishOnly`, `release`, and the CI build job. It walks every entry point declared in `package.json` (`main`, `module`, `types`, `exports`, `bin`) and fails with a clear error if any path doesn't resolve to an existing file. This prevents the same class of bug — package.json paths drifting from build output — from ever shipping again.

## 1.1.4

### Patch Changes

- [#38](https://github.com/Medal-Social/MedalSocial-SDK/pull/38) [`ac3f415`](https://github.com/Medal-Social/MedalSocial-SDK/commit/ac3f4159bad0b9809356f1f9eb7b3cfba3850ed3) Thanks [@alioftech](https://github.com/alioftech)! - Add JSDoc documentation to all exported symbols for JSR 100% score. This includes:
  - `@module` JSDoc to `src/index.ts` entrypoint
  - JSDoc for every exported type, interface, and class across all type and resource files
  - JSDoc for `MedalOptions`, `createMedalClient`, `ClientConfig`, and all `BaseClient` public methods
  - Added `description` field to `jsr.json`
  - Added `.github/workflows/jsr-publish.yml` for JSR provenance publishing

## 1.1.3

### Patch Changes

- [#32](https://github.com/Medal-Social/MedalSocial-SDK/pull/32) [`3a21530`](https://github.com/Medal-Social/MedalSocial-SDK/commit/3a21530c6ed3ef703aa692e68c71d7808e766f0b) Thanks [@alioftech](https://github.com/alioftech)! - Sync dev branch to match published state (1.1.2):

  - Bump package.json version from 1.0.0 → 1.1.2
  - Bump jsr.json version from 1.1.1 → 1.1.2
  - Remove two stale changeset files already consumed by prod's release cycle

  No user-facing code changes. This avoids repeated version bumps and duplicate changesets on future dev→prod syncs.

## 1.1.2

### Patch Changes

- [#29](https://github.com/Medal-Social/MedalSocial-SDK/pull/29) [`16e7e4c`](https://github.com/Medal-Social/MedalSocial-SDK/commit/16e7e4cdae41dc14f65072d3950ee5f786255431) Thanks [@alioftech](https://github.com/alioftech)! - Fix repository metadata URLs in package.json to point to the correct MedalSocial-SDK repository. Updates repository.url, bugs.url, and homepage fields for npm provenance compliance.

## 1.1.1

### Patch Changes

- [#26](https://github.com/Medal-Social/MedalSocial-SDK/pull/26) [`63364b1`](https://github.com/Medal-Social/MedalSocial-SDK/commit/63364b14913772e0c89412686bd18f693b3289ff) Thanks [@alioftech](https://github.com/alioftech)! - Fix repository metadata URLs in package.json to point to the correct MedalSocial-SDK repository. Updates repository.url, bugs.url, and homepage fields for npm provenance compliance.

## 1.1.0

### Minor Changes

- [#18](https://github.com/Medal-Social/MedalSocial-SDK/pull/18) [`8aac155`](https://github.com/Medal-Social/MedalSocial-SDK/commit/8aac1554379cbaf83284fd3b4bd20ec45055e4d1) Thanks [@alioftech](https://github.com/alioftech)! - Add Pilot crew integration and JSR distribution

  **Pilot integration** (`@medalsocial/sdk/pilot`):

  - `createMedalClient(apiKey, options?)` — convenience factory wrapping `new Medal()` for agent/Pilot use
  - `createMedalTools(client)` — returns Vercel AI SDK-compatible tool definitions with Zod schemas for `sendEmail`, `createContact`, `addContactNote`, `recordCookieConsent`, `recordConsent`, and `createDeal`
  - `plugin.toml` manifest for Pilot plugin discovery

  **JSR distribution**: SDK now publishes to `@medalsocial/sdk` on JSR in addition to npm, covering Deno and edge runtimes

  **Tooling**: knip dead-export analysis, secretlint credential scanning, husky pre-commit hooks, auto-approve for bot PRs
