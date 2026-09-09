---
id: B941
title: Correcting a sentence is read as adding a cost
type: ISSUE
priority: medium
complexity: low
area: helper, model
found: "2026-09-08T09:49:16Z"
started: "2026-09-08T10:12:02Z"
merged: "2026-09-08T10:23:54Z"
completed: "2026-09-09T16:47:37Z"
---

# B941 — Correcting a sentence is read as adding a cost

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

A person with a published day saying *"ramen for dinner, 1200 yen"* said
**"it should say udon, not ramen"**. The conversation proposed `add_cost` —
a second line of 1200 — rather than `set_day_words`. Pressed, it would have
doubled the recorded spend and left the wrong word on the page.

Nothing was written; the proposal was read and refused. But the phrasing is
the natural one, and the safe phrasing ("change the text — it currently says
X, it should say Y") had to be found by trial.

The pull is understandable: the sentence contains a figure and a currency, and
`add_cost` is the tool whose description mentions both. What it does not
contain is any word for *adding*.

## Work

Probably the tool descriptions rather than the system prompt — B829 is the
record that rewording the prompt is not a reliable lever and a code guard is.
Consider whether there is a guard here at all: a correction names something
already on the day, which is checkable.

Not doing: a general "did you mean" pass over every proposal.

## Acceptance

"It should say udon, not ramen", against a day whose words contain "ramen",
proposes `set_day_words` and not `add_cost`. Add it to the honesty suite so a
later prompt change cannot quietly undo it.
