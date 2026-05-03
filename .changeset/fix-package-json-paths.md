---
"@medalsocial/sdk": patch
---

fix: point package.json `main` / `module` / `types` / `exports` at the actual build output paths

`tsup src/index.ts pilot/index.ts` mirrors the input directory structure under `dist/`, so the bundles ship at `dist/src/index.{js,mjs,d.ts}` and `dist/pilot/index.{js,mjs,d.ts}`. The package.json was pointing the root entry at `dist/index.{js,mjs,d.ts}` which never existed. TypeScript could often resolve via legacy fallbacks, but bundlers that follow the `exports` map strictly (Turbopack, esbuild via `@opennextjs/cloudflare`, etc.) failed to find the module — the named imports got tree-shaken to `void 0` in deployed Cloudflare Workers, surfacing as `TypeError: (void 0) is not a constructor` at runtime.

This is the minimal-diff fix: just update the paths to point at where the files actually land. A future change could flatten the build to `dist/index.*` for cleaner public paths, but that requires a tsup config change.
