---
id: B1100
title: Nothing carries a batch of approved tickets through build, merge, deploy and live check without a person driving each step
type: DOCS
priority: high
complexity: high
area: skills
found: "2026-09-09T16:18:24Z"
started: "2026-09-09T16:20:49Z"
merged: "2026-09-09T16:40:43Z"
---

# B1100 — Nothing carries a batch of approved tickets through build, merge, deploy and live check without a person driving each step

## Why

Everything needed to work a batch of tickets exists and nothing joins it up.
`work-on-a-task` does one ticket and stops at `testing/`. `vps` deploys.
`test-the-live-site` verifies a lane. A person is the thing standing between
each of them, which means a twelve-ticket batch is a day of typing rather than
an afternoon of running.

The parts that are genuinely hard are the ones the sources agree on. An
orchestrated fleet has no natural bottleneck, so small mistakes compound
invisibly — the answer is to reinsert one deliberately, which here is a
serialised merge and a deploy-and-verify per wave rather than one deploy at
the end of six hours. Three to five concurrent agents is the reported ceiling
worth reviewing. And an agent stuck on the same error for three iterations
does not get unstuck by a fourth; it needs a budget and a park.

## Work

A new skill, `.claude/skills/run-a-batch/SKILL.md`, that reads a brief from
B1099 and does not speak to the person again until it is finished.

- **Group by shared files.** Tickets touching a file in common are one group,
  built sequentially in one worktree on one branch and merged once. Groups run
  concurrently, capped at three. This is the only safe parallelism here:
  B880, B881, B883 and B896 are four recordings of two clean branches merging
  into a red `npm run unused`.
- **Dispatch is hierarchical** — this skill spawns one agent per group, and
  that agent runs `work-on-a-task` per ticket with the brief's chosen option
  in hand. The chosen option travels to whatever verifies the ticket as well,
  not only to whatever builds it.
- **Merges are serialised** by the orchestrator, in the main checkout, with
  `npm run unused` after each.
- **A wave ends with a deploy**: `vps`, `/api/health`, then a live check of
  every ticket in that wave with an after-capture from B1097's script.
- **Kill criteria, without exception.** Three failed verify cycles on one
  ticket, or a failed deploy, parks the work with its evidence and the run
  continues. A parked ticket stays in `in-development/` and is a row in the
  report.
- **Questions raised mid-run are parked, never asked.** The run does not
  block on a person.
- Ends by invoking `report-a-run`.

Not doing: promoting tickets (B1099's artifact is the review gate and the
person's answer is the promotion), moving anything to `completed/`, or any new
task lane.

## Acceptance

- Given a brief with four tickets across two groups, it builds both groups
  concurrently, merges them one at a time, deploys once, verifies live, and
  ends with a report — with no question asked of the person in between.
- A ticket whose acceptance cannot be demonstrated is parked in
  `in-development/`, named in the report with what failed, and does not stop
  the other three.
- `npm run unused` is run after each merge, and a red one stops that merge
  rather than being carried forward.
- The skill states its concurrency cap and its per-ticket budget as numbers.

## Built

`.claude/skills/run-a-batch/SKILL.md`. Numbers stated: concurrency cap 3
groups in flight, per-ticket budget 3 failed `npm run verify` cycles. Notes:

- **Grouping is read from `brief.json`'s `groups[]`, never recomputed** —
  B1099's `plan-a-run` is now the one place that computation happens, for the
  reason AGENTS.md gives everywhere else a fact lives in one place. This
  skill's "group by shared files" bullet in Work is satisfied by that read,
  not by a second pass over the tickets.
- Dispatch is two-level, as the ticket asks: this skill spawns one subagent
  per **group** (not per ticket), and that subagent runs `work-on-a-task` per
  ticket inside its own worktree, sequentially, stopping before the merge step
  — merging stays with this skill's orchestrator, serialised, because that is
  the deliberately reinserted bottleneck the ticket's Why argues for.
  `EnterWorktree` cannot be used by either level, since both this skill and
  the group agents it spawns are subagents relative to whoever runs the batch;
  absolute paths throughout, same as `work-on-a-task` already requires of a
  dispatched agent.
- **The chosen option's mockup HTML travels with the dispatch, pasted into
  the group subagent's prompt, not left as a path** — a subagent starting a
  fresh context has to go re-read a path, and the ticket's Why names exactly
  that failure mode (a reviewer who knew the task but not the plan). The group
  subagent is told explicitly to check its own verify/acceptance pass against
  the same `chosen` option, not just the ticket file, closing the other half
  of that same failure.
- A wave's deploy failure parks **every ticket merged in that wave**, not only
  the one whose change broke health — a wave is the unit that goes live
  together, so a bad wave is bad for everyone in it.
- `run-a-batch` ends by handing the whole `.claude/runs/<run-id>/` directory
  to `report-a-run` rather than writing its own summary — same palette, same
  machinery, reused by reference exactly as `plan-a-run` reuses
  `triage-a-backlog`'s.
