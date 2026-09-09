---
id: B953
title: A button that is not there stopped being caught when anything had been written
type: ISSUE
priority: high
complexity: low
area: helper, honesty
found: "2026-09-08T11:33:50Z"
started: "2026-09-08T11:34:08Z"
merged: "2026-09-08T11:40:48Z"
completed: "2026-09-09T16:47:24Z"
---

# B953 — A button that is not there stopped being caught when anything had been written

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

**I did this four hours ago, in B944.** The condition was:

```ts
if (proposals.length === 0 && claimsWhatIsNotThere(answer)) return "claim";
```

and `claimsWhatIsNotThere` answers for two things: a write that did not happen
(B920) and a button that is not on the screen (B928). B944 narrowed it to

```ts
if (written.size === 0 && proposals.length === 0 && claimsWhatIsNotThere(answer))
```

because B943 had shown the check firing on a **true** sentence about a press
that really happened. That reasoning is correct — and it is only about the
*write* half. A claim that there is a button, made on a turn that proposed
nothing, is false whatever the conversation has written before.

So in any session where anything at all had been written — which is every
session past its second minute — *"press the button"* with `proposals: []`
stopped being caught.

Found immediately, by somebody writing up a fifteen-day trip:

> at least three times the answer asserted "a proposal is on your screen" /
> "press the button" while `"proposals": []` and `blocks` held no form —
> nothing was actually offered. Required an explicit "I don't see a button,
> show it again" to get the real proposal.

B928 is the ticket that exists because this sends a person hunting for a
control that is not there, and it was reintroduced by the fix for its
neighbour.

## Work

Split the matcher the rest of the way. B944 already carved out `claimsAWrite`;
the button half needs the same, and then the two conditions are different
because the claims are different:

- a **button** claim is false whenever the turn proposed nothing, full stop;
- a **write** claim is false when the turn proposed nothing *and* this
  conversation has written nothing.

Not doing: reverting B944. Both directions it fixed are still right.

## Acceptance

A test with a `written:` note in the thread, no proposal, and an answer saying
the button is below: it must be caught. Beside B944's own case, which must
still pass.
