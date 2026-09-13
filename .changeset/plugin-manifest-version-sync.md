---
"@medalsocial/sdk": patch
---

Keep the Pilot plugin manifest's version in step with the package.

#142 corrected `plugin.toml`'s `version`, frozen at `1.0.0` until then, by editing it by hand, so the very next release left it behind again: the 1.11.0 version bump moved `package.json`, `jsr.json`, `src/version.ts` and the OpenAPI document, but not the manifest. `scripts/sync-version.mjs` now writes the `[plugin]` table's `version` as well, and `pnpm run version:check` fails when it drifts.
