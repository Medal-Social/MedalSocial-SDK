---
'@medalsocial/sdk': patch
---

Close the last advisory and take the safe dev-tooling upgrades.

`js-yaml` reaches the tree only through `@commitlint/cli` and
`openapi-typescript`, so it moves by override to 4.3.2 (GHSA-2883-xcg3-v3hh).
Nine devDependencies take their current minor/patch. No runtime dependency
changes.
