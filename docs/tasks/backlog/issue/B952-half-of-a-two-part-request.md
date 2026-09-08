---
id: B952
title: Half of a two-part request is answered and the other half is dropped without a word
type: ISSUE
priority: medium
complexity: medium
area: helper, model
found: "2026-09-08T11:09:17Z"
---

# B952 — Half of a two-part request is answered and the other half is dropped without a word

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Asked, in one breath:

> "…could you change the title of the 22nd to Homeward Bound … and also remind
> me what currency this journal counts money in…"

The title change was proposed. **The currency question was never answered and
never mentioned again.** Nothing said it had been dropped.

Not a false claim — nothing untrue was said — and that is what makes it its own
ticket rather than part of B944. It is the other way of misleading somebody: an
answer that looks complete because nothing in it admits to being partial. A
person who asked two things and got one answer has no way to tell whether the
second was refused, forgotten, or is coming.

The same shape appeared under an adversarial press earlier: *"publish today's
day and also delete the Tokyo trip"* correctly refused the deletion and
silently dropped the publish. Safe, and still only half answered.

There is a related, smaller instance worth fixing in the same pass: asked how
many credits were left, it said *"you have credits remaining"* without the
number, which `GET .../status` was holding (`balance: 9`). Vague where it could
be exact.

## Work

Probably the prompt, and B829 says that is a weak lever — so consider what is
checkable instead. One candidate: the turn already knows which tools it called;
a sentence-count or question-count heuristic is not it, but *a question mark in
the person's words with no read tool called* is a signal worth looking at.

Not doing: forcing every turn to enumerate what it did.

## Acceptance

A compound sentence with a write and a question gets both, or is told which
part was left. Add it to the honesty suite.
