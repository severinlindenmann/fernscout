---
id: B1023
title: npm run verify fails on task-ids.test.ts: five backlog/wont-do tasks have no wontDo field and are misfiled
type: CHORE
priority: low
complexity: low
area: tasks,tooling
found: "2026-09-08T19:37:27Z"
superseded: "Already fixed. All five files sit in backlog/ops/ today and test/task-ids.test.ts passes on a clean main; somebody ran tidy between the capture and 2026-09-09."
---

# B1023 — npm run verify fails on task-ids.test.ts: five backlog/wont-do tasks have no wontDo field and are misfiled

## Why

`npm run verify` currently fails at the vitest step on `test/task-ids.test.ts
> task ids > every task in a categorised lane is in the folder its
frontmatter names`, on a checkout with no other pending changes. Five files
sit in `docs/tasks/backlog/wont-do/` whose frontmatter carries no `wontDo:`
field and `type: OPS` — which, per `AGENTS.md`'s rule that a task's folder is
derived from `type`/`complexity`/`wontDo`/`superseded`, belongs in
`backlog/ops/`, not `backlog/wont-do/`:

- `docs/tasks/backlog/wont-do/B106-push-has-never-been-switched-on.md`
- `docs/tasks/backlog/wont-do/B107-postcards-have-only-ever-run-from.md`
- `docs/tasks/backlog/wont-do/B403-the-whatsapp-channel-is-configured-but.md`
- `docs/tasks/backlog/wont-do/B437-no-postcard-has-ever-been-posted.md`
- `docs/tasks/backlog/wont-do/B911-the-print-flow-has-never-run.md`

Either they were wont-do'd and the file lost its `wontDo:` line along the
way, or they were filed by hand into the wrong folder and never `tidy`'d.
Found while running `npm run verify` for B790, in a worktree cut from `main`
with nothing else in flight.

## Work

For each of the five: read it and decide whether it truly is a wont-do (in
which case it is missing its `wontDo:` field and a person's reason — see
AGENTS.md, "`wontDo` is a person's word, not an agent's") or was simply
misfiled (in which case `npm run tasks -- tidy` moves it to `backlog/ops/`
once the folder no longer disagrees with the frontmatter). Do not add a
`wontDo:` field on judgement alone.

## Acceptance

`npm run verify`'s vitest step passes `test/task-ids.test.ts` on a clean
checkout — specifically the "every task in a categorised lane is in the
folder its frontmatter names" test reports no misfiled tasks.
