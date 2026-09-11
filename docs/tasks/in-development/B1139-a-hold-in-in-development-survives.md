---
id: B1139
title: A hold in in-development survives the session that took it, and nothing says the work already merged
type: ISSUE
priority: medium
complexity: medium
area: tasks, tooling
found: "2026-09-09T18:33:29Z"
started: "2026-09-11T14:52:01Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T14:52:01Z"
---

# B1139 — A hold in in-development survives the session that took it, and nothing says the work already merged

## Why

On 2026-09-09 `in-development/` held fourteen tickets. Six were live. **Eight
were not, in four different ways**, and telling them apart took an hour of git
archaeology that `npm run tasks` could have done in a second:

- **B1014, B1015** already carried a `superseded:` field in their own
  frontmatter and were sitting in `in-development/` anyway. The lane and the
  frontmatter disagreed and nothing said so.
- **B1098, B984** had their work merged to `main` (`93fe9bba`, `81d02ba3`) and
  never moved. B984 was 25h stale and three later tickets — B784, B1009, B1033 —
  had already been closed *against* it.
- **B1035, B1039, B879** each had a branch with committed work, a clean
  worktree, and no session alive. B879's was two days old and 927 commits
  behind `main`.
- **B108** had no branch, no worktree and no commit at all: a three-day hold on
  work that had never started, and which was blocked behind B102 and B103 by its
  own forced order anyway.

`scripts/tasks.mjs` already has every input it needs. `heldFor(claimed)` prints
the age (`scripts/tasks.mjs:219`), and that age is the *only* signal — a 3-day
hold and a 3-minute one differ by a string in a table nobody diffs.
`refuseIfHeld` (`:312`) then refuses the ticket to the next agent and says
*"If that session is gone, take it with --force"* — which is exactly the
question the tool declines to answer.

The cost is not just the archaeology. A stale hold is **invisible work**: the
next session asking for something to pick up is told these fourteen are taken,
so four merge-ready branches sat unmerged for up to two days while the backlog
was described as having nothing free.

## Work

Give the lane table one derived column, computed rather than stored — the same
principle as the status coming from the folder.

- **The frontmatter contradicts the lane.** A ticket carrying `superseded:` or
  `wontDo:` anywhere but `backlog/` is a filing error. `npm run tasks -- tidy`
  already re-files within a lane; this is the case it does not cover.
- **The work is already on `main`.** For a ticket in `in-development/`, ask
  whether a branch matching its id is an ancestor of `main`, or whether a commit
  naming the id is. Report as *merged, not moved*.
- **The branch is done and unmerged.** A branch matching the id exists, its
  worktree is clean, and it has commits `main` does not. Report as *ready to
  merge*, with how far behind `main` it is — the number that decides whether it
  is a merge or a rescue.
- **The holder is gone.** Nothing here can prove a session is dead, and it must
  not guess. But `claimed:` older than some plain threshold, with no worktree
  and no branch, is worth saying out loud rather than printing as an age.

Not doing: moving anything automatically. Every case above is a report, and the
lane move stays a decision — `completed/` and `open/` are a person's lanes and
this must not become a way around that. Also not doing: killing or unclaiming
another session's hold. `--force` already exists and is the right escape hatch;
this only tells the person whether to use it.

## Acceptance

Reproduce the 2026-09-09 state on a scratch branch — a ticket in
`in-development/` carrying `superseded:`, one whose branch is an ancestor of
`main`, one with a clean unmerged branch, and one with no branch at all — and
`npm run tasks` names all four without any git command being typed by hand.
A live ticket with a dirty worktree and a fresh `claimed:` is not flagged, which
is the case that must not produce noise. `npm run verify` green.
