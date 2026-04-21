---
"@medalsocial/sdk": minor
---

Add Pilot crew integration and JSR distribution

**Pilot integration** (`@medalsocial/sdk/pilot`):
- `createMedalClient(apiKey, options?)` — convenience factory wrapping `new Medal()` for agent/Pilot use
- `createMedalTools(client)` — returns Vercel AI SDK-compatible tool definitions with Zod schemas for `sendEmail`, `createContact`, `addContactNote`, `recordCookieConsent`, `recordConsent`, and `createDeal`
- `plugin.toml` manifest for Pilot plugin discovery

**JSR distribution**: SDK now publishes to `@medalsocial/sdk` on JSR in addition to npm, covering Deno and edge runtimes

**Tooling**: knip dead-export analysis, secretlint credential scanning, husky pre-commit hooks, auto-approve for bot PRs
