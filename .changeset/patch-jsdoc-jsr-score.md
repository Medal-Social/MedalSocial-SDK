---
"@medalsocial/sdk": patch
---

Add JSDoc documentation to all exported symbols for JSR 100% score. This includes:
- `@module` JSDoc to `src/index.ts` entrypoint
- JSDoc for every exported type, interface, and class across all type and resource files
- JSDoc for `MedalOptions`, `createMedalClient`, `ClientConfig`, and all `BaseClient` public methods
- Added `description` field to `jsr.json`
- Added `.github/workflows/jsr-publish.yml` for JSR provenance publishing
