---
"@medalsocial/sdk": minor
---

Cover the confirmable write registry, add the missing bookings/portal routes, and make the OpenAPI gate able to see drift (audit SDK-B)

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
