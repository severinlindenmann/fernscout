---
id: B143
title: Task ids collide when parallel sessions capture by hand, which is what B99 was meant to prevent
type: DOCS
priority: medium
complexity: medium
area: tasks, tooling, worktrees
found: "2026-09-03"
started: "2026-09-04T07:43:08Z"
merged: "2026-09-04T08:11:42Z"
---

# B143 — Task ids collide when parallel sessions capture by hand

## Why

Observed on 2026-09-03, running five tasks at once in five worktrees. **Four
of the five agents captured a new problem, and all four called it B130.** A
sixth session, working in parallel on B119, allocated B131–B133 and then B135
in the same window, so the collision was not only within one fan-out.

The renumbering that followed — B130 kept, then B134, B135, B139, B140 handed
out by the parent session as each branch merged — was four separate edits, each
touching a capture file *and* the prose reference to it in the task that raised
it. Every one of those is a chance to leave a dangling id, which is the one
thing `AGENTS.md` says must never happen: "the id is the only way tasks refer
to each other, so it means one thing forever".

B99 fixed the half of this that is about *checkouts*: `nextId()` allocates
against every worktree rather than the one you are standing in, so two agents
running `npm run tasks -- new` cannot be handed the same number. That fix
holds and is not in question.

What it does not cover is that **`npm run tasks -- new` is not the only way a
capture gets written.** An agent building in a worktree, told to record a
second problem without absorbing it, writes the markdown file directly — the
frontmatter is six fields and the shape is obvious from any neighbour. Nothing
in that path consults `nextId()`, so nothing is reserved and every agent
reading the same `main` picks the same next number. The more parallel the work,
the more certain the collision: four agents branched from one commit will agree
on the answer every time.

There is a second, quieter version of the same gap. `nextId()` scans checkouts
that *exist*. A capture committed on a branch whose worktree has since been
removed, or one merged while another session held an older `main`, is invisible
to a scan of the filesystem at that moment. The 2026-09-03 run only avoided
this because the parent session merged serially and checked `uniq -d` each time.

### Checked against the record, 2026-09-04

The git history of `docs/tasks/backlog/` for 2026-09-03 and 2026-09-04 settles
which half of this was actually happening, and the answer is exactly the half
this ticket claims.

**Four ids were issued twice**, all of them repaired by renaming afterwards:

| id | the two claimants | repaired in |
| --- | --- | --- |
| B182 | the unbounded-fallback capture, and a journal's features | `aee6959` → B195 |
| B185 | the restore drill, and a locale cookie | `2821437` → B197 |
| B186 | the README links, and the trip gate's doc comment | `2821437` → B198 |
| B197 | the restore drill again, and an unreadable content root | `a034f64` → B200 |

**Every one of them was hand-written, and none came from the script.** The
tell is the `found:` stamp: `now()` writes a whole instant to the second, and
all eight of the colliding files carry either a bare date (`found:
"2026-09-03"`) or an instant with a round `:00` in the seconds field
(`19:58:00`, `20:05:00`, `20:06:00`) — a time a person types, not one a clock
produces.

Against that, **twenty-three captures did go through `npm run tasks -- new`**
(B205–B222 and others, `found:` stamps like `06:14:14Z`, `07:29:26Z`), from at
least six different worktrees merging as groups G01 through G10 plus the main
checkout, interleaved across the same two hours. **Not one of them collided.**
Two pairs share an exact second — B207/B208 at `06:14:14Z`, B211/B212 at
`06:15:57Z` — and still got distinct ids, because the first file was on disk
before the second call scanned.

So: **B99's fix holds, and holds under real parallel load.** The risk is
entirely in the bypass path, which is what this ticket says. One correction to
the Why, though, and it matters for the design: the reason agents hand-wrote
files was not that `npm run tasks -- new` is unavailable from a worktree — it
works there — but that running it *rewrote `INDEX.md`*, and a regenerated index
from a stale snapshot conflicts on merge. It did, on all ten merges of
2026-09-04. That is a fixable objection rather than a reason to write files by
hand, and fixing it is what makes the sanctioned path usable.

The one gap the record does *not* show, because it was never exercised
concurrently enough, is the same-second race between two `new` processes: both
scan, both conclude the same number is free, and their captures have different
titles and so different filenames, so nothing on disk collides and nothing
complains. That is real, reproducible in a test, and now closed.

Two costs, and the second is the one that lasts:

- **The renumbering itself.** Mechanical, but it edits prose in a second file,
  and `sed`'s `\b` is silently a no-op on BSD — one reference survived the
  first attempt and was only caught by grepping for it.
- **A collision that is not noticed is permanent.** Two files claiming B130
  merge cleanly, because they have different filenames. Nothing in the
  repository fails. `npm run tasks` renders both rows happily. The duplicate is
  found by a person reading the index, or never.

## Work

The goal is that an id is unique by construction, not by the parent session
checking `uniq -d` after every merge.

- **Make the collision loud.** A check that fails when two task files carry the
  same `id:` — in `npm run tasks` and in the test suite, so it cannot merge.
  This is the cheapest piece and worth doing whatever else is decided; it turns
  a silent permanent duplicate into a red build.
- Then decide how ids get allocated when the capture is hand-written, which is
  the real question. Candidates, and none is obviously right:
  - Make `npm run tasks -- new` usable from a worktree for *capture* — it is
    already the sanctioned path, and the objection to agents running it mid-task
    is that it rewrites the generated tables in `INDEX.md` and so conflicts.
    Splitting "allocate an id and write the file" from "regenerate the index"
    would remove that objection entirely.
  - Or give a worktree a reserved block, allocated when the worktree is created.
  - Or stop requiring the id to be chosen at capture time: write the file with
    a placeholder and have the merge assign it.
- Whichever: `AGENTS.md` and `manage-tasks` currently tell an agent to capture
  into `backlog/` without saying how the id is chosen, and `work-on-a-task`
  repeats it. That silence is what left four agents to guess. Say it.

**Not doing:** revisiting B99. Its fix is correct and this builds on it rather
than replacing it.

## What was built

- **`reserveId()`** in `scripts/tasks.mjs`. `nextId()` as before, then an
  exclusive create (`flag: "wx"`) of a marker under
  `<git-common-dir>/fernscout-task-ids/<id>`. The shared git directory is the
  one place every worktree and the main checkout all see. The loser of a race
  gets `EEXIST`, asks again, and by then the winner's reservation is in
  `claimedIds()` — so the second answer is a different number. Reservations are
  never cleaned up: a stale one only pushes the next id higher, and `nextId()`
  is already explicit that a gap is harmless where a reused id is not. It also
  covers the quieter case in the Why — an id claimed on a branch whose worktree
  has since been removed is invisible to a filesystem scan, but its reservation
  is not.
- **`writeIndex()` does nothing in a linked worktree** unless `--index` says
  otherwise, and says why. This is the change that makes `new` safe to run from
  a worktree, which was the whole objection. See B201 for the merge evidence.
- **`test/task-ids.test.ts`** — the check that turns a duplicate into a red
  build rather than something a person finds by reading the index. Three
  assertions over the real lane folders: no id claimed by two files; every
  filename matching the `id:` in its own frontmatter; no prose reference to an
  id that does not exist. It runs in `npx vitest run` and in CI, which is to
  say before a merge can land.
- Two of those three were already violated. `B154` and `B155` referred to
  `B9`, which is not how the script spells `B09` — the dangling-reference half
  of exactly the renumbering damage this ticket is about. Both corrected. The
  check matches `B\d{2,3}` only, because the roadmap has a numbering of its own
  that overlaps at one digit (`docs/plans/W20-tracking.md` cites "F1–F4, E4, E6,
  B7", and B06 quotes that line).
- **`AGENTS.md`, `manage-tasks` and `work-on-a-task` all now name the path**:
  take the id from `npm run tasks -- new`, from inside your worktree, and never
  by reading the folder and adding one.

## Acceptance

- Two task files carrying the same `id:` fail a check that runs before a merge
  can land — demonstrated by adding a duplicate and watching it go red.
- An agent capturing a second problem from inside a worktree has a documented
  way to obtain an id that no sibling session can also be given, and
  `AGENTS.md`, `manage-tasks` and `work-on-a-task` all name it.
- Four simultaneous captures from four worktrees branched off one commit
  produce four distinct ids, with no renumbering afterwards.
