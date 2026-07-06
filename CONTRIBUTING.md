# Contributing to @medalsocial/sdk

## Getting Started

1. Fork and clone the repository
2. Install dependencies: `pnpm install`
3. Build: `pnpm build`
4. Run tests: `pnpm test`

## Development

```bash
pnpm build          # Build dist/
pnpm dev            # Build in watch mode
pnpm test           # Run unit tests
pnpm lint           # Check code style
pnpm docs           # Generate TypeDoc documentation
```

## Project Structure

```
src/
  client.ts         # BaseClient — HTTP layer, retry, auth
  index.ts          # Medal class — main entry point
  resources/        # One file per API resource
  types/            # TypeScript types per resource
tests/
  client.test.ts    # Unit tests
  integration.test.ts # Live API tests (skipped without credentials)
```

## Pull Requests

- Branch from `dev`
- Write or update tests for any behavior change
- Ensure `pnpm test` and `pnpm build` pass before submitting
- Add a changeset with `pnpm changeset` for any user-facing change
- Do not commit generated `dist/` artifacts

## Code Style

- TypeScript strict mode, no `any`
- Biome for linting and formatting
- Use `import type` for type-only imports

## Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for versioning and release notes.

For any PR that changes behavior visible to SDK users, add a changeset:

```bash
pnpm changeset
```

Choose `patch` for bug fixes, `minor` for new features, `major` for breaking changes.

## Reporting Issues

Use [GitHub Issues](https://github.com/Medal-Social/MedalSocial/issues) to report bugs or request features.

## Developer Certificate of Origin (DCO)

All contributors must sign off their commits:

```bash
git commit -s -m "feat: your change"
```

This adds:

```
Signed-off-by: Your Name <your@email.com>
```

## Agent Skills (`skills/`)

`@medalsocial/sdk` ships [TanStack Intent](https://tanstack.com/intent) skills in `skills/` that travel with each published version. Consumers running `npx @tanstack/intent install` get versioned usage guidance written into their agent config (`CLAUDE.md` / `AGENTS.md`).

**If your PR changes a public surface** — a method signature, the `Medal` constructor, error shapes, base URL behavior, retry semantics, or a new resource — **update the matching `skills/<area>/SKILL.md` in the same PR.** The `Check Skills` workflow runs `intent validate` on every PR touching `skills/` and will fail if structure breaks. A separate `stale` check runs after releases and opens a single review PR when source docs drift from skills; that is a safety net, not the primary discipline.

## AI-Assisted Changes

AI assistance is allowed, but contributors are responsible for the final patch.

- Review every AI-generated change before committing
- Write or update tests for any behavior change
- Use your own commit message and PR summary
