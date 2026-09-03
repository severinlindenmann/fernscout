---
id: B99
title: Two agents working in parallel worktrees are handed the same task id
type: CHORE
priority: medium
complexity: low
area: tasks, tooling, docs
found: "2026-09-03"
started: "2026-09-03"
merged: "2026-09-03"
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

## What was built

The third option, with the second folded into it, and the first turned out to
be the weakest of the three once the code was open.

`taskRoots()` (`scripts/tasks.mjs`) collects every `docs/tasks` an id could
already be claimed in: this checkout, plus every path `git worktree list
--porcelain` reports, plus every directory sitting under each of those
checkouts' `.claude/worktrees/` — which catches a worktree git no longer knows
about, or one copied there by hand. `claimedIds()` reads the ids off the
**filenames** across that set, because parsing the frontmatter of a thousand
files in five checkouts on every `new` is not a cost worth paying; the local
checkout is still read properly through `allItems()`, so its own frontmatter
stays authoritative for its own ids. `nextId()` is then `max + 1` over the lot.

Aiming at the main checkout alone (the first option) is not enough, and the
reason is the one this task's own Why already records: B79's agent avoided a
fourth collision by grepping *every sibling worktree* before choosing B97, not
by consulting main. A capture that has been written in another worktree and not
yet merged is invisible to main, so main is a floor on what is taken and never
a ceiling. Reading every checkout costs one `git worktree list` and a handful
of `readdir`s, which is cheap enough that there is no reason to accept the
narrower answer.

(At the time of writing, main happens to be *ahead* of both live worktrees —
B113 against B110. That is luck, not a property: it is the state that holds
right up until the next agent captures something.)

`create()` also refuses to overwrite an existing file rather than assuming
`nextId()` was right, which is the only part of this that still covers two
`new` calls inside the same second.

`warnDuplicates()` runs at the end of `list()` and `writeIndex()` — so `npm run
tasks` and every `new`/`move` say it — and prints each id claimed twice with
both paths. It reads this checkout only: a duplicate is fixed where it lives,
and the two worktrees a collision spans are usually not both yours.

**The two collisions on disk were cleaned up by renumbering the less-referenced
file of each pair**, which is what the paragraph above asks for:

- **B78** — `one-unreadable-file-under-data-dir` → **B114**. The other B78
  (transport styling) is merged, named in commit `6a069f6`, referenced from
  B88 and from a comment in `test/transport-style.test.ts`; this one had a
  single reference, in B64.
- **B82** — `an-unreachable-restic-repository-burns-the` → **B115**. The other
  B82 (expired read grant still notifies) is referenced from B68 and three
  times from B106; this one had a single reference, in B63.

Both renumbered files carry a note saying where they came from, so an old
reference in a commit message still leads somewhere. B64 and B63 were
repointed in the same commit.

`test/tasks-script.test.ts` is new and covers all of it: the on-disk sweep, the
git-worktree case (a temp repository with a linked worktree whose `docs/tasks`
is deliberately stale), and the duplicate warning. Three of its five tests fail
against the previous script and pass against this one, which is the only
version of that claim worth making.

**Noticed, not absorbed:** the verification order in `AGENTS.md` runs
`npx tsc --noEmit` before `npm run build`, and on a fresh checkout tsc then
fails on `RouteContext` and `LayoutProps` — types Next.js only writes during a
build. It is already captured as **B100**; hit here for real, on a worktree
with no `node_modules` yet.

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
