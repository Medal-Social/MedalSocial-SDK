# @medalsocial/sdk — Claude Guide

## What this is

TypeScript SDK for the Medal Social API. Public open-source package published to npm as `@medalsocial/sdk`.

## Packages

The repository is a **pnpm workspace** (`pnpm-workspace.yaml`: `packages/*` +
`examples/*`). The root `package.json` is private (`medalsocial-sdk-monorepo`)
and is never published.

| Package | Directory | Registries |
|---|---|---|
| `@medalsocial/sdk` | `packages/sdk` | npm (provenance) + JSR |
| `@medalsocial/booking` | `packages/booking` | npm only, **unpublished** (`"private": true` until 0.1.0) |

- **Root = shared tooling.** Biome, knip, commitlint, secretlint (with the
  repo-wide `scripts/secretlint-repo.mjs` / `secretlint-staged.mjs`), Husky,
  lint-staged, Changesets, `.pnpmfile.cjs`, CI and the Pilot plugin manifest
  (`plugin.toml`) live at the root. Root tooling never reaches into a package
  directory; the secretlint scripts' unit tests run with the SDK's script suite
  (`packages/sdk/tests/scripts`). `pnpm build` / `test` / `test:coverage` /
  `typecheck` fan out with `pnpm -r --filter './packages/*'`; `pnpm lint` is one
  Biome run over the whole repository; `pnpm quality` is lint + typecheck + test.
- **Package = everything that ships.** Source, tests, `scripts/`, `skills/`,
  `jsr.json`, the tsconfigs, tsdown/vitest/typedoc/redocly configs, `README.md`,
  `CHANGELOG.md` and a copy of `LICENSE`/`NOTICE` sit in the package directory.
  Package-only commands take a filter: `pnpm --filter @medalsocial/sdk <script>`.
- **Releases stay per package.** `.changeset/config.json` is one config with
  independent versions (`fixed: []`, `linked: []`). `pnpm run version` is
  `changeset version && node packages/sdk/scripts/sync-version.mjs`, and
  `pnpm run release` builds and path-verifies every package before
  `changeset publish`. JSR is `@medalsocial/sdk` only
  (`pnpm --filter @medalsocial/sdk run jsr:publish` in `release.yml`).
- **A new package** gets its own `package.json` (`files`, `exports`,
  `publishConfig.access: public`, `LICENSE`/`NOTICE` copies), a `verify:paths`
  script, a `build`/`test`/`typecheck` script so the fan-out picks it up, a
  `knip.json` workspace entry and a changeset for its first release. Keep the
  public-repo rule: no customer names, copy or data in any package.
- **`@medalsocial/booking`** is ESM-only with entries `./core`, `./react`, `./next` and
  `./next/cache/{workers,memory,next-data,noop}`. `/core` imports no React,
  Next, `server-only` or meda (Biome `noRestrictedImports` +
  `tests/core/boundary.test.ts`; `verify:paths` also imports the built
  `dist/core` in bare Node). Its typecheck maps `@medalsocial/sdk` onto
  `../sdk/src` so no build is needed first. The declaration build
  (`tsconfig.build.json`) resolves the BUILT SDK instead — mapping the source
  there makes tsc write `.d.ts` files into `packages/sdk/src` — and
  `scripts/ensure-sdk-types.mjs` builds the SDK first when its types are
  missing. Size budgets:
  `pnpm --filter @medalsocial/booking run size:budget` (CI `build` job).
  It stays `"private": true` — so `changeset publish` skips it — until the
  release PR for 0.1.0 removes the flag; its changesets accumulate until then.
  Public-repo rule: `tests/core/denylist.test.ts` fails on a customer or staff
  name anywhere in the package (hashed list, so the test names nobody).
- The published tarball must not change when files move around the workspace:
  compare `npm pack --dry-run --json` file lists and `package.json#exports`
  before and after, and the `jsr publish --dry-run` file set.

## Branch Strategy

```
feat/* → dev → promote/dev-to-prod-<date> → prod
```

- `dev` — where all feature PRs merge first
- `prod` — **the repository's default branch**. Pushing to it triggers the
  release and the docs deploy. GitHub also evaluates Dependabot and code
  scanning alerts against `prod`, so a security fix merged to `dev` does not
  clear the security tab until it is promoted.

### `prod` is ahead of `dev` permanently — do not try to "fix" it

`prod` is **not** an ancestor of `dev` and cannot be made one:

```bash
git merge-base --is-ancestor origin/prod origin/dev   # fails, by design
```

Every release puts a `chore: release packages` commit (version bump +
CHANGELOG) on `prod`, and every promote adds a squash commit that exists only
there. So `prod` always carries commits `dev` lacks.

**A back-merge cannot repair this.** `dev` has classic branch protection with
`required_linear_history: true` and `enforce_admins: true`, so merge commits
are refused outright — the API returns `405 Merge commits are not allowed on
this repository`, and `--admin` does not get past `enforce_admins`. Squash and
rebase both flatten the second parent, so a back-merge PR merged either way
restores nothing while looking like it did.

Do not cite PR #67 ("chore: back-merge prod into dev") as precedent. It merged
as `e1f0599` with a **single parent** — it was squashed, so it never restored
ancestry. The only true merge commits on `dev` predate linear history.

This is therefore a consequence of the branch policy, not neglect, and the
tree-swap promote below is the correct permanent procedure — not a workaround.
Changing it would mean relaxing linear history on `dev` and allowing
fast-forward pushes to `prod`, which is a deliberate policy decision, not a
cleanup task. Do not force-push `prod` either: it rewrites a public repo's
default branch, npm/JSR provenance attestations reference published commit
SHAs, and the next release breaks it again regardless.

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

### The second registry: JSR

The package also goes to [JSR](https://jsr.io/@medalsocial/sdk), from a
**separate workflow step** that runs after `changesets/action` — deliberately
not from inside `pnpm release`. Two reasons:

1. **Tags and GitHub releases must not depend on JSR.** They are created by the
   changesets action, and anything that fails inside the publish script fails
   the whole action. `jsr publish` used to sit at the end of `pnpm release`, so
   a JSR hiccup took the release bookkeeping with it.
2. **`jsr publish` is not atomic and not re-runnable.** JSR creates the version
   the moment the tarball is accepted; only *then* does `deno publish` mint the
   Sigstore provenance attestation. A transient Fulcio/Rekor failure exits
   non-zero on a version that is already live and immutable — and a plain
   re-run then dies on "already published".

`pnpm --filter @medalsocial/sdk run jsr:publish` (`packages/sdk/scripts/jsr-publish.mjs`) handles both: it asks
`https://jsr.io/@medalsocial/sdk/<version>_meta.json` before publishing and
skips if the version is there, and asks again if the CLI fails — a failure on a
version the registry already has downgrades to a warning naming the likely
culprit. Anything else still fails the job. `pnpm jsr:publish --dry-run` (from `packages/sdk`)
reports what it would do without publishing.

That dry run does **not** validate the package — it never runs `jsr publish`,
so a slow type (a public-API symbol with no explicit type) or a publish-scope
error passes it and fails only mid-release, after npm already has the version.
CI's `build` job therefore runs the real CLI,
`pnpm exec jsr publish --dry-run --allow-dirty` in `packages/sdk`; run the same locally before
promoting. 1.11.0 was caught this way: `MedalTimeoutError`'s constructor had an
untyped default parameter.

A version published without provenance has `rekorLogId: null` in
`https://api.jsr.io/scopes/medalsocial/packages/sdk/versions` — that is how to
tell an attestation failure from a healthy release after the fact.

## CI

`.github/workflows/ci.yml` runs on all PRs and pushes to `dev`/`prod`:

| Job | What it checks |
|-----|---------------|
| `test` | Vitest via `pnpm test:coverage` + Codecov upload. Coverage thresholds are **100%** on statements/branches/functions/lines — a new uncovered branch fails CI |
| `lint` | Biome |
| `build` | `pnpm typecheck` (every package), then the SDK's version sync check and OpenAPI lint, `pnpm build` (every package), the SDK's OpenAPI coverage, `verify:paths` for every package, then a JSR dry run in `packages/sdk` (`jsr publish --dry-run`: slow types and the publish scope) |
| `security` | secretlint over every tracked file in the repository + knip (all workspaces) |

In `packages/sdk`, `typecheck` runs `tsc --noEmit` twice: once on `tsconfig.json` (`src` only,
the shipped surface) and once on `tsconfig.test.json`, which widens it to
`tests`, `pilot` and `scripts`. Vitest never typechecks, so without the second
pass test files are unchecked.

### TypeScript 7 toolchain

`tsc` is TypeScript 7 (the native port) and `tsdown` builds `dist/`, with
declarations emitted by tsgo. Three pieces hold that together — each says in
its own comment when it can go:

- **`.pnpmfile.cjs`** — typedoc and openapi-typescript still need the legacy
  JS compiler API, which TS 7 does not ship. Their `typescript` peer is
  rewritten to a real dependency on `@typescript/typescript6`. Neither
  `overrides` nor `packageExtensions` can change what a peer resolves to.
- **`tsdown.config.ts` `tidyDeclarations`** — without it `pilot/index.d.ts`
  implicitly exports its private zod schemas, and declaration files carry
  dangling `sourceMappingURL`s. `tsconfig.build.json` adds the `./pilot` entry
  to the declaration build without widening the `src`-only typecheck.
- **`tests/setup-timers.ts`** — the suite runs on virtual time
  (`vi.setTimerTickMode("nextTimerAsync")`), so retry/`Retry-After`/poll waits
  are still taken and measured but cost no wall time. A test that needs real
  timers calls `vi.useRealTimers()` first.

`prod`'s ruleset requires the `lint`, `test` and `build` contexts.

## Security Workflows

| Workflow | Trigger |
|----------|---------|
| `codeql.yml` | Push to `prod` + weekly Monday |
| `scorecard.yml` | Push to `prod` + weekly Monday |

## Project Structure

Paths below are inside `packages/sdk/` unless they say otherwise.

```
src/
  client.ts              # BaseClient — HTTP, retry (jittered backoff, drains body before
                         # retry), caller AbortSignal, typed failures, paginate()
  index.ts               # Medal class — main entry point, defaults baseUrl to https://io.medalsocial.com
  version.ts             # GENERATED by scripts/sync-version.mjs — SDK_VERSION for the User-Agent
  capability-confirmer.ts # mints Idempotency-Key + X-Capability-Confirmation for confirmable writes
  webhook-events.ts      # typed WebhookEvent union + verifyWebhookSignature
  resources/             # bookings, capability-confirmations, channels, contacts, deals, emails,
                         # gdpr, helpdesk, portal, posts, scan, webhooks, workspaces
  types/                 # TypeScript types per resource
  openapi.generated.ts   # openapi-typescript output — regenerate with `pnpm openapi:types`
pilot/index.ts           # `@medalsocial/sdk/pilot` — zod tool schemas for agents (zod is an
                         # OPTIONAL peer dependency, needed only for this entry)
openapi/
  medal-social.openapi.yaml  # the OpenAPI 3.1 contract the SDK is checked against
  reference/                 # snapshot of the Medal API's own published surface (parity gate)
  parity-exceptions.json     # reviewed API-vs-SDK differences, each with a reason
skills/                  # TanStack Intent skills, shipped in the npm tarball
scripts/                 # release + verification scripts (each has a test under tests/scripts/)
tests/
  *.test.ts              # Unit tests (vitest, 100% coverage thresholds on src/)
  integration.test.ts    # Live API tests — skipped without credentials
```

At the repository root: `scripts/secretlint-{repo,staged}.mjs` (repo-wide
secret scans, tested from `packages/sdk/tests/scripts`), `plugin.toml` (Pilot plugin manifest), `examples/`,
`.changeset/`, `.github/`, `.husky/` and the shared tool configs.

There is no `src/devices/`: the module was never exported from any entry point,
so nothing could consume it, and it was deleted in the SDK-B audit round along
with its unfinished plan. Both are in git history if the device work restarts —
bring it back with tests and a `./devices` entry, not as dead code.

## Key Rules

- **Public repo** — never commit secrets, internal URLs, or Medal Social infrastructure references
- **Base URL** is `https://io.medalsocial.com` — not `api.medalsocial.com` (common mistake, already fixed once)
- **License** is Apache-2.0 — keep `LICENSE`, `package.json`, and published metadata aligned
- **No `NPM_TOKEN`** — publishing uses OIDC, do not add a static token
- **This repository is the authoritative source for the SDK.** The API it wraps is implemented in the private Medal Social monorepo; when the SDK's types drift from what the API actually accepts or returns, fix them here (types, resources and the OpenAPI document together), and remember that a value the API refuses with a 400 is a correction, not a breaking change, even when TypeScript now rejects it.
- **Enums are closed on purpose.** `DealStatus`, `DealCurrency`, `ContactStatus`, `PostStatus`, `EmailSendStatus`, `HelpdeskChannel`, `ChannelType`, `PortalLocale`, `SubscribableWebhookEventType` name exactly what the API accepts — do not widen them to `string` to make a caller compile. The one deliberate exception is `MedalErrorCode`, which is widened with `(string & {})`: a response code the server adds later must still arrive intact.
- **The coverage gate is a PARITY gate.** `pnpm --filter @medalsocial/sdk run openapi:coverage` derives the operation list from the SDK's own document and then diffs it against `openapi/reference/medal-api-v1-surface.json`, a committed snapshot of the Medal API's published surface. Adding a route means adding it to the document AND to a resource; adding a request enum means matching the API's values. Refresh the snapshot from a monorepo checkout (run from `packages/sdk`) with `--reference-source <monorepo>/apps/web/src/lib/openapi-spec.ts --write-reference openapi/reference/medal-api-v1-surface.json` **followed by `pnpm exec biome format --write openapi/reference/medal-api-v1-surface.json`** (the script has no formatter, and `pnpm lint` checks the committed file), or run the check straight against the live document with `--reference <that file>`. Reviewed differences go in `openapi/parity-exceptions.json` with a reason each — a stale entry fails the gate.
- **The version lives in one place.** `package.json` is the source; `src/version.ts` (`SDK_VERSION`, sent in the `User-Agent`), `jsr.json`, the OpenAPI `info.version` and the Pilot manifest's `[plugin] version` in `plugin.toml` are written by `packages/sdk/scripts/sync-version.mjs` (`plugin.toml` stays at the repository root; the script finds it two levels above the package, or through `--plugin-root`), which `pnpm run version` runs right after `changeset version`. Never hand-edit those four — `pnpm --filter @medalsocial/sdk run version:check` (in the `build` CI job) and `tests/version-sync.test.ts` fail on drift.
- **`engines.node` is `>=22`, and CI proves it.** The client only needs `fetch`, `AbortController`, `WritableStream` and Web Crypto, so the floor is set by what we can certify, not by an API: Node 20 reached end-of-life on 2026-04-30, and pnpm 11 (`>=22.13`), `changesets`, `secretlint` and `lint-staged` all need 22+. The `test` job runs the suite on 24 and `test-node` on 22 (a separate job, because `prod`'s ruleset requires a context named exactly `test`); add a line to that matrix when raising or widening the floor, never just the string in `package.json`.
