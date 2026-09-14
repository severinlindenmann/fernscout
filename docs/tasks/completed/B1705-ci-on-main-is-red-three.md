---
id: B1705
title: "CI on main is red: three independent breakages in the test and backup-drill jobs"
type: ISSUE
priority: high
complexity: low
area: CI
found: "2026-09-14T07:58:50Z"
started: "2026-09-14T07:59:21Z"
merged: "2026-09-14T08:04:55Z"
completed: "2026-09-14T16:32:53Z"
---

# B1705 — CI on main is red: three independent breakages in the test and backup-drill jobs

## Why

Run 34816335275 on `main` fails in `test` (both matrix legs) and in
`backup-drill`. All three causes are CI-environment differences, not defects in
the code under test — every one of them passes on a laptop, which is why they
were merged. `build` needs those jobs, so nothing has built on `main` since
run 34777044522.

1. **`test/agent-efficiency-tools.test.ts` — shallow checkout.**
   `scripts/agent-context.mjs` discovers a task's paths partly from
   `git log --all --grep=<id> --name-only`. `actions/checkout@v4` defaults to
   `fetch-depth: 1`, so that history does not exist on the runner and the tool
   returns no paths, hence no skills. Reproduced exactly in a
   `git clone --depth 1` of this repository: `agent-context.mjs B900 --json`
   returns `"skills":[]`, and `B1665` loses `work-on-a-task`.

2. **`test/deploy-guards.test.ts` — no git identity on the runner.**
   Both failing cases build a throwaway repository with `git commit`. A GitHub
   runner has no `user.email`/`user.name` and its hostname carries no domain,
   so git cannot guess one and the commit fails silently (the test never checks
   those `spawnSync` results). The B1313 fixture is then left on an unborn
   `main` instead of a detached HEAD, and the B1311 fixture pushes nothing to
   its bare remote — so in both cases `deploy.sh` dies in `git pull` before it
   ever reaches the guard under test. `test/tasks-script.test.ts:85` already
   solved this with a `git()` helper that passes `-c user.email=… -c user.name=…`.

3. **`backup-drill` — the job names a test file that no longer exists.**
   The step runs `npx vitest run test/backup-script.test.ts`. That file was
   split into `test/backup-script-{content,database,monitoring,recovery,repository}.test.ts`,
   so vitest exits 1 with "No test files found" and the drill has not actually
   run since the split.

## Work

- `.github/workflows/ci.yml`: give the `test` job's checkout `fetch-depth: 0`,
  with a comment naming the tool that needs the history.
- `.github/workflows/ci.yml`: point the drill step at the split files.
- `test/deploy-guards.test.ts`: commit through a helper carrying an identity,
  the same way `test/tasks-script.test.ts` does.

Assertions stay as they are — each of these is CI failing to give the test what
it needs, not a test asking for too much.

## Acceptance

- `npm run verify` passes locally.
- CI on `main` is green, with `backup-drill` reporting the five backup files run
  rather than "No test files found".
