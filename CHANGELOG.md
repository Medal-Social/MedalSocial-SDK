# @medalsocial/sdk

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
