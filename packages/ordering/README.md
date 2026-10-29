# @medalsocial/ordering

Restaurant online ordering on a Medal site, on top of
[`@medalsocial/sdk`](../sdk) (`medal.ordering`).

> Pre-release: the package is not on npm yet.

ESM only, three entries:

| Entry | What it is |
|---|---|
| `@medalsocial/ordering/core` | Framework-free rules: money, links, the cart draft, modifier rules, the cart check, checkout's details check, order status words, opening hours and pickup slots, allergen/dietary labels, the components' nb/en words, and `placeOrder`/`fetchOrderStatus` for the browser. Runs in a browser, Node or a Worker. |
| `@medalsocial/ordering/react` | `<MenuList>`, `<ItemSheet>` (the dish sheet), `<CartBar>`, `<CartList>`, `<Checkout>`, `<OrderStatus>` and `<ClosedNotice>`. Client components. |
| `@medalsocial/ordering/next` | `createMenuRoute`: the menu route handler, cached and revalidated with Medal's ETag. Server-only. |

## `/core`

```ts
import {
  buildOrderLink,
  createDraftStore,
  createMoney,
  parseOrderLink,
  unitPriceOre,
  validateSelections,
} from '@medalsocial/ordering/core';

// Money is integer øre on the wire.
createMoney().formatOre(14_950); // «149,50 kr» (U+00A0 before «kr»)
createMoney({ locale: 'en-GB', currency: 'GBP' }).formatOre(1_250); // «£12.50»

// ?t=<table token> and ?c=dine_in|takeaway|delivery. A table link is dine-in.
parseOrderLink(searchParams); // { table: 'T7', channel: 'dine_in' }
buildOrderLink({ path: '/order', table: 'T7' }); // '/order?t=T7'

// The cart draft, per site and location, in localStorage. Ids and choices only.
const drafts = createDraftStore({ site: 'my-site', locationId });
drafts.addLine({ itemId, quantity: 1, selections: { size: ['large'] } });

// Placing the order: mark the key as sent, then send it with the order.
const draft = drafts.markSubmitted();
const response = await placeOrder(draft); // the site's checkout call, sending draft.idempotencyKey
if (response.ok) drafts.clearDraft(); // confirmed: the cart is done
// Failed or no answer: retry with the same cart and the same key.

// The Medal API's modifier rules, for telling the guest early.
validateSelections(item, selections); // { ok: true } | { ok: false, groupId, reason }
unitPriceOre(item, selections); // the dish price plus the chosen options
```

The idempotency key keeps a retried order from being placed twice:

1. It stays while the guest builds the cart.
2. `markSubmitted()` right before the order is sent records on the draft that
   this key has been sent.
3. A retry of the same cart (a dropped connection, a reload) keeps the key and
   the mark, so the server answers with the order it already has.
4. Any change to the cart after that (`addLine`, `updateLine`, `removeLine`,
   or `saveDraft` with other lines, channel or table) gets a new key and clears
   the mark — a changed cart is a new order.
5. After a confirmed order, `clearDraft()`. `rotateIdempotencyKey()` is not
   the step after an order: it KEEPS the lines under a new key, for sending
   the same cart again as a new order on purpose.

`allergenLabel` / `dietaryLabel` name the 14 declarable allergens and the
dietary marks in Norwegian, English and Arabic.

`ORDERING_LABELS`, `mergeLabels(locale, overrides)` and `fill(template,
values)` are the components' words (type `OrderingLabels`). They live here,
not in `/react`, so a server component can import them without pulling in a
`'use client'` module; `/react` re-exports the `OrderingLabels` type only. An
override left `undefined` keeps the pack's word.

### Cart, checkout and status

```ts
import {
  checkCart,
  checkCustomer,
  fetchOrderStatus,
  placeOrder,
  refusalMessage,
  resolveCart,
  toOrderLine,
} from '@medalsocial/ordering/core';

// The draft against the menu: priced lines, and the lines it can no longer serve.
const cart = resolveCart(menu, draft.lines); // { lines, dropped, totalOre, count }

// The Medal API's own cart check, on the lines that will be sent.
checkCart(menu, cart.lines.map(toOrderLine)); // { ok: true, totalOre, lineTotalsOre } | { ok: false, code, … }

// The guest's details, checked as the API checks them.
checkCustomer({ name, phone, email }, allergyNote); // null | 'name' | 'phone' | 'email' | 'allergy_note'

// Through the site's own routes (`/next`), with the draft's key.
const sent = drafts.markSubmitted();
const placed = await placeOrder({ url: '/api/ordering/orders', request, idempotencyKey: sent.idempotencyKey });
if (placed.ok) drafts.clearDraft();
else refusalMessage(placed.error, mergeLabels('nb')); // «Noe i bestillingen er utsolgt. …»

await fetchOrderStatus('/api/ordering/status', orderId); // { ok: true, data: OrderingOrderStatusView } | { ok: false, error }
```

`checkCart` stops at the total: the VAT breakdown is the server's (an option
that is a product of its own is taxed apart there, and the wire menu does not
say which options are), so a receipt reads it from the order. The server
prices every order again regardless; nothing the browser sends is a price.

`orderStatusLabel`, `isFinalStatus`, `ORDER_STEPS` and `orderStepIndex` put
the API's status names into the guest's words (nb, en, ar) and on a
timeline; `openingLine` writes «Åpner i morgen kl. 11:00».

### Hours

The Medal API's own hours engine, the same code the API runs (ported
unchanged, held to it by the parity fixtures below). Times are epoch
milliseconds; the wall clock is the restaurant's `timeZone` (IANA, default
`DEFAULT_TIME_ZONE`, `Europe/Oslo`), never the visitor's.

```ts
import {
  channelState,
  slots,
  slotsForDate,
  toEngineChannel,
  type EngineInput,
} from '@medalsocial/ordering/core';

const input: EngineInput = { hours, settings, timeZone: 'Europe/Oslo' };
const channel = toEngineChannel('dine_in'); // 'dineIn'

channelState(input, channel, Date.now());
// { open: true, closesAt, lastOrderAt }
// | { open: false, reason: 'closed' | 'cutoff' | 'paused' | 'kitchen_closed' | 'delivery_off', opensAt? }

slots(input, channel, Date.now(), 2); // pickup/delivery slots, today and tomorrow: [{ start, end }]
slotsForDate(input, channel, '2026-10-23', Date.now()); // one service date's slots
```

- `channelState` answers "does this channel take orders now?": open with
  the window's close and last order time, or closed with the reason and, when
  it is known within a week, `opensAt`. That `opensAt` can go straight into
  `<ClosedNotice nextOpenAt>` (or `MenuList`'s `closed.nextOpenAt`).
- `slots` / `slotsForDate` answer "when can the guest pick up?": starts on
  local slot boundaries, from now plus prep (and busy) time, up to close minus
  the cutoff, within the pre-order days. A DST change neither invents nor
  repeats a slot, and an overnight window's after-midnight slots belong to the
  evening it opened.
- `serviceDayEnd`, `parsePeriods`, `prepMinutes`, `effectivePreorderDays`,
  `localIsoDate` and `addIsoDays` are the engine's building blocks.
  `fromEngineChannel` maps the engine's channel back to the wire.
- `EngineChannel` is the engine's spelling (`dineIn`), `OrderingChannel` the
  wire's (`dine_in`); a window (`HoursWindow`) is `{ start, end }`, end exclusive.

## `/react`

Presentational, controlled components: the page fetches the menu, keeps the
cart and decides when the sheet is open. Words come in Norwegian (`nb`, `no`,
`nn`) and English (anything else); pass `labels` to change any of them (the
packs are `ORDERING_LABELS` in `/core`).
For `ar`, the component words fall back to English while the allergen and
dietary names are Arabic, and there is no right-to-left handling yet.

```tsx
'use client';
import {
  createDraftStore,
  type OrderingMenu,
  type OrderingMenuItem,
} from '@medalsocial/ordering/core';
import { ItemSheet, MenuList } from '@medalsocial/ordering/react';
import { useState } from 'react';

export function Menu({ menu, closed }: { menu: OrderingMenu; closed?: { nextOpenAt: string } }) {
  // One store per page instance, never a module-level one shared by server renders.
  const [drafts] = useState(() => createDraftStore({ site: 'my-site' }));
  const [item, setItem] = useState<OrderingMenuItem | null>(null);
  return (
    <>
      <MenuList menu={menu} locale="nb" closed={closed} onSelectItem={setItem} />
      <ItemSheet
        item={item}
        open={item !== null}
        locale="nb"
        onClose={() => setItem(null)}
        onAdd={(line) => {
          drafts.addLine(line);
          setItem(null);
        }}
      />
    </>
  );
}
```

- `MenuList` — sticky category links, one section per category, each dish
  with its photo, price, allergens (in words, not only a symbol), dietary
  marks and a «Utsolgt» badge. Sold-out dishes, and every dish while `closed`
  is set, cannot be chosen. Each section is `#ordering-category-<category id>`
  when the id is safe in a fragment (letters, digits, `-`, `_`). Otherwise the
  other characters become `-` and a short hash of the id follows
  (`#ordering-category-a-b-<hash>` for `a.b`), so two ids never share an
  anchor and each anchor stays the same between renders.
- `ItemSheet` — a modal dialog: radios for a group of exactly one, checkboxes
  otherwise, each option with its own allergens in words, quantity 1–99, a note of up to 200 characters, and an add button
  showing the price with the choices times the quantity. A missing required
  choice is shown at its group, and focus moves there. Pass `initial` to edit
  a cart line (and a `key` per line when editing two lines of one dish in a row).
  When the page hands it a refetched dish while it is open, a new group starts
  empty and an option the dish no longer has is dropped from the choices.
- `CartBar` — a bar fixed to the bottom of a phone screen: how many dishes
  and the total, pressing it opens the cart. Nothing while the cart is empty.
- `CartList` — each line with its choices, note and price, a quantity
  stepper (`onQuantity`) and a remove button (`onRemove`), the total, and a
  notice naming the lines the menu could no longer serve.
- `Checkout` — one form: pickup or dine-in (dine-in only with a table from
  the QR code; the choice shows only when there is one), as soon as possible
  or a slot (`loadSlots` with `allowScheduled`, off until the restaurant takes
  orders ahead), name, mobile and e-mail, an allergy note with
  «Kontakt restauranten ved alvorlig allergi.», cutlery, and Vipps or pay at
  the counter as the location allows. The details are checked before
  anything is sent and the first field at fault gets the focus; a refusal is
  shown in plain words (`CLOSED` → «Restauranten tar ikke imot bestillinger
  nå. Åpner …»), and a refused detail on its field. A double press sends one
  order. `onPlace` sends it (`placeOrder`), `onPlaced` gets the created
  order: send the guest to `payment.redirect_url` for Vipps, else the
  receipt. Delivery comes with plan 8c.
- `OrderStatus` — the receipt's status: the order number, the status in
  words, «Klar ca. kl. 18:30», the steps, and what happened to the money when
  it ended without food. It reads `load` every 15 s until there is nothing
  left to wait for, and at once when the guest returns to the tab.
- `ClosedNotice` — «Restauranten tar ikke imot bestillinger nå.» and when it
  opens next («Åpner i morgen kl. 11:00»), in the restaurant's time zone
  (default `Europe/Oslo`). Without `now`, the opening line appears once the
  page hydrates, so a cached server render never shows a stale «i morgen»,
  and it moves on by itself at each minute (so at the restaurant's midnight)
  and disappears at the opening.

Styling is Tailwind v4 classes on the shadcn colour tokens meda also uses
(`background`, `foreground`, `primary`, `muted`, `border`, `destructive`, …),
so the site's own theme variables restyle them. Tailwind does not scan
`node_modules`, so add a `@source` for the package next to the site's theme,
relative to that CSS file:

```css
@source '../node_modules/@medalsocial/ordering/dist/react';
```

## `/next`

The browser never talks to Medal: the site serves the menu from its own route,
with its workspace API key on the server.

```ts
// app/api/ordering/menu/route.ts
import { createMenuRoute } from '@medalsocial/ordering/next';

export const GET = createMenuRoute({ apiKey: process.env.MEDAL_API_KEY! });
```

No `export const revalidate` is needed: the handler reads `request.url`, so
Next treats the route as dynamic and the handler's own `Cache-Control` and
server cache are the 60-second "ISR". Add `export const dynamic =
'force-dynamic'` only if a build tries to prerender the route.

`GET /api/ordering/menu?c=takeaway` answers `200 { data: OrderingMenu }`.

- **Channel** — `?channel=` or `?c=` (`dine_in`, `takeaway`, `delivery`, any
  case); a `?t=` table link with neither means `dine_in`. With none (an
  empty value counts as none), the `defaultChannel` option (default
  `takeaway`). Any other value is a `400`.
- **`?at=`** — read the menu as it will be at that instant (ISO 8601 with `Z`
  or an offset, or Unix milliseconds). It must lie inside Medal's window (one
  day back to 60 days ahead) or the route answers `400` without calling
  Medal. It is rounded down to the minute — so a dish scheduled from the
  middle of a minute shows from the next minute — and cached like the current
  menu (up to 100 instants, least recently used out first). Timed reads that
  miss that cache are budgeted: at most `maxTimedReadsPerWindow` (default 20)
  Medal calls per `revalidateSeconds` window in each route instance; past it
  the route answers `503 MENU_UNAVAILABLE` without calling Medal. A script
  walking through instants therefore costs the site's key a bounded number of
  calls per window per instance, not one per request. No other query
  parameter is forwarded; `location` is an option, never read from the
  request.
- **Caching** — the server keeps the last menu per channel and asks Medal
  again at most every `revalidateSeconds`, with `If-None-Match`; a `304` from
  Medal keeps the menu. Concurrent requests share one Medal call. The response
  carries Medal's `ETag` and
  `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`, and an
  `If-None-Match` that still matches gets a `304`. Medal marks the menu
  `private` because it answers per API key; this route has no key on the way
  in and every visitor sees the same public menu, so a CDN may keep it.
- **Store** — in-process by default, so on Workers each isolate keeps (and
  warms) its own copy; the CDN's `s-maxage` is what keeps Medal calls low
  there. Pass `store: { get, set, delete }` (KV, Redis) to share the current
  menu between instances, with a `storeKeyPrefix` (required with `store`,
  e.g. `'my-site'`): every key starts with `<prefix>:`, so two sites or
  environments sharing one store never read each other's menu. A store call
  that throws or takes longer than 1.5 s counts as a miss (or a failed
  write); the request still answers, from Medal. Pass
  `waitUntil` so a shared revalidation finishes even when the request that
  started it goes away. It is called per request, so read the platform's
  context inside it — on OpenNext for Cloudflare:

  ```ts
  import { getCloudflareContext } from '@opennextjs/cloudflare';

  export const GET = createMenuRoute({
    apiKey: process.env.MEDAL_API_KEY!,
    waitUntil: (p) => getCloudflareContext().ctx.waitUntil(p),
  });
  ```

  A `waitUntil` that throws is ignored.
- **Errors** — `{ error: { code, message } }` with fixed words, `Cache-Control:
  no-store`, never the key, Medal's message or an upstream URL:

  | Case | Status | `code` |
  |---|---|---|
  | Bad `channel` / `at` | 400 | `INVALID_CHANNEL` / `INVALID_AT` |
  | Medal refused the request (400) | 400 | `INVALID_REQUEST` |
  | Workspace has no online ordering | 404 | `ORDERING_NOT_ENABLED` |
  | No API key | 500 | `NOT_CONFIGURED` |
  | Medal rate-limited the site (429), or the timed-read budget is spent | 503 | `MENU_UNAVAILABLE` |
  | Anything else (5xx, network, timeout, auth) | 502 | `MENU_UNAVAILABLE` |

  `ORDERING_NOT_ENABLED` is a 404, not a 503: there is no menu to find, and a
  503 invites retries for something that will not recover by itself. When the
  current menu is cached and Medal fails transiently (5xx, 429, network,
  timeout), the cached menu is served instead (stale-if-error) and Medal is
  asked again a window later. `?at=` reads have no stale-if-error: a failed
  timed read answers the error. When Medal refuses (ordering off, key rejected) the cached
  menu is dropped and the error answered. `onError` sees every failed Medal read,
  for the site's logger.

### Checkout and order routes

Every route takes `{ apiKey, baseUrl?, onError? }`, answers
`{ data }` or the same fixed-word `{ error: { code, message } }`
(`OrderingRouteErrorCode` in `/core`), and never puts the key in a response.

```ts
// app/api/ordering/locations/route.ts
export const GET = createLocationsRoute({ apiKey, location });
// app/api/ordering/slots/route.ts — ?channel=takeaway&date=2026-10-30
export const GET = createSlotsRoute({ apiKey, location });
// app/api/ordering/table/route.ts — ?t=<token from the table QR>
export const GET = createTableRoute({ apiKey });
// app/api/ordering/orders/route.ts
export const POST = createPlaceOrderRoute({
  apiKey,
  location,
  returnUrl: 'https://example.no/api/ordering/vipps-return',
});
// app/api/ordering/order/route.ts and …/status/route.ts — ?id=<order id>
export const GET = createOrderRoute({ apiKey });
export const GET = createOrderStatusRoute({ apiKey });
// app/api/ordering/vipps-return/route.ts
export const GET = createVippsReturnRoute({
  apiKey,
  receiptPath: '/bestill/kvittering',
  fallbackPath: '/bestill',
});
```

- **Place order** — the browser posts a `PlaceOrderRequest` with the draft's
  `Idempotency-Key` (`placeOrder` in `/core` does both). The route refuses a
  cross-origin `Origin` (403), anything but JSON (415), a missing key (400), a
  body over 32 KB (413), and any key a `PlaceOrderRequest` does not have — a
  price, `location_id`, `return_url` — (400). It adds `location_id` and, for
  Vipps, `return_url` from its own options, forwards the guest's IP for
  Medal's per-IP limit only from your `clientIp(request)` (no header is
  trusted by default — a guest can forge any of them; on Cloudflare pass
  `(r) => r.headers.get('cf-connecting-ip')`), and answers `201`. An `Origin`
  must match the host the browser asked for (`x-forwarded-host` or `host`,
  then `request.url`). Medal's
  refusals pass through as `422` with their code and only `ids`, `line_index`
  and `reason`. Delivery is not taken yet (plan 8c).
- **Locations** are cached 15 s and slots 60 s on the CDN; the table, the
  order and its status are `no-store`.
- **Vipps return** — Medal sends the guest back with `?order_id=`; the route
  checks the order exists and answers `303` with a relative `Location`
  (so an internal `request.url` never reaches the guest) to `<receiptPath>/<id>`, or to
  `fallbackPath` for a missing or unknown order. The receipt page polls the
  status (`OrderStatus`), so a payment still settling shows as such.

## Parity

`src/core/hours.ts` is the Medal API's hours engine, and
`tests/core/hours.parity.test.ts` runs every case in
`tests/fixtures/hours.json` (inputs and the API engine's answers) against it.
Refresh the fixture from a monorepo checkout (run from `packages/ordering`)
with `node scripts/export-hours-fixtures.mjs --engine
<monorepo>/apps/shared/ordering/hours.ts`; the input table is in the script.
Run it with `--engine src/core/hours.ts` and `git diff --exit-code
tests/fixtures/hours.json` to show the package answers the same. The script
formats the file with Biome itself.

`checkCart` is the API's cart pricing (`priceCart`) on the wire shape, totals
only. `tests/core/cart.parity.test.ts` runs every cart in
`tests/fixtures/cart.json` (a wire menu, carts and the API's answers)
through it; refresh the fixture with `node scripts/export-cart-fixtures.mjs
--engine <monorepo>/apps/shared/ordering/cart.ts`.

## License

Apache-2.0
