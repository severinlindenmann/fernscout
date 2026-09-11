---
id: B1114
title: run-a-batch has no shape for an engagement, so an OPS ticket cannot be in a batch at all
type: DOCS
priority: high
complexity: medium
area: skills
found: "2026-09-09T17:13:55Z"
started: "2026-09-11T12:40:03Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T12:40:03Z"
---

# B1114 — run-a-batch has no shape for an engagement, so an OPS ticket cannot be in a batch at all

## Why

`run-a-batch` is built around one shape: a ticket becomes a diff, the diff is
verified, merged, deployed and looked at. An **OPS** ticket is the other shape
AGENTS.md names — "an engagement against the running instance … the deliverable
is findings and other tasks, not a diff" — and the skill has nothing to say
about it.

Found by running the pipeline for real on 2026-09-09. Two of the five tickets
in the first batch were OPS, and both planners independently reported the same
three things:

- **`concurrencySafe: false`.** B103 shares a per-IP rate-limit budget on
  `POST /api/auth/request` with anything else touching the live site, so a
  second ticket running at the same time silently eats its allowance. B101
  runs against one local instance and has to serialise the areas that mutate
  shared limiter and token state.
- **They need a resource nobody hands out.** A provisioned test journal, an
  address whose mail is readable, SSH read access, a remaining rate-limit
  budget — B103's planner asked for an `ACCESS.md`. A group subagent in
  `run-a-batch` is handed a worktree and a brief, and neither carries any of
  that.
- **Their output is captures, and the report has no row for it.** A run that
  produced eleven SECURITY captures and no diff would show as eleven parked
  tickets today.

The lazy reading — that OPS tickets simply never go in a batch — is worth
considering and is probably wrong: an engagement is exactly the kind of long
unattended work this pipeline was built for. What is wrong is pretending it is
a build.

## Work

Give `run-a-batch` a second lane for `type: OPS`:

- An engagement never joins a build group. It runs on its own, serialised
  against every other engagement, and may run alongside builds only when its
  target is a different instance (a local one, while builds merge).
- The orchestrator hands out the shared budget centrally — the test journal,
  the address, the remaining rate-limit allowance — because the whole point of
  a per-IP limit is that concurrent agents cannot each assume the whole of it.
- Its completion condition is a report and its captures, not a merge. The
  ticket lands in `testing/` with its report path, and `report-a-run` gains a
  row shape for "engagement: N findings, M captures, here is the report".

`plan-a-run` already collects the right information — both planners returned a
`shape` block with `needs`, `mustNot`, `concurrencySafe` and dispatch notes
without being asked twice. Put that block in the brief schema so
`run-a-batch` can read it rather than re-deriving it.

Not doing: changing what an OPS ticket is, or how `test-the-live-site` runs
one by hand.

## Acceptance

- A brief containing one FEATURE and one OPS ticket produces a run where the
  engagement is scheduled on its own, with its resources named.
- The brief schema carries `shape` for an OPS ticket, and `run-a-batch` reads
  it rather than deciding concurrency itself.
- A finished engagement appears in the report as findings and captures, not as
  a parked ticket.

## Built, 2026-09-11

`.claude/skills/plan-a-run/SKILL.md`: the brief schema gained a `shape` block
(`kind`, `target`, `concurrencySafe`, `needs`, `mustNot`), present only on a
`type: OPS` ticket, with a worked B103-shaped example, and a paragraph on the
"nothing left to build, the remaining step is a person's" case grounded in
B1147.

`.claude/skills/run-a-batch/SKILL.md`: a new "Engagements — OPS tickets run
their own lane" section — never joins a group or gets a worktree, dispatched
one at a time, may only overlap a build wave when `shape.target` names a
different instance, the orchestrator hands out `shape.needs` centrally, and
its completion is a move to `testing/` with a report path rather than a
merge. Grounded in both real cases: B103/B101's `concurrencySafe: false`
finding, B1147's "the remaining step is a portal login, not code", and B911's
finished engagement with real spend and no diff. New "Not doing" and red-flag
entries to match.

`.claude/skills/report-a-run/SKILL.md`: an engagement is its own tally row and
its own sixth/seventh count — "engagement: N findings, M captures, report at
`<path>`" — never merged, never parked, with the person's-remaining-step case
called out explicitly.

**How B1147 and B911 would travel through this shape:** B1147's planner would
report `validity: "superseded by <what was found>"` with the reasoning
naming the Gelato portal login as the remaining step and whose it is — it
never reaches `tickets[]` or `shape` at all, the same as any other
non-buildable ticket, just with that one sentence added so the person can go
do it themselves. B911, run as an OPS ticket through this shape, would carry
`shape: {kind: "engagement", target: "live", concurrencySafe: false, needs:
["a contact with a real postal address", "the demo journal's credit
balance"], mustNot: ["press a real hardcover order twice without confirming
one charge"]}`; `run-a-batch` would dispatch it alone, serialised against any
other `live` work, and its finished row in the report would read something
like "engagement: 4 findings (VAT pricing, refund-on-refusal, hardcover
untested, Gelato portal onboarding blocks further orders), report at
`docs/providers/photobook.md`" — not a parked ticket, because nothing about
it was a failed build.
