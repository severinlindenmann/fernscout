---
id: B1100
title: Nothing carries a batch of approved tickets through build, merge, deploy and live check without a person driving each step
type: DOCS
priority: high
complexity: high
area: skills
found: "2026-09-09T16:18:24Z"
started: "2026-09-09T16:20:49Z"
session: df031729-b5f3-42f2-bcac-c6c88d608ee0
claimed: "2026-09-09T16:20:49Z"
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
