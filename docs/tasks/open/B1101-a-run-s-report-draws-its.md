---
id: B1101
title: A run's report draws its before-and-after from the diff, and triage hands back a list nobody can paste into an agent
type: DOCS
priority: medium
complexity: low
area: skills
found: "2026-09-09T16:18:25Z"
---

# B1101 — A run's report draws its before-and-after from the diff, and triage hands back a list nobody can paste into an agent

## Why

Two small ends of the loop are open.

`report-a-run` draws its before-and-after as hand-made HTML sketches
"grounded in the diff". That was the only option when nothing captured a page,
and it is the most flattering mistake available: a drawing of the after made
by the agent that wrote the after. Once B1097 exists and B1098 requires a
capture, the report has real images and should use them.

`triage-a-backlog` ends by putting a markdown decision list in the person's
clipboard. Nothing in it can be handed to an agent — the person still has to
compose the instruction that starts the work.

## Work

- `report-a-run`: where a run directory holds captures, embed the real
  before/after images rather than sketches, and say which page each was taken
  on and whether that page existed before the branch. Keep the sketch path for
  tickets with no capture, labelled as a sketch. Downscale for the artifact's
  16 MB ceiling.
- `triage-a-backlog`: the decision bar also emits a paste-ready line —
  `plan-a-run B1091 B1092 B1057` — beside the existing list.

Not doing: any change to either skill's structure, verdicts or decision bar.

## Acceptance

- A report built from a run directory shows a photograph rather than a
  drawing, with the URL and the width beneath it.
- The triage artifact's clipboard block starts with a line a person can paste
  into an agent with nothing added.
