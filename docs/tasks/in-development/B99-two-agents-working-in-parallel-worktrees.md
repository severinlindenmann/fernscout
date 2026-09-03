---
id: B99
title: Two agents working in parallel worktrees are handed the same task id
type: CHORE
priority: medium
complexity: low
area: tasks, tooling, docs
found: "2026-09-03"
started: "2026-09-03"
---

# B99 — Two agents working in parallel worktrees are handed the same task id

## Why

`nextId()` (`scripts/tasks.mjs:111`) reads every task file under `docs/tasks/`
and returns one past the highest number it finds. `allItems()` reads the
**current working directory**, which inside `.claude/worktrees/<branch>` is that
worktree's own checkout — a snapshot of `docs/tasks/` taken when the branch was
created. Two sessions working at once are therefore each told the next id is the
same number, and both write it.

`manage-tasks` already explains why this matters: *"delete one and the next task
takes its number, and every reference to the old id now points at something
else."* A collision does the same damage from the other end — two files claim
one number, so `see B82` in prose no longer resolves, and `npm run tasks -- move
B82 open` picks whichever the directory listing yields first.

It is not hypothetical and not rare. As of this file, `docs/tasks/` holds:

- **B78** — `B78-how-a-leg-was-travelled-is.md` and
  `B78-one-unreadable-file-under-data-dir.md`
- **B82** — `B82-an-expired-read-grant-still-notifies.md` and
  `B82-an-unreachable-restic-repository-burns-the.md`

and two more were caught only by hand: B33's capture was allocated **B81**,
already taken on main, renumbered by its agent to **B87**, which had *also* been
taken by another session in the meantime, and was renumbered again to **B98**
when it merged. B79's agent avoided a fourth by grepping every sibling worktree
before choosing **B97**. Three collisions and one near miss in a single
afternoon of parallel work — the rate is a function of how many agents are
running, and this repository is set up to run several.

The generated `INDEX.md` records the result without complaint: two rows, same
id, different links (`docs/tasks/INDEX.md`, the B87 rows before the renumber).

## Work

Two halves, and the second is the one that lasts.

**Clean up what is on disk.** Renumber one file of each colliding pair and
follow its references. Which one moves is a judgement: prefer moving the one
that has been referenced *less* — a task already cited by name in another task's
prose, in a commit message or in a merged branch is the expensive one to
renumber. `grep -rn "B78" docs/` before choosing, and fix the prose references
in the same commit. This is not the interesting half and must not be the whole
task: doing it alone means doing it again next week.

**Stop the script handing out an id it cannot promise is free.** Options, in
rough order of preference:

- Allocate against the **main checkout's** `docs/tasks/`, not the current
  directory. `git rev-parse --git-common-dir` gives the shared `.git` from
  inside any linked worktree, and the main working tree is its parent. Still
  racy between two agents in the same second, but it removes the systematic
  case, which is the branch-time snapshot going stale.
- Have `new` **verify** rather than assume: after choosing, check the id is
  claimed nowhere across the main checkout and every `.claude/worktrees/*`, and
  die with the next free number if it is. This is what B79's agent did by hand,
  which is a decent sign it is the check the tool should make.
- Refuse to be clever and let the number be non-contiguous — take
  `max + 1` across all worktrees, so a gap appears where a branch was abandoned.
  A gap is harmless; a collision is not.

Whatever ships, `npm run tasks` should **report** a duplicate id rather than
render it silently, because the next collision will arrive some other way — a
merge, a cherry-pick, a file copied by hand.

Not doing: changing the id format, renumbering anything that is not currently
colliding, or reordering the lanes. Also not doing anything that makes ids
reusable — `manage-tasks` is explicit that task files are moved and never
deleted precisely so a number means one thing forever.

## Acceptance

- `ls docs/tasks/*/ | grep -oE "^B[0-9]+" | sort | uniq -d` prints nothing.
- Every prose reference to a renumbered id points at the file that now carries
  it: `grep -rn "B<old>" docs/` returns only intentional history.
- With a linked worktree checked out at an older commit, `npm run tasks -- new`
  run *inside that worktree* does not produce an id that already exists in the
  main checkout — demonstrated, not argued.
- `npm run tasks` says something visible when two files share an id.
- `npx vitest run` still passes; the script has no types to check but
  `npx eslint .` covers it.
