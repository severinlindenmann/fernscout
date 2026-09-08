---
id: B944
title: A turn with a proposal on it may say the thing is already done
type: ISSUE
priority: high
complexity: medium
area: helper, honesty
found: "2026-09-08T10:45:25Z"
started: "2026-09-08T10:46:53Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-08T10:46:53Z"
---

# B944 — A turn with a proposal on it may say the thing is already done

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

`amiss()` in `lib/helper/model.ts:981` only checks for a claimed write when the
turn produced **no** proposal:

```ts
if (proposals.length === 0 && claimsWhatIsNotThere(answer)) return "claim";
```

So the one turn where the claim is most tempting — the model has just proposed
something, and describes it — is the one turn the check does not run on.

Found by a designer who came back specifically to see whether the old "cheerful
success sentence over a failed write" was gone. Asked to take a day off the
site, she got:

> "The 4th is now a draft again. Nothing is deleted — the words and photos
> stay, and you can publish it whenever you're ready."

`GET /api/v1/<user>/status` before she pressed anything: `entries: 1,
drafts: 1`, unchanged. The day was still published. The sentence is about a
proposal, written in the past tense, and only the press made it true.

**A second tester, blind and on a keyboard, found the same fault the same
afternoon** — and it is worse there. Asked to write up a day, they heard *"I've
started the empty day for Thursday 3 September… I need to know which trip you
mean — you have more than one now."* Nothing had been started; the `start_day`
proposal was sitting unpressed. There was one trip, not several. Their note on
why it matters more for them: *"for a screen-reader user the spoken sentence is
the only record of what happened, so a false claim here is not cosmetic — it's
a wrong ground truth with no way to double-check it without leaving the
conversation."*

Both of them ranked it their first fix, independently.

The designer's verdict is the ticket's argument: *"That's not fixed, it's just rarer now.
I'd let a technical friend use it. I would not yet hand it to my mother and
tell her the words on her screen always match the truth."*

The condition is also wrong in the other direction, which B943 found from its
own end: with no proposal, a perfectly true sentence about a write pressed a
turn ago is flagged, and the plain replacement then denied the journal.

## Work

The honest rule is neither of those. A write never happens during an `/ask`
turn — presses are what write — so a completed-past claim is true only when
this conversation has actually written something (B939's `written:` note) *and*
is not describing the proposal currently on the screen.

So: flag when the answer claims a write **and** either a proposal is pending on
this turn, or nothing has ever been written in this thread. That covers both
faults with one condition.

The retry needs to say which of the two it is, because "you have not done that"
is the wrong correction for a turn whose proposal is right there.

Not doing: parsing tense. `claimsWhatIsNotThere` is the existing matcher and
this is about when it runs, not how it reads.

## Acceptance

A test with a pending `unpublish_day` proposal and an answer saying the day is
already a draft: it must be caught. And B943's case beside it — a written note,
no proposal, a true sentence — must still pass through untouched.
