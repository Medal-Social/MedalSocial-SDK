# @medalsocial/ordering

Restaurant online ordering on a Medal site, on top of
[`@medalsocial/sdk`](../sdk) (`medal.ordering.menu()`).

> Pre-release: the package is not on npm yet.

ESM only, three entries:

| Entry | What it is |
|---|---|
| `@medalsocial/ordering/core` | Framework-free rules: money, links, the cart draft, modifier rules, labels. Runs in a browser, Node or a Worker. |
| `@medalsocial/ordering/react` | `<MenuList>`, `<ItemSheet>` (the dish sheet) and `<ClosedNotice>`, with their nb/en words. Client components. |
| `@medalsocial/ordering/next` | Reserved: the menu route handler. Server-only. |

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

## License

Apache-2.0
