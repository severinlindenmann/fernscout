---
id: B201
title: The shared main checkout can be left on a detached HEAD, stranding every session's commits
type: ISSUE
priority: high
complexity: medium
area: tasks, git, agents
found: "2026-09-03T20:03:00Z"
started: "2026-09-04T07:43:09Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T07:43:09Z"
---

# B201 — The shared main checkout can be left on a detached HEAD, stranding every session's commits

## Why

Found on 2026-09-03 while merging B60. `git worktree list` reported:

```
/Users/severin/Documents/GitHub/fernscout   50b8029 (detached HEAD)
```

The `main` **branch ref** was still at `a760c74`. Eighteen commits sat between
them — six merges and a dozen lane moves, belonging to at least four sessions:
B60, B142, B159, B180, B181, and task-file state from sessions that never
appeared in this one. `git log --oneline HEAD..main` was empty, so nothing was
lost and `git branch -f main HEAD` was a clean fast-forward. That is luck, not
design.

**What made it dangerous is that nothing announces it.** Every command an agent
runs in the main checkout keeps working while detached — `git merge`, `git
commit`, `npm run tasks`, all of it. The commits are real and reachable from
`HEAD`. They are simply on no branch. The next session to run `git checkout
main`, or any reset, silently rewinds the shared checkout to `a760c74` and the
eighteen commits are reachable only through the reflog — which is per-checkout,
expires, and is the last place anybody looks.

`AGENTS.md` already says *"The main checkout stays on `main`"*, and every skill
assumes it. Nothing enforces or checks it, and the failure is invisible until
somebody happens to read a `git worktree list` for another reason. I only saw
it because I ran that command to confirm my worktrees were cleaned up.

How it got detached is not established. No session in this conversation ran a
checkout of a sha. Candidates worth ruling out before designing a fix: a
`git worktree remove` racing another session's operation, an interrupted
`git checkout`, or a tool that resolves a ref and checks out the sha.

## Work

- **Detect it, loudly.** `npm run tasks` already runs in the main checkout on
  almost every lane move, and already prints a warning block for duplicate ids
  (B99). The same place can say `WARNING: this checkout is on a detached HEAD;
  <n> commits are on no branch` and print the one-line recovery. Cheap, and it
  lands in front of the agent that is about to make it worse.
- **Establish the cause** before adding anything that re-attaches automatically.
  A script that "helpfully" runs `git checkout main` at the wrong moment during
  another session's merge is a worse failure than the one it fixes.
- Say it in `AGENTS.md` and in `work-on-a-task`: verify with
  `git rev-parse --abbrev-ref HEAD` before merging, and the recovery is
  `git branch -f main HEAD && git checkout main` **only** when
  `git merge-base --is-ancestor main HEAD` holds. If it does not, the branch
  has diverged and that is a person's problem, not a command's.

**Not doing:** no hook that rewrites refs on its own. Related to B143 and B144,
which are the other two things this repository's parallel running has broken.

## Acceptance

- `npm run tasks` in a detached main checkout prints a warning naming the
  number of stranded commits and the recovery command; in an attached one it
  prints nothing new.
- A test drives the detached case against a temporary checkout, the way
  `test/tasks-script.test.ts` drives id allocation.
- `AGENTS.md` and `work-on-a-task` state the check and the guarded recovery.
