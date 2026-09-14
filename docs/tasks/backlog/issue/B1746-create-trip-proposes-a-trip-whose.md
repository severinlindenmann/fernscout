---
id: B1746
title: create_trip proposes a trip whose title the journal already has, instead of using it
type: ISSUE
priority: medium
complexity: low
area: helper
found: "2026-09-14T18:03:58Z"
---

# B1746 — create_trip proposes a trip the journal already has

## Why

Found by `npm run helper:bench` (B1744), which is the point of having it: this
is not a crash and no test was ever going to catch it.

In the `card-to-trip-vague` scenario the journal has exactly one trip,
**Ungarn 2026**, and the person says "auf ungarn reise" with a contact card
ticked. In roughly one run in six the model reads the trips — `trips` is in
`looked` — sees Ungarn 2026, and then proposes **`create_trip` for a second
Ungarn 2026** rather than using the one it just read.

Measured, on the code at B1744, twelve runs:

```
9/12  75%  card-to-trip-vague (web)
           did not propose trip_people (proposed: nothing)
           did not propose trip_people (proposed: create_trip)
```

Pressing it would leave the journal with two trips of the same name — and the
person asked for neither.

## Work

**A guard, not a sentence.** A prompt rule was tried against this and made
things worse (B1744 records the numbers: 7/12 against a 9/12 baseline), which
is exactly the evidence that says stop tuning prose and put the rule in the
code.

`create_trip`'s `propose` (`lib/helper/tools/areas/trips.ts`) already refuses
when required answers are missing; the same shape fits here. When a trip on
this journal already carries the proposed title — the comparison
`resolveTrip` already knows how to make — refuse with a sentence that names
the trip that exists, so the model's next move is to use it rather than to
invent a second one. `trip_people`'s own `agent.tool.tripPeopleNeedsEmail`
is the precedent: a card that cannot be pressed usefully is not shown.

A refusal needs its three locale entries, and `npm run i18n:keys` after the
English one.

## Acceptance

- A `create_trip` proposal for a title this journal already has is refused,
  naming the trip that exists.
- A trip with a genuinely new title proposes exactly as it does today.
- `npm run helper:bench -- --only card-to-trip-vague --runs 12` no longer
  reports `proposed: create_trip` as a failure reason. The other failure mode
  ("proposed: nothing") is a separate question and this ticket does not claim
  it.
