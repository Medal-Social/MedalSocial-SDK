---
'@medalsocial/sdk': patch
---

Fix the Pilot plugin manifest's API host, correct the documented Node version,
and stop publishing the whole repository to JSR.

- `plugin.toml` granted network access to `api.medalsocial.com`, but the client
  calls `https://io.medalsocial.com` — so a Pilot plugin loading this manifest
  had permission for a host the SDK never contacts, and none for the host it
  does. Its `version` was also frozen at `1.0.0`.
- The README's Runtime Support section advertised Node.js 18+ while
  `engines.node` is `>=24`.
- `jsr.json` declared no `publish` scope, so `jsr publish` shipped 108 files —
  including all eight CI workflows, `.changeset/`, `CLAUDE.md`, the lockfile,
  the test suite and `.vscode`. Now 50.
