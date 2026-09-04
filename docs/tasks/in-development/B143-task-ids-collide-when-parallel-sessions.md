---
id: B143
title: Task ids collide when parallel sessions capture by hand, which is what B99 was meant to prevent
type: ISSUE
priority: medium
complexity: medium
area: tasks, tooling, worktrees
found: "2026-09-03"
started: "2026-09-04T07:43:08Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T07:43:08Z"
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

## Acceptance

- Two task files carrying the same `id:` fail a check that runs before a merge
  can land — demonstrated by adding a duplicate and watching it go red.
- An agent capturing a second problem from inside a worktree has a documented
  way to obtain an id that no sibling session can also be given, and
  `AGENTS.md`, `manage-tasks` and `work-on-a-task` all name it.
- Four simultaneous captures from four worktrees branched off one commit
  produce four distinct ids, with no renumbering afterwards.
