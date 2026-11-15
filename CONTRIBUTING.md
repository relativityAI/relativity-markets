# Contributing

## Setup

Requires Node ≥ 22.13 (`node:sqlite`).

```bash
npm install          # once, in client/ and services/
npm run dev          # from repo root: API (8080) + UI (5173)
npm test             # all tests, both packages
npm run typecheck    # TypeScript, both packages
npm run build
```

## Branches & commits

- Branches: `feat/…`, `fix/…`, `chore/…`
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) — the changelog and version bumps are generated from them:
  - `feat(scope): …` → minor bump
  - `fix(scope): …` → patch bump
  - `feat!:` or `BREAKING CHANGE:` footer → major bump
  - `chore:`, `docs:`, `refactor:` → no bump

## Pull requests

1. Branch off `main`, open a PR against `main`.
2. CI must pass: typecheck, lint, tests, build, Docker build, SQLite smoke test.
3. Squash-merge once approved.

`main` is protected: no direct pushes, no force-pushes.

## Database changes (SQLite)

The local database is a single SQLite file that survives upgrades inside the
docker volume. Any schema change must:

1. Append a `{version, sql}` entry to `MIGRATIONS` in `services/db/sqlite.ts`
   (forward-only — never edit or delete old entries) and bump `SCHEMA_VERSION`.
2. Extend `services/db/tests/sqlite-migrations.test.ts`: fresh install, upgrade
   from the previous shape, and rollback-on-failure.

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please):

1. Merging PRs to `main` accumulates commits.
2. release-please opens a **"chore: release vX.Y.Z"** PR that bumps all three
   `package.json` versions and writes `CHANGELOG.md`.
3. Merging that PR tags `vX.Y.Z`, which:
   - publishes the GitHub Release (notes + zipped client bundle),
   - pushes the Docker image to `ghcr.io/<owner>/relativity-markets:vX.Y.Z`
     (built by the `docker` workflow, multi-arch).

To deploy a release self-hosted: `docker compose pull && docker compose up -d`.

## Security

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities. Never commit
`.env` files or API keys — CI runs secret scanning on every PR.
