---
id: B957
title: The conversation forgets silently and answers as though it had not
type: ISSUE
priority: high
complexity: low
area: helper, thread
found: "2026-09-08T11:58:39Z"
started: "2026-09-08T11:58:39Z"
merged: "2026-09-08T12:02:27Z"
---

# B957 — The conversation forgets silently and answers as though it had not

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`lib/helper/thread.ts` keeps twelve turns and drops the oldest with
`.slice(-MAX_TURNS)`. Nothing records that anything was dropped, so the model
cannot tell a short conversation from a trimmed one — and it does not behave as
though it might be either.

Somebody writing up a fifteen-day trip asked, around turn 24, *"did I mention
who I was travelling with, and were we driving?"* The answer was in their first
message: *"my partner and I drove through Portugal and Spain."*

It did not say it could not recall. It read an unrelated day, called that day
"the first day" (it was the sixth written), concluded *"you did mention
driving"* — true only by accident, from the day's prose — and *"it doesn't say
who you were travelling with"*, which is false about the message it could no
longer see.

Their summing up is the ticket:

> It never admits a memory limit; it fabricates a confident, wrong,
> artifact-grounded answer instead. That is the hardest failure mode for a real
> user to catch, because it reads exactly like a correct answer.

The trim is right and should stay — twelve turns is a deliberate cost decision,
and B889 sets it out. What is wrong is that it is invisible.

## Work

`remember()` and `note()` both trim. When a trim actually drops something, the
conversation should carry one note saying so — the same mechanism B924 built
for telling the model things the person never sees, and B939 used for what a
route wrote.

Then the model has a fact to answer from: *"that was earlier than I can still
see — tell me again"* is a good answer, and it is not one it can give today.

Not doing: keeping more turns, or storing the conversation anywhere. B889
settled both, and neither is what went wrong here.

## Acceptance

A thread driven past twelve turns carries a note saying so, and asking about
something said in turn one gets told it is out of reach rather than answered
from an unrelated day.
