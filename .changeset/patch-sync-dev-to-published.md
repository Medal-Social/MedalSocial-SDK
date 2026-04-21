---
"@medalsocial/sdk": patch
---

Sync dev branch to match published state (1.1.2):
- Bump package.json version from 1.0.0 → 1.1.2
- Bump jsr.json version from 1.1.1 → 1.1.2
- Remove two stale changeset files already consumed by prod's release cycle

No user-facing code changes. This avoids repeated version bumps and duplicate changesets on future dev→prod syncs.
