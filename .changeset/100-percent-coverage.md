---
'@medalsocial/sdk': patch
---

Lock SDK at 100% test coverage. The vitest config now enforces 100% lines/branches/functions/statements thresholds against `src/**` (with type-only files in `src/types/**` and `src/devices/**` excluded since they emit no runtime). Added a focused test for the `createMedalClient` factory covering the default path, option forwarding (baseUrl + workspaceId header), and the empty-token guard. No public API changes.
