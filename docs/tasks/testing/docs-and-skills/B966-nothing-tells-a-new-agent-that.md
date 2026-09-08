---
id: B966
title: Nothing tells a new agent that the honesty net exists or why it is shaped that way
type: DOCS
priority: medium
complexity: low
area: docs, helper
found: "2026-09-08T13:17:15Z"
started: "2026-09-08T13:17:15Z"
merged: "2026-09-08T13:20:44Z"
---

# B966 — Nothing tells a new agent that the honesty net exists or why it is shaped that way

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`lib/helper/model.ts` now holds seven checks that compare what the model
**said** against what the turn actually **did** — a claimed write, a button
that is not there, words in a proposal that has no room for them, who can read
something, what a day says, a total nobody computed, a total that was partial,
and a figure the server never produced.

They were built one at a time across a single day, each from a person being
told something untrue. `AGENTS.md` does not mention them, so a new agent
reading the file learns the rule — *"an empty field beats a plausible
fiction"* — and nothing about the machinery that now enforces part of it.

That costs twice. Somebody adding a tool does not know their claims are
checked, or that a new kind of claim needs a new check. And somebody whose
change trips a guard has no idea what they are looking at: `agent.notCounted`
appearing on a screen reads as a bug in the answer rather than as the net
working.

The day also produced a finding worth writing down once rather than
rediscovering: **rewording the prompt did not fix any of these and a code
guard fixed all of them.** B829 said so first; every ticket since has agreed.
Four separate fixes were blocked by the prompt-token ceiling and each time the
answer was a guard rather than more words.

## Work

A short section in `AGENTS.md`, under the one rule it belongs to. What the net
is, where it lives, the shape a check takes (a matcher, a condition on what the
turn did, a retry, and a plain sentence when the retry fails too), and the two
rules learned the hard way: a claim is checked against the **turn**, not against
the phrasing; and a guard that fires on an honest turn is a bug.

Name the failure that started it — a 71-year-old told *"Der Text ist
gespeichert"* with nothing saved — because the reason for all of this is one
person, not an architecture.

Not doing: listing the seven. A list in two places disagrees with itself within
a month, and `lib/helper/model.ts` has them with their reasons.

## Acceptance

Somebody who has read `AGENTS.md` and nothing else knows the net exists, why,
and that adding a tool may mean adding a check.
