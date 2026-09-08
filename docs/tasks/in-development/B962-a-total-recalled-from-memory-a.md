---
id: B962
title: A total recalled from memory a turn later drops what it could not convert
type: ISSUE
priority: high
complexity: low
area: helper, honesty
found: "2026-09-08T12:52:43Z"
started: "2026-09-08T12:53:21Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T12:53:21Z"
---

# B962 — A total recalled from memory a turn later drops what it could not convert

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B955 catches a turn that states a total without calling `trip_costs`, and B960
catches one that states a total the tool said was partial. Between them a
person should never be handed a figure that quietly excludes their foreign
spend.

They are, one turn later. Verified live: after an honest answer naming
`15 BAM` and `1500 MKD` as outside the total, a short follow-up in the same
thread — *"just the number then"* — came back as

> "Danube Circuit cost **240.476 CHF** so far."

with `looked: []`. No tool call, so B960's check had nothing to compare
against; and B955's check did not fire either, which is the actual bug.

`A_TOTAL` in `lib/helper/model.ts` matches *"the total is"*, *"altogether"*,
*"comes to"* and `so far` **followed by** a figure. It does not match a figure
followed by *"so far"*, and it has no pattern for the plainest phrasing of all:
*"X cost N"*. Both of the tester's follow-ups were shaped exactly that way,
which is not a coincidence — it is how somebody asks for a number when they
have stopped wanting detail.

The tester's own summing up is the ticket: *"a person who gets the honest
disclosure once and then asks a quick follow-up can be handed a number with the
unconverted money quietly gone — the same shape of harm, just one turn later
than the fix currently reaches."*

## Work

Widen `A_TOTAL` so the ordinary phrasings are covered — a figure with *cost*,
*spent*, or *so far* on either side of it — and add the German and Hungarian
equivalents, which have the same word order problem in the other direction.

Then check the pair together: with the matcher widened, B955's existing rule
(a total with no cost read this turn) covers the memory case on its own, and no
new mechanism is needed.

Test with the tester's own two sentences.

## Acceptance

*"Danube Circuit cost 240.476 CHF so far"* and *"Roughly 240 CHF for Danube
Circuit so far"*, said with no `trip_costs` call on the turn, are both caught.
