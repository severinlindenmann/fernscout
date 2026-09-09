---
id: B922
title: Was she charged for a day that was never written, and should she have been?
type: ISSUE
priority: high
complexity: low
area: agent, credits
found: "2026-09-08T07:08:54Z"
started: "2026-09-08T19:11:43Z"
merged: "2026-09-08T19:44:27Z"
completed: "2026-09-09T16:46:56Z"
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

## The decision

**Leave it.** Drafting stays chargeable at the model call, whether or not the
words are kept, and this is written down as the answer rather than left open.

The trace that decides it: `app/api/helper/[user]/day/write-day/route.ts`
spends `WRITE_DAY_CREDITS` immediately before calling `writeDay()` (the model
call), refunds only if that call *throws* (`lib/helper/model.ts` failing
outright), and never refunds because the person read the draft and did not
like it. `describe-photos`, `statement` and `transcribe` are the same shape.
The disk write itself — `PATCH` on the day, or (once B891 ships) the
proposal's accept — costs nothing at all; it never called `spend` and never
will. So the credit was never priced against "did this end up in the
journal" — it is priced against "did a provider get called and answer",
which is the one event with a real, sunk cost attached. That was already true
before this ticket; B922 only found that it disagreed with a sentence in
B891 (below), not that it was wrong.

Why not the other two:

- **Refund words that are never kept** has no signal for "decided". This
  helper has no session state marking a draft read-and-discarded versus
  read-and-still-pending — B889 gave it a thread, not a decision log — so
  refunding would mean a timer or a guess, either of which is a new kind of
  claim (`AGENTS.md`'s "a claim is checked against the turn"), and neither
  turn tells you what a person did with a screen they closed.
- **Make drafting free, meter something else** moves the entire cost of the
  one call the product exists for onto the operator, with only
  `lib/rateLimit.ts` as a backstop (20 calls / 15 min here) rather than the
  ledger's own `balance >= n` guard. A rate limit bounds a script; it does not
  bound a provider bill the way a credit does, and B891's own "cost is good"
  approval was about *whether a conversation costs anything before a write*,
  not about whether the drafting call itself should stop being priced.

**What was actually true of the 71-year-old's two credits**, restated: they
bought two real model calls that answered correctly, and were then wasted by
a trip-id bug (B935/B936) that is fixed. Under this decision that spend was
correct *as spend* — the model did the work and the operator paid the
provider for it — the loss was the bug, not the charge.

**What changed instead, and it is the legible half the ticket asked for
regardless of which way the big question went:** `spentByReason()` in
`lib/credits.ts` used to make a refunded call invisible — a `helper` spend
that was later refunded showed identically to one that was not, because the
grouping only ever summed `delta < 0` rows and a refund is `delta > 0`. Now it
also sums `reason = "refund"` and appends `{ reason: "refunded", credits: n }`
as its own line when nonzero, so "Where credits went" on `/[user]/account`
(and the admin journal panel) shows both what was charged *and* what came
back, rather than only the former. `test/credits.test.ts` has the new case
(`B922: a refund shows as its own line...`) and the pre-existing grouping
test now expects the third row.

## Work (done)

- `lib/credits.ts`: `spentByReason` appends a `refunded` line, summed
  separately, never netted into the reason it came from.
- `site/locales/{en,de,hu}.json` + `lib/i18n.ts` (regenerated): a
  `me.spentReason.refunded` string in each locale.
- `app/admin/page.tsx`: `REASON_LABEL.refunded` for the operator's own view of
  the same breakdown.
- `test/credits.test.ts`: updated the existing grouping test, added a
  dedicated one for the refunded-call case this ticket is about.
- No change to `spend`/`refund`/the four helper routes — the charge point is
  unchanged, on purpose, per the decision above.

## Acceptance

A decision written into this file, and B891 updated so the two agree. — done:
see "The decision" above; B891's charging section now says explicitly that
the model call is the chargeable event, not the later accept, and that the
ledger names a refund as its own line.
