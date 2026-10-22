# @medalsocial/ordering

Restaurant online ordering on a Medal site, on top of
[`@medalsocial/sdk`](../sdk) (`medal.ordering.menu()`).

> Pre-release: the package is not on npm yet.

ESM only, three entries:

| Entry | What it is |
|---|---|
| `@medalsocial/ordering/core` | Framework-free rules: money, links, the cart draft, modifier rules, labels. Runs in a browser, Node or a Worker. |
| `@medalsocial/ordering/react` | `<MenuList>`, `<ItemSheet>` (the dish sheet) and `<ClosedNotice>`, with their nb/en words. Client components. |
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
drafts.rotateIdempotencyKey(); // after an order went through

// The Medal API's modifier rules, for telling the guest early.
validateSelections(item, selections); // { ok: true } | { ok: false, groupId, reason }
unitPriceOre(item, selections); // the dish price plus the chosen options
```

`allergenLabel` / `dietaryLabel` name the 14 declarable allergens and the
dietary marks in Norwegian, English and Arabic.

Cart totals, VAT, checkout and payment are the server's; nothing here prices
an order.

## `/react`

Presentational, controlled components: the page fetches the menu, keeps the
cart and decides when the sheet is open. Words come in Norwegian (`nb`, `no`,
`nn`) and English (anything else); pass `labels` to change any of them.

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
  is set, cannot be chosen. Each section is `#ordering-category-<category id>`.
- `ItemSheet` — a modal dialog: radios for a group of exactly one, checkboxes
  otherwise, quantity 1–99, a note of up to 200 characters, and an add button
  showing the price with the choices times the quantity. A missing required
  choice is shown at its group, and focus moves there. Pass `initial` to edit
  a cart line (and a `key` per line when editing two lines of one dish in a row).
- `ClosedNotice` — «Restauranten tar ikke imot bestillinger nå.» and when it
  opens next («Åpner i morgen kl. 11:00»), in the restaurant's time zone
  (default `Europe/Oslo`). Without `now`, the opening line appears once the
  page hydrates, so a cached server render never shows a stale «i morgen».

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
  case); a `?t=` table link with neither means `dine_in`. With none, the
  `defaultChannel` option (default `takeaway`). Any other value is a `400`.
- **`?at=`** — read the menu as it will be at that instant (ISO 8601 with `Z`
  or an offset, or Unix milliseconds). It must lie inside Medal's window (one
  day back to 60 days ahead) or the route answers `400` without calling
  Medal. It is rounded down to the minute and cached like the current menu
  (up to 100 instants, least recently used out first), so `?at=` cannot be
  used to spend the site's API rate limit. No other query parameter is
  forwarded; `location` is an option, never read from the request.
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
  menu between instances; a store that throws counts as a miss. Pass
  `waitUntil` (`ctx.waitUntil` on Workers, `after` in Next) so a shared
  revalidation finishes even when the request that started it goes away.
- **Errors** — `{ error: { code, message } }` with fixed words, `Cache-Control:
  no-store`, never the key, Medal's message or an upstream URL:

  | Case | Status | `code` |
  |---|---|---|
  | Bad `channel` / `at` | 400 | `INVALID_CHANNEL` / `INVALID_AT` |
  | Medal refused the request (400) | 400 | `INVALID_REQUEST` |
  | Workspace has no online ordering | 404 | `ORDERING_NOT_ENABLED` |
  | No API key | 500 | `NOT_CONFIGURED` |
  | Medal rate-limited the site (429) | 503 | `MENU_UNAVAILABLE` |
  | Anything else (5xx, network, timeout, auth) | 502 | `MENU_UNAVAILABLE` |

  `ORDERING_NOT_ENABLED` is a 404, not a 503: there is no menu to find, and a
  503 invites retries for something that will not recover by itself. When a
  menu is cached and Medal fails transiently (5xx, 429, network, timeout), the
  cached menu is served instead (stale-if-error) and Medal is asked again a
  window later. When Medal refuses (ordering off, key rejected) the cached
  menu is dropped and the error answered. `onError` sees every failed Medal read,
  for the site's logger.

## License

Apache-2.0
