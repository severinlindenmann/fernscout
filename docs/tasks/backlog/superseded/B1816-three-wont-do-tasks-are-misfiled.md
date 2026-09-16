---
id: B1816
title: Three wont-do tasks are misfiled against their own frontmatter lane
type: ISSUE
priority: medium
complexity: low
area: tasks, tooling
found: "2026-09-16T18:23:33Z"
superseded: Fixed on main by npm run tasks -- tidy: the three files were a hand-move committed by accident and are back in the folders their frontmatter names. If they were meant as wont-do, that is a wontDo: field and a person's reason, not a re-file.
---

# B1816 — Three wont-do tasks are misfiled against their own frontmatter lane

## Why

Found while running `npm run verify` on B1814. `test/task-ids.test.ts >
task ids > every task in a categorised lane is in the folder its
frontmatter names` fails, and fails the same way with no other change in
the tree (confirmed by stashing every B1814 edit and re-running just that
test):

```
+   "backlog/wont-do/B1317-the-sms-number-is-domestic-only.md → backlog/small-feature/",
+   "backlog/wont-do/B290-a-request-log-cannot-carry-a.md → backlog/big-feature/",
+   "backlog/wont-do/B49-a-deleted-journal-goes-at-once.md → backlog/big-feature/",
```

`npm run tasks -- new` also prints this warning unprompted on this
worktree. The three tickets (B49, B290, B1317) live in
`docs/tasks/backlog/wont-do/`, presumably moved there by the recent
triage commit (`76aa042d Triage: 13 decided against, 39 promoted to
open`), but their frontmatter (`type`/`complexity`) still categorises
them into `backlog/big-feature/` and `backlog/small-feature/` — the
category the file's own fields say it belongs in, not the folder it was
actually filed under.

Not B1814's to fix: unrelated to photobook chapters, and a `wontDo`
placement decision belongs to a person, not this branch.

## Work

Re-file the three tasks with `npm run tasks -- tidy` (or whatever the
correct fix is for a `wont-do` lane specifically, since `tidy` may only
know about backlog category folders, not `wont-do`), or teach
`task-ids.test.ts` / `tasks.mjs` that `wont-do` is a valid resting lane
regardless of frontmatter category, if that is the actual intended rule.

## Acceptance

- `npm run tasks -- new` runs clean, no misfiled warning.
- `npx vitest run test/task-ids.test.ts` passes.
