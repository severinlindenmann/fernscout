---
name: github
description: Read and debug this repository's GitHub Actions runs, pull requests and issues with the `gh` CLI. Use when the user says "fix the build", "CI is red", "why did the pipeline fail", "fix issue 12", "what's failing on main", "open a PR", or asks about a run, a workflow log or a GitHub issue.
---

# GitHub, from this checkout

`gh` is the whole tool. There is no wrapper script and there should not be one:
everything below is one command, and a helper that wraps `gh run view` is a
helper that is out of date the next time `gh` changes.

The remote is `severinlindenmann/fernscout`. The only workflow is
`.github/workflows/ci.yml`, called **CI**, on every push to `main` and every
pull request. Its jobs are `lint`, `unused`, `typecheck`, `test` (a matrix:
`sqlite` and `postgres`), `backup-drill`, and `build`, which needs the other
four.

## Before anything

```bash
gh auth status          # if this says not logged in, stop and ask
```

Signing in is interactive and is the person's to do, not an agent's:
`gh auth login` in their own terminal (`! gh auth login` in a session). Never
ask for a token in the conversation and never write one to a file.

## Is it red?

```bash
gh run list --limit 10                       # every recent run
gh run list --branch main --limit 5
gh run list --status failure --limit 5
gh pr checks                                 # the current branch's PR
```

## Why is it red

```bash
gh run view <id>                             # which jobs failed
gh run view <id> --log-failed                # only the failing steps' output
gh run view --job <job-id> --log             # one job, in full
```

`--log-failed` is the one to reach for first. A full `--log` of the `test` job
is tens of thousands of lines and says nothing the failing step did not.

For a run still going: `gh run watch <id>`.

## Fixing it

The fix is built the way every other change here is: a worktree, a branch,
`npm run verify`, a merge. `work-on-a-task` is the procedure. Two things are
specific to reading CI:

- **Reproduce locally before editing.** Nearly every failure here reproduces
  with the single command the job ran — `npx eslint .`, `npm run unused`,
  `npx vitest run <file>`, `npx tsc --noEmit`. If it does not reproduce, the
  difference is the environment, and that is the finding.
- **The failure is often not where it points.** `typecheck` runs `npx next
  build` before `npx tsc --noEmit` because `.next/types` does not exist
  otherwise (AGENTS.md, B100); dozens of type errors in files nobody touched
  mean the build step failed, higher up the log.

Three failures that are about CI and not about the change:

| Symptom | It is |
| --- | --- |
| `npm ci` rejects a lockfile that `npm install` calls up to date | the pinned `NODE_VERSION` in `ci.yml` ships a different npm. Regenerate the lock with that npm, or bump the pin deliberately |
| `unused` fails on a clean local `verify` | `verify` runs knip too now; run `npm run unused` |
| `backup-drill` or the Caddy step fails on a download or checksum | a pinned version moved. The pins and their reasoning are in `ci.yml` beside each one |

Anything found that is not this ticket's is a `backlog/` capture, by id.

## Issues and pull requests

```bash
gh issue list
gh issue view <n> --comments
gh pr create --fill                # after pushing a branch
gh pr view --web
```

"Fix issue 12" means: read it with `gh issue view 12 --comments`, capture it
into `docs/tasks/` with `npm run tasks -- new` if it is not there already, and
build it as a task. Do not close a GitHub issue on the person's behalf — the
same rule as `completed/`: a person decides a thing is done.
