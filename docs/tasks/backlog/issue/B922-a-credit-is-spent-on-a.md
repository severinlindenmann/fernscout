---
id: B922
title: Was she charged for a day that was never written, and should she have been?
type: ISSUE
priority: high
complexity: low
area: agent, credits
found: "2026-09-08T07:08:54Z"
---

# B922 — A credit is spent on a write that failed

## Why

A 71-year-old's balance went from **10 to 8** for a day that was never written.
The model handed back a wrong trip id twice, the write failed underneath the
prose, and two credits had gone.

**Read again with the code in front of it, the title was wrong**, and the
correction matters because it changes what — if anything — to build:

- **Nothing charges for a write.** `spend()` appears in four helper routes and
  every one of them is a *model call*: `write-day`, `describe-photos`,
  `statement`, `transcribe`. Saving a day, publishing one, adding a cost and
  taking a day down are all free.
- **An abandoned proposal already charges nothing**, which is what B891
  promised. The spend is inside the route, and the route runs on the press —
  so a proposal read and walked away from costs nothing, and the card says
  *"it costs 1 credit"* before the button is touched.
- **All four refund when the provider fails.** Each one wraps the call and
  calls `refund` on a throw.

So what she was charged for was two drafting calls that **succeeded** — the
prose came back — and then did not land, because of the trip-id fault that
B935 and B936 fixed. The money went on work that was really done, and the
reason it was wasted is a bug that no longer exists.

## The question that is left, and it is a person's

B891 says *"the credit belongs to the write, not to the asking."* Drafting is
the one place those come apart: the model has run and the operator has paid,
and the words may still never be kept — because she read them and did not like
them, which is exactly the reading-back this product is built around.

Three answers, and this ticket cannot pick one:

- **Leave it.** The call was made, the cost is real, and the card says so
  before she presses. The rule gains one named exception, written down.
- **Refund words that are never kept.** Honest to B891 as written, and it
  makes reading a draft free — but nothing knows when somebody has "decided",
  so it would mean refunding on a timer or on the conversation ending.
- **Make drafting free and meter something else.** The operator eats the model
  cost for the one call the product exists for.

## Work

None until that is answered. What can be done now is the smaller half: the
ledger should make a refund legible as one, so *"where did my credits go"* has
an answer — that stands whichever way the question goes.

## Acceptance

A decision written into this file, and B891 updated so the two agree.
