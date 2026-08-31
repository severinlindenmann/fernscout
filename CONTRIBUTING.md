# Contributing to Fernscout

Fernscout is a self-hostable travel journal: markdown entries and media as
the source of truth, a Next.js app on top. Contributions are welcome —
this file covers the practical parts.

## Getting started

```bash
nvm use          # or otherwise match .nvmrc
npm install
npm run dev
```

Use the Node version in `.nvmrc`; CI pins the same one. It is not cosmetic —
npm versions disagree about which transitive optional/wasm packages belong in
`package-lock.json`, so an `npm install` on a different Node writes a lockfile
that your machine accepts and CI rejects with `Missing: ... from lock file`.
If you bump `.nvmrc`, bump `NODE_VERSION` in `.github/workflows/ci.yml` too and
regenerate the lockfile with the matching npm.

The repo ships with a demo journal at `/example`, rebuilt with
`npm run demo:build`, so the app works end to end with no real trip data. Real configuration lives in
`content/config.json`, read by `lib/config.ts` — don't put personal data or
secrets in code; see `docs/plans/INDEX.md` for the ground rules the codebase
follows (feature flags default off, secrets stay in the environment, and so
on).

## Before you open a PR

Run all four of these — CI runs the same checks:

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build
```

A PR that fails any of these won't be merged as-is. If a check is failing
for a reason unrelated to your change, say so in the PR description rather
than silently working around it.

## What a good PR looks like

- Focused: one change, one PR. Large refactors are easier to review split up.
- Explains *why*, not just *what*, in the description — the diff already
  shows what changed.
- Includes or updates tests for behaviour changes.
- Leaves `README.md` and any other docs it touches accurate.

## Filing issues

Use the issue templates under `.github/ISSUE_TEMPLATE/` — bug reports and
feature requests ask for different information. If neither fits (a
question, a security report), open a blank issue and explain.

**Security issues:** please don't open a public issue for a vulnerability.
Use GitHub's private advisory form, linked from the "New issue" page.

## License and copyright

By contributing, you agree your contribution is licensed under the
project's license, AGPL-3.0-or-later (see `LICENSE`). You keep copyright to
your own contribution; you're not signing it away or handing over any
other rights.

### License header policy

Individual source files in this repository **do not** carry a per-file
license header — the `LICENSE` file at the repository root covers the
whole codebase under AGPL-3.0-or-later, and that's the single source of
truth. Don't add SPDX headers to files you touch; it just creates diff
noise a root `LICENSE` file already makes redundant.

The one exception: if you bring in a file (or a substantial part of one)
from somewhere else under a *different* license, keep that file's original
header intact and say so in the PR description. Don't silently relicense
someone else's code by dropping it into this repository.

### Name and logo

The AGPL-3.0 license covers the code. It does not cover the **Fernscout**
name or logo — see `TRADEMARK.md` before using either outside this
repository (for example, for a public fork or a hosted service).
