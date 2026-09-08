---
id: B943
title: The sentence that replaces a false claim is itself a claim, and it can be false
type: ISSUE
priority: high
complexity: low
area: helper, honesty
found: "2026-09-08T10:23:47Z"
started: "2026-09-08T10:24:47Z"
merged: "2026-09-08T10:30:57Z"
---

# B943 — The sentence that replaces a false claim is itself a claim, and it can be false

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B920's honesty net catches a turn whose words claim something the tools did
not do, asks the model again, and — when the second answer is still flagged —
replaces it with a fixed sentence, `agent.nothingHappened`.

That sentence says:

> Nothing has been saved and nothing has changed in your journal — there is
> nothing on this screen to press.

It is unconditional, and it is not always true. Driven against the deployed
site: a day was started and pressed, the draft was on disk, and the next
question — *"is the day up?"* — produced exactly that sentence. A day had just
been saved.

So the net caught a false claim and put a different one in its place. That is
worse than the failure it prevents in one specific way: the flagged answer was
at least about the turn, while this is a blanket denial of everything, and a
person who has just watched a day appear is being told it did not.

The thread already knows better. Since B939 every write route leaves a
`[written: …]` note behind, so whether anything was saved in this conversation
is a fact on hand at the moment this sentence is chosen.

## Work

Two sentences instead of one: the existing text when nothing has been written,
and one that denies only the *turn* when something has. The second should not
try to say what was written — that is the model's job and it has just been
caught getting it wrong — only that this answer could not be given.

Check the other fixed strings the net can reach for the same fault.

## Acceptance

A test that puts a `written:` note in a thread, forces the fallback, and fails
if the answer says nothing has changed in the journal.
