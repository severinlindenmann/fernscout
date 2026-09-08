---
id: B945
title: The warnings a drafted day comes back with describe something it did not do
type: ISSUE
priority: high
complexity: low
area: helper, model
found: "2026-09-08T10:45:26Z"
started: "2026-09-08T11:04:06Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T11:04:06Z"
---

# B945 — The warnings a drafted day comes back with describe something it did not do

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`POST /api/helper/<user>/day/write-day` returns a `warnings` array alongside the
drafted prose. Driven live, with notes saying *"rained most of the afternoon so
we ducked into the maritime museum"*, it came back with:

> `"warnings": ["Weather (rain) mentioned in notes but omitted from prose per archive protocol."]`

and prose reading:

> "Rained most of the afternoon so we ducked into the Maritime Museum."

The rain is in the sentence the warning says it was left out of. The prose is
correct — the person said it, so writing it is right, and the weather rule is
about a *lookup*, not about a word somebody used. The warning is a false
description of what the model did to somebody's own words.

It is invisible today: the room drops `warnings` rather than showing it. That
is why this is medium and not high, and it is also the argument for deciding
one way or the other rather than leaving it — a field nothing renders, saying
something untrue, is worse than either showing it or removing it.

## Work

Decide which. Either the field is shown, in which case it has to be true, or it
goes and the model stops being asked for it. Read what the prompt asks for
before choosing: a model asked to report what it left out will report
something.

Not doing: keeping it unrendered and correct-in-principle.

## Acceptance

Whichever way: no path returns a `warnings` entry naming a thing that is in the
prose beside it.
