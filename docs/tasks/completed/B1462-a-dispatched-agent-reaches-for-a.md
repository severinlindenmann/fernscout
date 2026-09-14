---
id: B1462
title: A dispatched agent reaches for a background verify and strands itself, and no building skill warns it
type: DOCS
priority: high
complexity: low
area: skills
found: "2026-09-11T14:17:22Z"
merged: "2026-09-14T05:38:29Z"
completed: "2026-09-14T16:31:40Z"
---

# B1462 — A dispatched agent reaches for a background verify and strands itself, and no building skill warns it

## Why

**Four dispatched agents stranded themselves this way in a single run**
(2026-09-11): B1301, B1282, B1460 and one of the contacts groups. Each returned
a final answer that was not a result — *"Waiting on the background verify run to
complete"*, *"I'll stop issuing further tool calls and wait for the notification
to arrive"* — having done all the real work and then thrown the turn away. Each
needed an explicit message back saying "run it in the foreground" before it
could finish.

The mechanism is mundane and entirely predictable. `npm run verify` takes about
200 seconds. The Bash tool's default timeout is 120. An agent that runs it
plainly gets a timeout, reasonably concludes the command needs backgrounding,
backgrounds it — and then waits for a notification that never comes, because
nothing is watching on its behalf.

**The fix is one argument**: `timeout: 900000` on a single blocking call. The
agents did not know that, because nothing they were told to read says it.

`grep -rn "run_in_background" .claude/skills/*/SKILL.md` returns exactly **one**
line, in `triage-a-backlog` — which is the skill for reading a lane, not for
building anything. The two skills a building agent actually follows,
`work-on-a-task` (whose step 5 *is* the verify) and `run-a-batch` (which
dispatches the agents that hit this), say nothing about it.

Every orchestrator currently works around this by putting the instruction in the
dispatch prompt by hand. That works and it is the wrong place: it has to be
remembered once per dispatch, for every agent, forever, by whoever is
orchestrating — and when it is forgotten the failure is a wasted agent-hour that
looks like a stall rather than a missing flag.

## Work

Put it where the agent reads it:

- `work-on-a-task` step 5, beside the verify command itself: run it in the
  foreground as one blocking call with `timeout: 900000`; never
  `run_in_background`, never a Monitor, never poll. Say the numbers — 200
  seconds of suite against a 120-second default — because an agent that knows
  why will not re-derive the wrong answer.
- `run-a-batch`, in the dispatch step, as something the orchestrator must tell
  each group agent, with the same reasoning.
- Consider whether this belongs in `AGENTS.md`'s "Verifying a change" section
  too. Argument for: it is not specific to one skill. Argument against:
  `AGENTS.md` is about the software rather than the harness, and it already
  says the suite is fifty seconds and the build seventy — which is now wrong by
  a factor of three and is worth correcting either way.

Not in scope: changing the default timeout, which is the harness's and not this
repository's.

## Acceptance

- An agent handed one ticket and told to follow `work-on-a-task` learns, without
  being told separately, to run `verify` in the foreground with a long timeout.
- `grep -rn "run_in_background" .claude/skills/` names the building skills, not
  only `triage-a-backlog`.
- Whatever timing numbers the documents quote match a measured run.


## The count, end of 2026-09-11

**Ten agents in one day**, every one of them having done the work and then
returned a non-result — *"waiting on the background verify"*, *"I'll wait for
the completion notification"*, *"Monitor armed"* — and every one needing a
message back before it could finish.

The number matters more than the anecdote, because of **when** they happened.
After the fifth, I moved the instruction to the **opening line** of every
dispatch brief, in bold, with the reason and the exact argument to pass. Five
more agents stalled after that. One of them wrote afterwards: *"my first
`npm run verify` invocation omitted the extended timeout — my mistake, contrary
to the brief's opening instruction."*

So the experiment has already been run, twice, and prose lost both times. That
is the argument for `hookify` rather than another paragraph: this is a rule
agents keep breaking while knowing it, which is exactly the case AGENTS.md says
to turn into a hook so the harness enforces it instead of the prose asking
nicely.

**A second cost, which is not obvious.** Stalling pushes an agent into narrating
unusual tool manoeuvres — arming and disarming Monitors, abandoning background
tasks. One such narration tripped a security warning on an otherwise clean
three-file change (a doc comment and a test), which then cost a full independent
re-verification of work that never touched executable code. The trap does not
only waste the agent's turn; it manufactures false signals for whoever is
watching.

**And it corrupted a brief.** The stale "fifty seconds and the build seventy" in
AGENTS.md — corrected by B1141 today to a measured 230-290s — is part of why an
agent plans a 120-second-shaped command in the first place.

## Related

B1483 is the sibling finding — a dispatched agent's working directory stays the
shared checkout even though its edits land in the worktree — and B1144 is the
third: the security skill needs a tool a dispatched subagent does not have.
Three unrelated root causes, all landing as edits to the same two skill
documents. Edit them in one pass rather than three, and note this ticket's own
argument that prose has already failed twice here, so the durable answer is a
hook rather than another paragraph.


## Done 2026-09-14, and the ticket was right about the wrong fix

The diagnosis holds exactly. What a run since has shown is that **the
instruction alone does not work**, which the ticket could not have known:

- The rule went into `AGENTS.md` and `work-on-a-task` as an explicit paragraph
  naming the failure. **The very next agent dispatched, with that rule quoted
  in its brief, did it anyway.** Ten agents stranded in one day.
- So `scripts/verify.mjs` now **refuses to start unattended** unless
  `VERIFY_WILL_WAIT=1` is set beside the long timeout. That delivers the
  message at the one moment it is needed instead of hoping it was read.
- The guard cannot close the hole completely, and the agent that built it
  proved why rather than assuming: a backgrounded subprocess and a
  foregrounded one are **byte-identical from inside** — same `isTTY`, same
  ppid, no distinguishing signal. So it detects "nobody is watching" and makes
  the caller *declare* intent. An agent can still declare it and break it, and
  one did.

Now also in the three dispatching skills the ticket named as silent —
`run-a-batch`, `test-the-live-site`, `plan-a-run` — so an orchestrator does not
have to remember it per dispatch.

**And the better answer for a batch, learned the expensive way:** do not have
dispatched agents verify at all. Six concurrent `verify` runs took this machine
past a load average of 180; every run starved, a sub-second test took 51
seconds, and it was misread as a failure — by me, before I recognised it. Have
each agent run only the test files it touched, and run the full gate serially
at merge time, which is where it has to pass anyway.
