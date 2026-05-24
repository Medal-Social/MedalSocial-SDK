# @medalsocial/sdk — Claude Guide

## What this is

TypeScript SDK for the Medal Social API. Public open-source package published to npm as `@medalsocial/sdk`.

## Branch Strategy

```
feat/* → dev → prod
```

- `dev` — default branch, all PRs merge here first
- `prod` — production branch, triggers release and docs deploy on push

## Release Pipeline

Publishing uses **Changesets** with **npm OIDC trusted publishing** — no static `NPM_TOKEN` is needed.

### How it works

1. Merge a PR with a `.changeset/*.md` file into `dev`
2. PR `dev → prod`
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
| `test` | Vitest unit tests + Codecov coverage upload |
| `lint` | Biome |
| `build` | `tsup` — ensures dist builds clean |

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
