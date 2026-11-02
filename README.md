# Medal Social SDK

The official TypeScript packages for the [Medal Social](https://medalsocial.com) API.

This repository is a pnpm workspace. Each published package lives under `packages/`:

| Package | Directory | What it is |
|---|---|---|
| [`@medalsocial/sdk`](https://www.npmjs.com/package/@medalsocial/sdk) | [`packages/sdk`](packages/sdk) | The API client: posts, emails, contacts, deals, bookings, helpdesk, webhooks, GDPR and more. Also on [JSR](https://jsr.io/@medalsocial/sdk). |
| [`@medalsocial/booking`](https://www.npmjs.com/package/@medalsocial/booking) (pre-release) | [`packages/booking`](packages/booking) | The booking product on top of the SDK: wizard rules, clock, money and portal helpers (`/core`); React screens and Next.js server pieces to follow. |
| [`@medalsocial/ordering`](https://www.npmjs.com/package/@medalsocial/ordering) | [`packages/ordering`](packages/ordering) | Restaurant online ordering on top of the SDK: money in øre, table and channel links, the cart draft and check, modifier rules, opening hours and pre-order slots, order status words and delivery quote freshness (`/core`); the menu list, dish sheet, cart bar, cart list, checkout, address lookup, order status and closed notice as React components (`/react`); and Next.js route handlers for the menu, locations, slots, table, placing an order, its status, the Vipps return, and delivery address lookup and quotes (`/next`). |

Start with the [`@medalsocial/sdk` README](packages/sdk/README.md) for installation and usage.

```bash
npm install @medalsocial/sdk
```

## Developing

```bash
pnpm install
pnpm quality     # lint + typecheck + tests, across every package
pnpm build       # build every package
```

`examples/` holds small apps that use the packages through `workspace:*`. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and
[SECURITY.md](SECURITY.md) to report a vulnerability.

## License

Apache-2.0
