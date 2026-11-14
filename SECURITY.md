# Security Policy

## Reporting a vulnerability

Do **not** open a public issue for security problems. Use GitHub's private
vulnerability reporting (Security → Report a vulnerability) or contact
[@relativityAI](https://github.com/relativityAI) directly.

Please include: what is affected, how to reproduce, and any impact estimate.

## Scope notes

- The API stores user-supplied LLM/Voyager API keys encrypted at rest
  (AES-256-GCM via `ENCRYPTION_KEY`). Key-handling code paths
  (`services/api/crypto.ts`, `/settings` routes) are the most sensitive surface.
- `.env` files are gitignored and must never be committed. CI runs gitleaks
  secret scanning on every PR and push; commits containing secrets will fail.
- Dependency audit (`npm audit --omit=dev`, high+) runs weekly and on every PR.

## Supported versions

Releases published on the GitHub Releases page (tags `vX.Y.Z`) are supported;
older tags receive no patches.
