# @medalsocial/sdk — Claude Guide

## What this is

TypeScript SDK for the Medal Social API. Public open-source package published to npm as `@medalsocial/sdk`.

## Branch Strategy

```
feat/* → dev → promote/dev-to-prod-<date> → prod
```

- `dev` — where all feature PRs merge first
- `prod` — **the repository's default branch**. Pushing to it triggers the
  release and the docs deploy. GitHub also evaluates Dependabot and code
  scanning alerts against `prod`, so a security fix merged to `dev` does not
  clear the security tab until it is promoted.

### `prod` is ahead of `dev`, and that is structural

Every release puts a `chore: release packages` commit (version bump +
CHANGELOG) on `prod` that is never back-merged. So:

- `prod` is **not** an ancestor of `dev` — `git merge-base --is-ancestor
  origin/prod origin/dev` fails, and a fast-forward promote is impossible.
- `dev` is missing prod's release bookkeeping until someone back-merges.

Repairing the ancestry does not stick: the next release breaks it again. The
durable fix is to **back-merge `prod` → `dev` after every release** (as PR #67
did), or to move the version bump onto `dev`. Until then, promote with the
tree-swap below.

`git cherry origin/dev origin/prod` prints ~30 `+` lines here. That is patch-id
noise from squash-created promote commits, **not** evidence of lost content —
do not use it as the pre-flight. Use the tree diff instead.

## Promoting `dev` → `prod`

One commit carrying **dev's exact tree** with prod's tip as its parent. Never
open a `base=prod head=dev` PR directly — it shows as conflicting.

```bash
git fetch origin '+refs/heads/dev:refs/remotes/origin/dev' '+refs/heads/prod:refs/remotes/origin/prod'

# Pre-flight — this is the check that matters. Every line must be an expected
# `M`. An unexpected `D` means the swap would DROP content that only exists on
# prod: stop and back-merge prod into dev first.
git diff --name-status origin/prod origin/dev

DATE=$(date -u +%Y-%m-%d)
SHA=$(git commit-tree 'origin/dev^{tree}' -p origin/prod   -m "chore(release): promote dev → prod ($DATE)")

# Verify the promote commit really carries dev's tree — must print nothing.
git diff "$SHA" origin/dev

git push origin "$SHA:refs/heads/promote/dev-to-prod-$DATE"
gh pr create --base prod --head "promote/dev-to-prod-$DATE"   --title "chore(release): promote dev → prod ($DATE)"
```

Then, once `lint` / `test` / `build` are green on the PR:

```bash
# --match-head-commit refuses the merge if anything landed on the branch after
# you opened it, so the approval cannot be transferred to a different tree.
gh pr merge --squash --match-head-commit "$SHA" "promote/dev-to-prod-$DATE"
```

`prod` requires **1 approving review from another account** — whoever pushed
the branch cannot approve it.

### What the promote triggers

- `release.yml` — Changesets. With pending `.changeset/*.md` files it opens a
  `chore: release packages` version PR (bot-pushed, so it is self-mergeable);
  merging that publishes to npm + JSR. **With no pending changesets nothing is
  published** and the version stays put.
- `docs.yml` — TypeDoc to GitHub Pages.
- `codeql.yml` / `scorecard.yml` — re-scan, which is what closes security alerts.

### Rollback

There is none, and there cannot be one: npm and JSR releases are immutable and
npm blocks unpublish after 72 hours. **Releases are roll-forward only** — fix
on `dev`, promote again, publish a new patch. Treat the promote as the point of
no return and make sure CI is green before merging, not after.

## Release Pipeline

Publishing uses **Changesets** with **npm OIDC trusted publishing** — no static `NPM_TOKEN` is needed.

### How it works

1. Merge a PR with a `.changeset/*.md` file into `dev`
2. Promote `dev → prod` (see [Promoting `dev` → `prod`](#promoting-dev--prod) — it is a tree-swap, not a plain PR)
3. Merging to `prod` triggers `.github/workflows/release.yml`
4. The workflow runs inside the `npm` GitHub Environment (locked to `prod` branch only)
5. `id-token: write` permission issues an OIDC token
6. npm authenticates via OIDC — no secret token required
7. `NPM_CONFIG_PROVENANCE=true` attaches provenance attestation to the published package

### Adding a changeset

```bash
pnpm changeset        # interactive — pick patch/minor/major + write summary
```

Or just create `.changeset/<name>.md` manually:

```md
---
"@medalsocial/sdk": minor
---

Add support for X resource
```

### One-time npm setup (already done)

- npmjs.com → `@medalsocial/sdk` → Settings → Publishing access → OIDC enabled for `Medal-Social/MedalSocial`
- GitHub Environment `npm` exists, locked to `prod` branch

## CI

`.github/workflows/ci.yml` runs on all PRs and pushes to `dev`/`prod`:

| Job | What it checks |
|-----|---------------|
| `test` | Vitest via `pnpm test:coverage` + Codecov upload. Coverage thresholds are **100%** on statements/branches/functions/lines — a new uncovered branch fails CI |
| `lint` | Biome |
| `build` | `pnpm typecheck`, then OpenAPI lint, `tsup` build, OpenAPI coverage, entry-point verification |
| `security` | secretlint over tracked files + knip |

`pnpm typecheck` runs `tsc --noEmit` twice: once on `tsconfig.json` (`src` only,
the shipped surface) and once on `tsconfig.test.json`, which widens it to
`tests`, `pilot` and `scripts`. Vitest never typechecks, so without the second
pass test files are unchecked.

`prod`'s ruleset requires the `lint`, `test` and `build` contexts.

## Security Workflows

| Workflow | Trigger |
|----------|---------|
| `codeql.yml` | Push to `prod` + weekly Monday |
| `scorecard.yml` | Push to `prod` + weekly Monday |

## Project Structure

```
src/
  client.ts          # BaseClient — HTTP, retry (drains body before retry), auth
  index.ts           # Medal class — main entry point, defaults baseUrl to https://io.medalsocial.com
  resources/         # contacts, deals, emails, gdpr, posts, workspaces
  types/             # TypeScript types per resource
tests/
  client.test.ts     # Unit tests
  integration.test.ts # Live API tests — skipped without credentials
```

## Key Rules

- **Public repo** — never commit secrets, internal URLs, or Medal Social infrastructure references
- **Base URL** is `https://io.medalsocial.com` — not `api.medalsocial.com` (common mistake, already fixed once)
- **License** is Apache-2.0 — keep `LICENSE`, `package.json`, and published metadata aligned
- **No `NPM_TOKEN`** — publishing uses OIDC, do not add a static token
- Authoritative source is `medal-monorepo/packages/sdk` — sync changes back there too
