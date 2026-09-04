---
id: B144
title: EnterWorktree refuses for a dispatched subagent, so work-on-a-task's second step cannot be followed
type: ISSUE
priority: medium
complexity: low
area: skills, agents, worktrees
found: "2026-09-03"
started: "2026-09-04T07:43:09Z"
merged: "2026-09-04T08:11:43Z"
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

### Established, 2026-09-04

**It is a constraint of the harness, and the fix is documentation.** The guard
lives in the tool, not in this repository — nothing here can widen it, and
nothing here should try. The two questions the Work section asks, answered:

- *Can a dispatched subagent be launched with its cwd already inside the
  worktree?* No. A subagent inherits the parent's working directory, and there
  is no parameter on the dispatch that changes it. `EnterWorktree` then refuses
  for the same reason it refused on 2026-09-03.
- *So does step 2 need to say both?* Yes, and it now does.

**The workaround is no longer a workaround; it is the supported path for a
dispatched agent, and it is proven.** A second factory ran on 2026-09-04 —
eleven groups, each one a subagent handed an absolute worktree path created for
it by the parent. Sixteen dispatched agents across the two days, none of which
called `EnterWorktree`, and the main checkout was not written to by any of
them. Absolute paths held.

The Why's second concern stands and is worth keeping: this is a discipline
rather than a structural guarantee, and `AGENTS.md` argues against that trade
everywhere else. What can be done about it is to make the discipline explicit
and checkable rather than left to each agent to invent — which is what the
skill now spells out, item by item, rather than leaving it as an unwritten
convention sixteen agents each rediscovered.

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

## What was built

Documentation only, which is the answer this turned out to have.

`work-on-a-task` step 2 now has two named branches instead of one instruction
that fails for the common case:

- **Interactive session** — `EnterWorktree` with `path`, unchanged.
- **Dispatched subagent** — the refusal quoted verbatim so the next agent
  recognises it rather than retrying, then the absolute-path discipline stated
  as the requirement it is: `cd <abs worktree>` at the head of every `bash`
  call because an agent thread resets its working directory between them; no
  `merge`, `checkout`, `push`, or worktree creation or removal; reading the
  main checkout is fine and writing it is not.

**What the parent does before dispatching** is written down for the first
time — `git worktree add`, then `cp -Rc node_modules <worktree>/node_modules`
(copy-on-write on APFS, near-instant, almost no disk, against minutes for
`npm ci` in each), then hand over the absolute path together with the task
file's contents and its acceptance criteria.

Step 6 says a dispatched agent has no `ExitWorktree` to call and does not run
that step at all — it reports, and the parent merges. `AGENTS.md` "Where the
work happens" names the constraint and points at the skill. Two entries added
to the red flags: retrying `EnterWorktree` after it refused, and merging into a
main checkout nobody checked is on `main` (B201).

## Acceptance

- A dispatched subagent either enters its worktree with `EnterWorktree`, or
  `work-on-a-task` says plainly that it cannot and what to do instead.
- The skill no longer contains an instruction that fails for the most common
  way it is invoked.
- Whatever the answer, the "how the parent prepares a worktree" steps are
  written down somewhere an agent doing this next will find them.
