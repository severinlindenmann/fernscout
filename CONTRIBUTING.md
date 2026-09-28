# Contributing to Fernscout

Fernscout is a self-hostable travel journal: JSON documents and photographs
as the source of truth, a Next.js app on top. Contributions are welcome —
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

After creating a linked worktree, run `npm run worktree:bootstrap` inside it.
On APFS this validates and copy-on-write clones the shared checkout's install;
elsewhere it uses `npm ci --prefer-offline`. If its lockfile later changes,
rerun it with `-- --refresh`.

The repo ships with a demo journal at `/@example`, committed under
`content/example/`, so the app works end to end with no real trip data. Real
configuration lives in `site/config.json`, read by `lib/config.ts` — don't
put personal data or secrets in code; see [AGENTS.md](AGENTS.md) for the
ground rules the codebase follows (feature flags default off, secrets stay
in the environment, and so on).

## Working with an agent

Start the agent in this checkout. [AGENTS.md](AGENTS.md) is the shared
instruction file; [CLAUDE.md](CLAUDE.md) imports it for Claude Code. Read the
complete file from disk — it is short by design, but still worth reading in
full rather than trusting an automatic summary.

No global install, Claude account, or personal plugin configuration is needed
to follow it. If your agent supports repository skills and one seems to
apply to your task, use it; a fresh clone of this repository alone has no
skills of its own to discover.

Codex's [skill discovery documentation](https://learn.chatgpt.com/docs/build-skills)
describes `.agents/skills/` and symlink support; its
[instruction documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
describes the default 32 KiB limit. Repository instructions make files
available each session; they cannot force a harness to load or obey them.

## Before you open a PR

Run all of these — CI runs the same five checks, as separate parallel jobs
rather than one sequential gate (`npm run verify` runs them locally in this
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
`npm run verify -- --quick` skips that build only when a checked stamp proves
the route inputs and generated types still match its last successful build.

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

## Licence and copyright

**You keep the copyright to your own contribution.** You are not signing it
away and not transferring it. Opening a pull request against this repository
means you agree it is licensed under the project's licence, Apache License
2.0 (see `LICENSE`) — the same terms as the rest of the code, inbound the
same as outbound. No separate contributor agreement, sign-off line, or CLA
is required.

Apache-2.0 has no non-compete clause, so the extra maintainer-only
relicensing grant the previous PolyForm-Shield-era version of this section
required no longer serves a purpose and is dropped: Apache-2.0 already lets
the maintainer (and everyone else, including a contributor) do anything with
a contribution that this project's own licence permits, with nothing further
to grant around.

`importers/` contributions are MIT, matching that directory's own carve-out
(`importers/LICENSE`).

### Licence header policy

Individual source files in this repository **do not** carry a per-file
licence header — the `LICENSE` file at the repository root covers the
whole codebase, and that's the single source of truth. Don't add SPDX
headers to files you touch; it just creates diff noise a root `LICENSE` file
already makes redundant.

The one exception: if you bring in a file (or a substantial part of one)
from somewhere else under a *different* licence, keep that file's original
header intact and say so in the PR description. Don't silently relicense
someone else's code by dropping it into this repository.

### Name and logo

The Apache-2.0 licence covers the code. It does not cover the **Fernscout**
name or logo — Apache-2.0 explicitly withholds any trademark licence (§6) —
see `BRAND-LICENSE` for exactly which files that covers and `TRADEMARK.md`
for the policy, before using either outside this repository (for example,
for a public fork or a hosted service).
