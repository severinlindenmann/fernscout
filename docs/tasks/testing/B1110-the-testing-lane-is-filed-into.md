---
id: B1110
title: The testing lane is filed into nine category folders nobody reads, now that the run report is what a person reviews from
type: CHORE
priority: medium
complexity: low
area: tasks
found: "2026-09-09T16:48:22Z"
started: "2026-09-09T16:53:34Z"
merged: "2026-09-09T17:06:14Z"
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

## Notes

Validity not re-checked before starting: the owner asked for this directly,
and `testing/` was emptied of 284 tickets in this same session, so the
premise ("nobody browses `testing/<category>/` any more") was already
established rather than assumed.

`tidy()` and `warnMisfiled()` previously only ever walked
`LANES.filter(CATEGORISED.has)`, so once `testing` left `CATEGORISED` a
categorised leftover in `testing/security/` etc. would have been invisible to
both — `tidy` would have skipped it, and the warning would never have fired.
Rewrote both to walk every lane and derive the target from `item.category`
(present only for `backlog`), so an uncategorised lane's target is just its
own root. `itemsIn()` already read nested files everywhere regardless of
`CATEGORISED`, so no change was needed there, and duplicate-id detection in
`test/tasks-script.test.ts` (`testing/issue/B01-…`) still passes untouched
for the same reason.

Found one categorised leftover in the tree — `B1105` at
`testing/security/B1105-…md` — and ran `npm run tasks -- tidy` for real,
flattening it to `testing/B1105-…md`. The eight other category directories
under `testing/` were already empty (git does not track empty directories,
so nothing else needed deleting there).

Also fixed prose that named `testing/`'s categories beyond the three files
listed in Work, found by grepping the repo: `.claude/skills/test-the-live-site/SKILL.md`
(described the lane as filed into `security/`, `issue/`, `docs-and-skills/`
"and the rest") and `.claude/skills/work-on-a-task/SKILL.md` (said `type:`/
`complexity:` "decide the category folder in `backlog/` and `testing/`").
`docs/tasks/INDEX.md` still shows a `testing/security` heading — it is
generated, `AGENTS.md` says never hand-edit it, and it is a linked worktree
so `npm run tasks -- index` refuses to write it here; it will re-render flat
once `npm run tasks -- index` runs in the main checkout after merge.
`docs/plans/2026-09-04-remove-mcp.md` also mentions testing categories but is
untouched intent-as-written, per AGENTS.md.

`npm run verify` passed clean: build, tsc, eslint, 470 test files / 6331
tests (including `test/task-ids.test.ts` and `test/tasks-script.test.ts`),
and knip — no B1106 locale flake hit.

No new backlog captures — nothing found outside this ticket's scope.
