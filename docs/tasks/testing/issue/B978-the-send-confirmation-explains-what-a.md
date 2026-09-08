---
id: B978
title: The send confirmation explains what a credit is worth, on a day page nobody asked about pricing on
type: ISSUE
priority: medium
complexity: low
area: day page, owner tools
found: "2026-09-08T16:10:26Z"
merged: "2026-09-08T16:20:32Z"
---

# B978 — The send confirmation explains what a credit is worth, on a day page nobody asked about pricing on

## Why

The panel that asks "send this day to your readers?" carries a second
paragraph explaining the unit — "a credit is worth about CHF 0.20; 50 cost
CHF 10.00" (`components/DayNotify.tsx`, the `credits.worth` line, added by
B806). It was added because a tester did not know what a credit was and put
the phone down rather than press a button that would cost twenty rappen.

The owner's judgement now is that it reads as pricing copy in the middle of a
travel journal. The question the panel asks is already answered in its own
first line — what this send costs, and what is left afterwards — which is the
part that stops somebody guessing. The unit belongs where credits are bought,
on `/<user>/me`, not on a day page.

## Work

Drop the `credits.worth` paragraph from the confirm panel in
`components/DayNotify.tsx`. Leave the cost/balance sentence, which is the
part that answers the actual question, and leave the "not enough credits"
state with its link to `/<user>/me`.

Not doing: removing `creditWorth()` itself or the `credits.worth` string —
`/<user>/me` uses both, and that is where the explanation belongs.

## Acceptance

Press "Leser informieren" on a day as the owner: the panel shows the cost
and the remaining balance and no sentence about what a credit is worth.
`npm run verify` green.
