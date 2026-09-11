---
id: B1115
title: A brief can say a ticket is dropped or live, and B1058 is neither
type: DOCS
priority: high
complexity: low
area: skills
found: "2026-09-09T17:13:56Z"
started: "2026-09-11T12:40:04Z"
merged: "2026-09-11T12:51:37Z"
completed: "2026-09-11T13:18:31Z"
---

# B1115 — A brief can say a ticket is dropped or live, and B1058 is neither

## Why

`brief.json` has two states for a ticket: it is in `dropped[]` with a reason,
or it is in `tickets[]` and is going to be built. B1058 is neither, and the
first real run of the pipeline found that within an hour.

B1058 is **valid** — its planner grounded that in the tree: no
`app/api/webhooks/whatsapp` route exists, no binding store exists, `owner.tel`
is an unproven send-destination. It is also **unbuildable this week**, because
its own Work section names two prerequisites (B1057, the webhook; B1064, the
proven-number registry) that sit unpromoted in `backlog/big-feature/`. Neither
existing state fits: dropping it says the ticket is wrong, and listing it says
build it.

Putting it in `tickets[]` anyway is the expensive mistake. A group subagent
handed a valid ticket with no prerequisite either invents an ad-hoc version of
the missing work — duplicating a design the owner has already decided under
another id — or burns its three verify cycles and parks.

## Work

A third state in the brief: `blocked[]`, carrying the ticket, what blocks it,
and whether the blocker is itself a ticket that could be promoted into this
run. `plan-a-run`'s artifact shows it as its own section with one question
attached — *promote the blockers, or park this one* — because that is a
decision only the person can make and it changes the size of the run.

`run-a-batch` never builds a blocked ticket. `report-a-run` counts it
separately from parked: a parked ticket was attempted and failed, a blocked
one was never started, and reporting them together flatters the run.

## Acceptance

- A brief with a blocked ticket names its blockers by id and says whether each
  is promotable.
- `run-a-batch` refuses to build a ticket in `blocked[]` rather than trying.
- The report shows blocked and parked as different numbers.

## Built, 2026-09-11

`.claude/skills/plan-a-run/SKILL.md`: a `blocked[]` state alongside
`dropped[]`, defined in step 1's validity bullet, given its own artifact
section in step 4 (one question per row — promote the blockers, or park this
ticket), added to the brief JSON schema with a worked `B1058`/`B1057`/`B1064`
example, mentioned in step 5's count, and two new red flags.

`.claude/skills/run-a-batch/SKILL.md`: step 1 now refuses to build a
`blocked[]` ticket outright and states the distinction from `dropped[]` and
from a parked ticket in words.

`.claude/skills/report-a-run/SKILL.md`: blocked is a sixth tally number, read
straight from the brief and never folded into parked — a short paragraph in
step 1's sort and a mention in step 4's tally line say why.
