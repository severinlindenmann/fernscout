---
id: B1483
title: A dispatched agent works in a worktree but its working directory is the shared checkout, so anything reading the current diff reads the wrong one
type: DOCS
priority: medium
complexity: low
area: skills, worktrees
found: "2026-09-11T16:01:18Z"
---

# B1483 — A dispatched agent works in a worktree but its working directory is the shared checkout, so anything reading the current diff reads the wrong one

## Why

Reported by a build agent on 2026-09-11, which noticed it rather than being
caught by it — it ran the security review over its own change, saw the output
describe files it had never touched, and reviewed its six-file diff by hand
instead. A less careful agent would have reported a clean security review of
somebody else's working tree.

**The cause is not the plugin.** `security-guidance/hooks/gitutil.py` is
explicitly worktree-aware — *"Handles worktrees where .git is a file pointing to
the main repo's gitdir"*. The cause is in AGENTS.md already, one sentence away
from where it matters:

> A dispatched subagent cannot use `EnterWorktree` — the tool's guard is about
> the session's own working directory, and a subagent inherits its parent's. It
> works with absolute paths instead.

So the pattern this repository uses for every build — parent creates the
worktree, hands the subagent an absolute path — leaves the subagent's **working
directory pointing at the shared checkout**. Absolute paths make the *editing*
correct. Anything that implicitly asks "what has changed here?" still answers
about `main`:

- a security review over the current diff
- `git status` / `git diff` with no `-C`
- a linter or a test runner invoked with no path
- any tool that resolves the repository from the process's cwd

The shared checkout is rarely empty — other sessions' task-file commits, a
half-finished merge, another agent's worktree changes — so the wrong answer is
usually plausible rather than obviously absent, which is what makes it
dangerous.

## Work

Say it where a dispatching agent and a dispatched one will each read it:

- `work-on-a-task`, beside the note that a subagent uses absolute paths: its cwd
  is **not** the worktree, so any command that reads "the current repository"
  must be given the worktree explicitly — `git -C <worktree>`, an explicit path
  argument, or a `cd` inside the same shell call.
- `run-a-batch`'s dispatch step, as something the orchestrator tells each agent.
- Consider whether the dispatch prompts should simply instruct the agent to
  `cd` into its worktree as its first action. Weigh it rather than assuming:
  it fixes the whole class at once, and it makes an accidental relative-path
  write land in the worktree rather than being refused by the hook — which is
  either a feature or a lost safety net depending on which failure you fear
  more.

Related: **B1462** (agents strand themselves on a background verify) is the same
shape — a harness fact that every dispatch has to restate by hand because no
skill carries it.

## Acceptance

- An agent following `work-on-a-task` in a dispatched worktree knows its cwd is
  the shared checkout without being told separately.
- A security review or a diff-reading tool run by such an agent reports on the
  worktree's own changes.
