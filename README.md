# Medal Social SDK

The official TypeScript packages for the [Medal Social](https://medalsocial.com) API.

This repository is a pnpm workspace. Each published package lives under `packages/`:

| Package | Directory | What it is |
|---|---|---|
| [`@medalsocial/sdk`](https://www.npmjs.com/package/@medalsocial/sdk) | [`packages/sdk`](packages/sdk) | The API client: posts, emails, contacts, deals, bookings, helpdesk, webhooks, GDPR and more. Also on [JSR](https://jsr.io/@medalsocial/sdk). |

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
