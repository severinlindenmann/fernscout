---
id: B810
title: The first thing the product asks a new person is what their day cost
type: ISSUE
priority: medium
complexity: low
area: entries, tracks, agent
found: "2026-09-07T15:17:57Z"
started: "2026-09-07T16:22:32Z"
merged: "2026-09-07T16:50:58Z"
---

# B810 — The first thing the product asks a new person is what their day cost

## Why

B709 asked whether the money question belongs at write time or at publish, and
was closed with a decision: keep it at write, and the reasoning is now in
`lib/tracks.ts` — "being asked early costs a person nothing they cannot
revise."

New evidence arrived after that decision, from a 23-year-old, not technical,
meeting it as the first thing the product asked him to decide:

> "I have no idea what the castle cost or its GPS coordinates. I picked
> 'unknown' for both because that's the truth, but a person who didn't already
> know this distinction existed would have just made up a number to get past
> the wall — which is exactly the thing this app says it doesn't want."

That is not an argument that the question is wrong. It is an argument that
**asking it before anything else has been written makes the wrong answer the
easy one** — and the wrong answer here is invented data in somebody's journal,
which is the one thing this software is built not to have.

The decision was made deliberately and written down, so this is a request to
revisit it with evidence, not a claim that it was wrong. It is filed separately
rather than reopening B709, because a closed decision with a second witness is
a new question, not an unfinished ticket.

## Work

Consider a middle path that keeps the decision and removes the wall: ask at
write, but not *first* — after the words exist, when the person has something
to say no about. Or default the express path to `unknown` with a visible line
saying so and a way to correct it, which is the honest answer for somebody
writing on a bus.

If the answer is still "leave it", add the second witness to the comment in
`lib/tracks.ts` so the next person knows it was tested and not merely reasoned
about.

## Acceptance

Either the money question no longer stands between a person and their first
sentence, or `lib/tracks.ts` says why it does, with this evidence named.
