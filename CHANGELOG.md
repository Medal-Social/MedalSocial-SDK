# @medalsocial/sdk

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
