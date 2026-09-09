---
id: B1110
title: The testing lane is filed into nine category folders nobody reads, now that the run report is what a person reviews from
type: CHORE
priority: medium
complexity: low
area: tasks
found: "2026-09-09T16:48:22Z"
---

# B1110 — The testing lane is filed into nine category folders nobody reads, now that the run report is what a person reviews from

## Why

`testing/` was filed into nine category folders — `security/`, `issue/`,
`big-feature/`, `small-feature/`, `chore/`, `ops/`, `docs-and-skills/`,
`superseded/`, `wont-do/` — for the same reason `backlog/` is: a flat
directory of a hundred and twenty is one nobody reads to the bottom of.

That reasoning no longer holds for this lane. The lane has just been emptied
of 284 tickets in one instruction, and what a person now reviews from is the
run report — one page, grouped by where a person meets the change, with the
before and after beside each row. Nobody opens `testing/security/` to decide
what to accept. The folders survive as a place a lane move has to compute a
destination for, a shape `test/task-ids.test.ts` has to assert, and a
sentence in three documents.

`backlog/` keeps its categories. It is the lane nobody has read yet, and it
is where the argument was always true.

## Work

- `scripts/tasks.mjs`: drop `testing` from `CATEGORISED`, so a move into the
  lane lands the file flat, and `tidy` re-files an existing categorised tree
  back up one level.
- `test/task-ids.test.ts`: the assertion that a file sits where its
  frontmatter puts it must follow.
- The prose in three places: `AGENTS.md` (Tasks — "The two lanes that
  accumulate are filed into category folders"), `.claude/skills/manage-tasks`,
  and `.claude/skills/triage-a-backlog`'s step 1 table, which offers
  `testing/` "(all categories)".
- Remove the now-empty category directories under `docs/tasks/testing/`.

Not doing: anything to `backlog/`'s categories, or to the lanes themselves.

## Acceptance

- `npm run tasks -- move <id> testing` puts the file at
  `docs/tasks/testing/<id>-<slug>.md` and nowhere deeper.
- `npm run tasks -- tidy` on a tree with a categorised `testing/` flattens it.
- `npm run verify` passes, including `test/task-ids.test.ts`.
- No document still says `testing/` is filed by category.
