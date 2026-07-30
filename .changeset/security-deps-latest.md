---
"@medalsocial/sdk": minor
---

Security and toolchain refresh — zero open vulnerability alerts:

- All five open Dependabot alerts fixed by lifting the supply-chain override
  pins to patched releases: `js-yaml` 4.3.0, `fast-uri` 3.1.4, `linkify-it`
  5.0.2, `brace-expansion` 5.0.9 (plus refreshed `ajv`, `dompurify`,
  `markdown-it`, `minimatch`, `picomatch`, `rollup`, `yaml` pins).
  `pnpm audit` is clean.
- `zod` upgraded 3 → 4 (the SDK's only runtime dependency). Zod is used
  solely by the `@medalsocial/sdk/pilot` tool schemas; they now use the
  zod-4 idioms (`z.email()`, two-argument `z.record()`). Consumers passing
  those schemas into zod-3-only tooling should upgrade that tooling; modern
  AI SDKs accept zod 4 via Standard Schema.
- Dev toolchain to latest: TypeScript 6.0, Biome 2 (config migrated), knip 6,
  redocly 2.42, commitlint/changesets/secretlint/lint-staged patch bumps.
  No public API changes from the toolchain.
