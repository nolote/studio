# Contributing to Studio

Thanks for your interest in contributing!

## Development setup

### Prerequisites

- Node.js (recommended: >= 20)
- pnpm

### Install

```bash
pnpm install
```

### Run the desktop app

```bash
pnpm dev:studio
```

### Useful commands

From the repo root:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format
```

## Repository conventions

- This repo is a monorepo with `apps/*` and `packages/*`.
- Keep core product logic inside `apps/<name>/src` and `packages/<name>/src`.
- Prefer small, capability-oriented folders (feature-first) inside `src/`.

## Pull requests

- Keep PRs focused and reasonably small.
- If you change behavior, add/adjust tests when practical.
- Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before submitting.
- Describe the “why” in the PR description.

## Reporting issues

- For bugs and feature requests, open an issue with clear reproduction steps.
- For security concerns, please follow [SECURITY.md](SECURITY.md) instead of filing a public issue.

## Code of Conduct

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
