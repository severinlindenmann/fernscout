---
id: B969
title: A paragraph describing a whole day is thrown away because the day does not exist yet
type: ISSUE
priority: high
complexity: medium
area: helper, tools
found: "2026-09-08T13:31:20Z"
started: "2026-09-08T13:39:22Z"
merged: "2026-09-08T13:45:13Z"
---

# B969 — A paragraph describing a whole day is thrown away because the day does not exist yet

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The commonest thing a person will ever do here is describe a day in a sentence.
Four times out of four in an ordinary write-up, the whole sentence was thrown
away:

> "On the 10th we landed around midday, dropped our bags at the hotel in
> Alfama, and spent the afternoon wandering the narrow streets and had dinner
> at a little tasquinha near the Se cathedral. Tired but happy."

> "A proposal to start an empty day for June 10th is on your screen. Once you
> press that, I can turn your notes into words for it."

The notes were not carried anywhere. The person presses, then types the same
paragraph again. Four days, four repetitions — a third of every turn in the
run was somebody saying something they had already said.

The model reached for `draft_words`, which needs a day that exists, and fell
back to `start_day`. That fallback is correct. What is missing is that
`start_day` has nowhere to put the notes it was given, so they are dropped
rather than carried.

`Proposal.next` is exactly this mechanism in the other direction —
`draft_words` hands its prose on to `set_day_words`, carrying values across a
press. `start_day` → `draft_words` is the same chain and does not exist.

## Work

`start_day` takes the notes it was given and hands them to `draft_words` after
the press, through `next`. The person presses once, reads the words, presses
again — which is the flow this product already has for the second half.

Watch two things. The notes must ride as **their words**, unchanged, into a
tool that is metered — so the second card has to say what it will cost before
it is pressed, as `draft_words` already does. And `start_day` must not become a
tool that writes prose: it still creates an empty day, and the chain is two
presses, for the same reason writing and publishing are two calls.

Not doing: making one press do both. The gap is where a person reads back what
was made of their words.

## Acceptance

One sentence describing a day that does not exist yet ends with the day made
and the person's own notes on the next card, without their having said them
twice.
