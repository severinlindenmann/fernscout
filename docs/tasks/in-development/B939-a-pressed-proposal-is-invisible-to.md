---
id: B939
title: Only our own browser tells the conversation that a write happened
type: ISSUE
priority: high
complexity: medium
area: helper, thread
found: "2026-09-08T09:49:11Z"
started: "2026-09-08T10:01:00Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T10:01:00Z"
---

# B939 — A pressed proposal is invisible to the conversation that proposed it

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

A tester reported that after pressing a proposal, the next turn claimed the
write had never happened — *"The trip must be saved first before I can start a
day"*, about a trip that existed. They concluded a press is never recorded.

**It is recorded, and the reproduction says where.** `components/HelperAsk.tsx`
posts a second call after every successful press —
`POST /api/helper/<user>/proposal` with `wrote: true` — and
`app/api/helper/[user]/proposal/route.ts:71` writes the note the next turn
reads. The tester's curl script did not make that call.

Two arms on the live site, same script, one difference:

- **Without `wrote: true`:** *"Nothing has been saved yet: the trip is waiting
  for you to press."* The trip was on disk. The reported defect, reproduced.
- **With it:** no such claim, in a one-trip conversation and again in a
  two-trip one, where "a day in the first trip" chose the first trip.

So the product is correct and this ticket is not the one that was filed. What
is left is narrower and real: **the only client that closes the loop is ours.**
A press is a plain `POST` to a documented-shaped endpoint, and any other caller
— a script, a second tab, a future phone client (B674) — leaves the
conversation believing nothing was written. The knowledge that a write must be
announced lives in a React component.

A second, smaller gap found in the same run: the note is built from the
proposal's *input* arguments, so it carries the trip's title and not the id the
server derives at creation. Asked outright, the model said it did not know the
id rather than inventing one, which is the right failure — but it is one
plausible question away from being unable to answer, and a future write tool
that needed the model to supply an id could not be written.

## Work

Move the note to where the write is, rather than asking every client to
remember: each helper write route says what it wrote, on success, and the
`wrote: true` call becomes a compatibility shim or goes. The routes already
know their own result, which is also what fixes the id.

Not doing: recording anything about a write that failed — B922 is that.

## Acceptance

A test that presses a write route directly, with no follow-up call, and finds
the note in the conversation — including the id the route derived, not the
title it was given.
