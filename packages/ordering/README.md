# @medalsocial/ordering

Restaurant online ordering on a Medal site, on top of
[`@medalsocial/sdk`](../sdk) (`medal.ordering.menu()`).

> Pre-release: the package is not on npm yet.

ESM only, three entries:

| Entry | What it is |
|---|---|
| `@medalsocial/ordering/core` | Framework-free rules: money, links, the cart draft, modifier rules, labels. Runs in a browser, Node or a Worker. |
| `@medalsocial/ordering/react` | Reserved: the menu list, the dish sheet and the closed notice. Client components. |
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

## License

Apache-2.0
