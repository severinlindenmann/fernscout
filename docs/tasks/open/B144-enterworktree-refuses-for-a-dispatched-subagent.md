---
id: B144
title: EnterWorktree refuses for a dispatched subagent, so work-on-a-task's second step cannot be followed
type: ISSUE
priority: medium
complexity: low
area: skills, agents, worktrees
found: "2026-09-03"
---

# B144 — EnterWorktree refuses for a dispatched subagent

## Why

`work-on-a-task` step 2 tells an agent, in as many words, to enter its worktree
with the `EnterWorktree` tool and explains why the `path` form rather than
`name`: it "keeps the branch based on your local HEAD, which is where the
lane-move commit lives". It even anticipates the tool's own reluctance —
"project instructions directing worktree use is exactly the condition that tool
asks for, so this is a legitimate call".

On 2026-09-03, five agents were dispatched to build five tasks, each handed a
worktree created for it by the parent session. **Every one of them was refused**,
with the same message:

```
the current working directory is the repository root, not an isolated worktree
— switching is only available to sessions whose working directory is inside a
worktree
```

A dispatched subagent inherits the parent's working directory, which is the
main checkout. The tool's guard is about the *session's* cwd, not about whether
the target is a legitimate worktree of this repository — so the one class of
agent the instruction is written for is the one class that cannot follow it.

All five worked around it identically, by using absolute paths under their
worktree for every read and write, and all five reported the main checkout was
never touched. So nothing was lost this time. That is the reason this is filed
`medium` and not higher: the workaround is sound and the isolation held.

It is still worth fixing, for two reasons that outlast the one run:

- **A skill step that reliably fails teaches agents to skip steps.** Five for
  five is not an edge case. An agent that has learned the second instruction in
  a numbered list does not apply to it is worse at following the fourth.
- **The workaround is only as good as the agent's discipline.** `EnterWorktree`
  makes the isolation structural — a wrong path fails. Absolute-path hygiene
  makes it a promise each agent keeps, and `AGENTS.md` is explicit that the
  reason for the worktree rule is that "two of them editing one checkout" has
  already happened here twice. Trading a guarantee for a convention is exactly
  the trade that file argues against everywhere else.

What is not yet known, and should be established before writing anything: this
may be a constraint of the harness rather than something the repository can
change. If it is, the fix is documentation, not code.

## Work

Find out which of these is true, in this order:

- **Can a dispatched subagent be launched with its cwd already inside the
  worktree?** The parent creates the worktree before dispatching, so the
  directory exists at launch. If a subagent's working directory can be pinned
  at launch, `EnterWorktree` may then succeed — or be unnecessary, which is
  just as good.
- **If it cannot**, then `work-on-a-task` step 2 is wrong for the dispatched
  case and should say so: name both paths, say when each applies, and state the
  absolute-path discipline as the requirement it actually is rather than as a
  fallback nobody wrote down. Include the failure message verbatim, so the next
  agent recognises it instead of retrying.

Either way, record what the parent session must do, because it worked: create
the worktree, install `node_modules` into it, and hand the agent the absolute
path in its prompt. On macOS `cp -Rc` clones `node_modules` copy-on-write,
which is near-instant and costs almost no disk — five copies were made this way
and `npm ci` was never run.

**Not doing:** removing the worktree rule, or letting agents build in the main
checkout. The rule is right; this is about how an agent gets into one.

## Acceptance

- A dispatched subagent either enters its worktree with `EnterWorktree`, or
  `work-on-a-task` says plainly that it cannot and what to do instead.
- The skill no longer contains an instruction that fails for the most common
  way it is invoked.
- Whatever the answer, the "how the parent prepares a worktree" steps are
  written down somewhere an agent doing this next will find them.
