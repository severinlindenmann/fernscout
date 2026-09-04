---
id: B201
title: The shared main checkout can be left on a detached HEAD, stranding every session's commits
type: DOCS
priority: high
complexity: medium
area: tasks, git, agents
found: "2026-09-03T20:03:00Z"
started: "2026-09-04T07:43:09Z"
merged: "2026-09-04T08:11:42Z"
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

### What 2026-09-04 added, and what it changed about the shape of this

A factory of parallel agents ran eleven groups through this repository on the
morning of 2026-09-04, merging each branch serially from the shared checkout.
The detached HEAD did not recur. **Two other failures of the same kind did, and
both are the point of this ticket rather than a footnote to it: the shared
checkout is a contended resource with no protocol.**

- **Another session's uncommitted task files stopped a merge before it
  started**, twice: `Your local changes to the following files would be
  overwritten by merge`. Nothing had gone wrong — the files were lane moves,
  which `AGENTS.md` correctly says commit straight to `main` without a branch.
  They had simply not been committed yet, and the next agent to arrive could
  not proceed. `git status --short` before merging would have shown it; nothing
  told anybody to look.
- **`docs/tasks/INDEX.md` conflicted on every single merge — ten of them.**
  Nothing else conflicted at all. It is a *generated* file: `npm run tasks`
  rewrites the block between the markers from the lane folders, so every branch
  regenerated it from that branch's snapshot of `docs/tasks/`, and every merge
  had two rewritten blocks to reconcile.

The second one is worth being precise about, because the obvious fixes are
wrong:

- **`merge=union` in `.gitattributes`** turns a loud conflict into a silently
  wrong file — both sides' rows concatenated, duplicated, and nobody prompted
  to regenerate. Worse than the conflict.
- **`merge=ours`** needs a driver configured per clone (`git config
  merge.ours.driver true`), which a fresh checkout does not have, so it fails
  open and differently on different machines.
- **Not committing it** is a real option and a person's call; the file is
  browsable on GitHub, which is why it is tracked.

The fix taken instead is narrower and needs no git configuration: **a worktree
does not regenerate it.** The block is a rendering of the lane folders, and a
worktree's folders are a snapshot from when its branch was cut — so what it
writes there is both stale and the thing that collides. `npm run tasks` run in
a linked worktree now says so and leaves the file alone; `npm run tasks --
index` in the main checkout after merging is what puts it right. That also
removes the only objection to running `npm run tasks -- new` from a worktree,
which is B143's whole subject.

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
- A checkout halfway through a merge, rebase or cherry-pick says so.
- `INDEX.md` is not regenerated from a linked worktree, so it stops being the
  file that conflicts on every merge.

## What was built

`scripts/tasks.mjs`, said once after whatever was asked for, on stderr:

- `warnDetached()` — reads `git worktree list --porcelain` and reports **any**
  checkout with no `branch` line, by path, with `git rev-list --count
  main..<head>` as the number of stranded commits. Said from every checkout
  about every checkout, deliberately: the agent who needs to know the shared
  one has come off `main` is the one in a worktree about to merge into it.
  The recovery is printed only when `git merge-base --is-ancestor main HEAD`
  holds; when it does not, it says the branch has diverged and stops.
- `warnUnfinished()` — `MERGE_HEAD`, `rebase-merge`, `rebase-apply`,
  `CHERRY_PICK_HEAD`, `REVERT_HEAD` under `git rev-parse --git-path`, for this
  checkout only. A sibling worktree mid-rebase is its own session's business.
- `writeIndex({ force })` — skipped in a linked worktree, with the reason and
  the command that fixes it. `--index` and the `index` command override.

Five tests in `test/tasks-script.test.ts` (`describe("checkout state")` and
`describe("INDEX.md")`), each driving a throwaway git repository under
`os.tmpdir()`: stranded-commit count, the diverged case refusing to suggest a
recovery, a detached main seen from a worktree that is itself on a branch, a
conflicted merge in progress, and silence when everything is in order. All five
fail against the previous `scripts/tasks.mjs` and pass against this one.

`AGENTS.md` "Where the work happens" and `work-on-a-task` step 6 both carry the
check, the guarded recovery, and what to do about another session's uncommitted
task files (commit them — they are task files, and that is where they go).
