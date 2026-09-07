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
`site/config.json`, read by `lib/config.ts` — don't put personal data or
secrets in code; see `docs/plans/INDEX.md` for the ground rules the codebase
follows (feature flags default off, secrets stay in the environment, and so
on).

## Before you open a PR

Run all of these — CI runs the same checks (`npm run verify` runs them in this
order and stops at the first failure, and is the easier way to run them):

```bash
npm run build          # first — it writes .next/types, which tsc reads
npx tsc --noEmit
npx eslint .
npx vitest run
npm run unused          # knip — is anything here for nothing
```

The build goes first because Next writes the typed-route definitions in
`.next/types` while it builds, and `PageProps`, `LayoutProps` and
`RouteContext` resolve against them. Run `tsc` on a checkout that has never
been built and it reports errors in every route file, none of which are yours.

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

**You keep the copyright to your own contribution.** You are not signing it
away and not transferring it. What you do give is a licence, and there are
two halves to it:

- Everyone who receives Fernscout receives your contribution under the
  project's licence, PolyForm Shield 1.0.0 (see `LICENSE`) — the same terms
  as the rest of the code.
- **Severin Lindenmann, as the maintainer, additionally receives an
  unrestricted, perpetual, irrevocable, worldwide licence to your
  contribution, including the right to sub-licence it and to release it under
  different terms.**

The second half looks heavier than it is, and it exists for a specific
mechanical reason. The project's licence carries a non-compete clause: it
forbids using the software to provide a product that competes with
Fernscout. Without that extra grant, a contribution would reach the
maintainer under exactly that restriction — and the maintainer's own hosted
Fernscout is the product being competed with, so the project would end up
unable to ship its own contributors' code. The grant fixes that, and it is
the whole of what it is for.

What it does not do: it does not take your copyright, it does not stop you
using your own contribution anywhere else for anything, and it is not
exclusive.

If you would rather not give that grant, say so in the pull request — a
change can often be described well enough for it to be reimplemented, and
that is a fine outcome. Opening a pull request means you agree to this
section.

### License header policy

Individual source files in this repository **do not** carry a per-file
license header — the `LICENSE` file at the repository root covers the
whole codebase, and that's the single source of truth. Don't add SPDX
headers to files you touch; it just creates diff noise a root `LICENSE` file
already makes redundant.

The one exception: if you bring in a file (or a substantial part of one)
from somewhere else under a *different* license, keep that file's original
header intact and say so in the PR description. Don't silently relicense
someone else's code by dropping it into this repository.

### Name and logo

The PolyForm Shield licence covers the code. It does not cover the
**Fernscout** name or logo — see `TRADEMARK.md` before using either outside
this repository (for example, for a public fork or a hosted service).
