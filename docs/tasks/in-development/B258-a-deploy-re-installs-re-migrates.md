---
id: B258
title: A deploy re-installs, re-migrates and rebuilds whatever changed
type: CHORE
priority: high
complexity: medium
area: deploy
found: "2026-09-04T10:41:11Z"
started: "2026-09-04T10:41:38Z"
session: 0bf379ff-b385-4c95-8f34-00991d9db83d
claimed: "2026-09-04T10:41:38Z"
---

# B258 — A deploy re-installs, re-migrates and rebuilds whatever changed

## Why

`scripts/deploy.sh` runs the same eight steps whatever arrived. A one-word fix
to a task file and a Postgres migration cost the same: `npm ci` reinstalls the
lockfile it already has, `db:migrate` starts a `tsx` process to find nothing to
do, `install-units.sh` rewrites units nobody touched, and `check:caddy` adapts a
config that did not change.

Measured on the live host, `scripts/deploy.sh:44-91`: `node_modules` was
rewritten at 12:29 today against a `package-lock.json` last modified at 11:07 —
so the slowest step in the deploy was, that time, pure waste. It is pure waste
most times, because most deploys here are code.

What that costs is not the seconds. It is that deploying stops being something
you do while looking at the thing you just fixed, and the author's actual path —
verify four ways locally, `git push`, `ssh`, `cd`, `./scripts/deploy.sh` — is
five commands and about five minutes for a one-line change.

## Work

Make the deploy decide from the diff.

1. `scripts/deploy.sh` records the commit it last brought up healthy in
   `$APP_DIR/.deploy-state`, and diffs that against the newly pulled `HEAD` to
   choose its steps. A missing or unparseable marker means a full deploy, and
   so does a build that failed — the marker only moves after health goes green,
   so a failed deploy re-plans from the same commit rather than from the one it
   never managed to serve.
2. The classifier, as a `--plan <paths…>` mode so it is testable without a
   server:

   | Changed | Adds |
   | --- | --- |
   | `docs/`, `test/`, `scripts/`, `.claude/`, `.github/`, root `*.md`, tooling config | nothing |
   | `content/locales/`, `content/rates/` | sync, build, restart |
   | other `content/` | nothing, and says so — a deploy does not copy it |
   | `app/`, `lib/`, `components/`, `public/`, `next.config.ts`, anything unrecognised | build, restart |
   | `package.json`, `package-lock.json` | `npm ci` |
   | `lib/db/migrations/`, `lib/db/migrate.ts`, `lib/db/schema.ts` | `db:migrate` |
   | `deploy/*.service`, `*.timer` | `install-units.sh` |
   | `deploy/*.caddy`, `deploy/Caddyfile` | the Caddy report |

   Unrecognised paths build and restart rather than doing nothing: a new
   top-level directory is far more likely to be code than documentation.
3. `--full` forces every step, for when the marker is not to be trusted.
4. `test/deploy-plan.test.ts` drives `--plan` for each row above.
5. The `deploy` skill says the fast path is now the default and what it skips.

**Not** doing: the local half. Whether the author's own one-command path keeps
the four local checks is a question about that path, not about this script, and
it lives in a gitignored skill that is not the shipped software's business.

## Acceptance

```bash
scripts/deploy.sh --plan docs/tasks/INDEX.md              # → nothing to do
scripts/deploy.sh --plan lib/entries.ts                   # → build, restart
scripts/deploy.sh --plan package-lock.json                # → install, build, restart
npx vitest run test/deploy-plan.test.ts                   # 9 passed
```

## What it measured, on the live host

The old script, deploying this change: **251s**. Then, same commit, same
machine, marker moved to make each path the one under test:

| Path | Steps run | Wall clock |
| --- | --- | --- |
| docs, tasks, scripts, tests only (5 files) | none | **2s** |
| nothing pulled, marker at HEAD | none | 2s |
| code (14 files across `app/`, `lib/`, docs) | build, restart | **10s** |
| `--full` | everything | ~250s |

The code figure is a build whose turbopack cache was fully warm and whose
sources had not actually changed since the last one, so it is the floor rather
than the average — a real code change costs whatever Turbopack takes to
rebuild it, plus the ~5s restart and health poll. What it is *not* is the
`npm ci` that used to precede it every time.

The dirty-tree refusal in the author's own `ship.sh` also earned itself during
this: a sibling session dropped two half-written captures into the main
checkout mid-test, and the deploy stopped instead of reporting success about a
tree that was not the one being deployed.
