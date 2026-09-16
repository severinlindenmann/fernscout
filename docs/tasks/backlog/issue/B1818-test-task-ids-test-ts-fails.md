---
id: B1818
title: test/task-ids.test.ts fails after a wont-do triage move: frontmatter does not name the wont-do lane
type: ISSUE
priority: medium
complexity: low
area: tasks, testing
found: "2026-09-16T18:30:17Z"
---

# B1818 — test/task-ids.test.ts fails after a wont-do triage move: frontmatter does not name the wont-do lane

## Why

Found while running `npm run verify` on B1810 (unrelated: undefined colour
shades). `test/task-ids.test.ts` fails with "every task in a categorised lane
is in the folder its frontmatter names":

```
backlog/wont-do/B1317-the-sms-number-is-domestic-only.md → backlog/small-feature/
backlog/wont-do/B290-a-request-log-cannot-carry-a.md → backlog/big-feature/
backlog/wont-do/B49-a-deleted-journal-goes-at-once.md → backlog/big-feature/
```

The recent triage run ("Triage: 13 decided against, 39 promoted to open",
commit 76aa042d) moved these three tickets into `backlog/wont-do/`, but their
`type`/`complexity` frontmatter still categorises them into `small-feature`
or `big-feature`. The test derives the expected folder from that frontmatter
and does not know `wont-do` is a valid terminal lane, so any ticket moved
there fails the check — the test, not the ticket, is out of date with the
lane the triage skill actually uses.

Confirmed pre-existing on `main` before this session's B1810 branch touched
anything (`git status` at session start already showed these three files
moved; B1810's diff makes no task-file changes).

## Work

Either teach `test/task-ids.test.ts` that `backlog/wont-do/` is a valid
resting place regardless of `type`/`complexity` (the lane a person decided
against, not a category), or give `wont-do` tickets a frontmatter field the
test already understands. Whichever is smaller — read how `tasks tidy` and
the categorisation script decide a folder before picking.

## Acceptance

- `npx vitest run test/task-ids.test.ts` passes with the three tickets above
  (or their current equivalents) left in `backlog/wont-do/`.
- `npm run tasks -- tidy` no longer reports them as misfiled.
