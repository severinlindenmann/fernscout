---
id: B363
title: The letter's permission gate is a second copy of the site's, and nothing holds them together
type: CHORE
priority: medium
complexity: medium
area: mail, access
found: "2026-09-04T20:22:13Z"
started: "2026-09-07T11:40:29Z"
merged: "2026-09-07T12:12:23Z"
---

# B363 — The letter's permission gate is a second copy of the site's, and nothing holds them together

## Why

B345 needed to ask "may this *address* be sent this day's letter" with no
request and therefore no cookie, while `mayReadTrip`/`mayViewCosts`
(`lib/tripGate.ts`) answer "may this *session* read this trip". It restated
both as `mayMailTrip` and `mayMailCosts` in `lib/digest/dayLetter.ts`.

Checked faithful when written:

- `mayMailTrip` = `isOpenToLink || traveller || (not private && granted)`,
  which is `mayReadTrip`'s branch order with `isTravellerOn` and
  `isJournalGuest` supplied as booleans.
- `mayMailCosts` = `isEnabled("costs") && (costsVisibility === "public" ||
  isGuestOf)`, which is `maySeeCosts(trip, isGuestOf(trip))` inlined.

**Faithful when written is what every drift in this codebase was.** B263, B277
and B294 all shipped because one fact lived in two places and one copy moved.
`test/day-mail.test.ts` pins the behaviour these two produce — including that a
`private` trip's letter reaches the people on it and not a journal guest — but
it never compares them against `lib/tripGate.ts`. So somebody who changes
`mayReadTrip` gets a green suite and a mail gate that quietly disagrees with
the site, and the failure is a letter carrying somebody's words and their spend
to a reader the site would refuse.

The comment above the two functions now says exactly this, and names this
ticket. That is a stopgap, not a fix.

## Work

Two ways, and the second is better if it is reachable.

1. **Pin them with a test.** A table over `{visibility, costsVisibility,
   traveller, granted}` — every combination — asserting `mayMailTrip` agrees
   with `mayReadTrip` and `mayMailCosts` with `mayViewCosts` for the same
   person. That needs the session functions driven with a mocked cookie;
   `test/draft-audience.test.ts` already builds exactly that harness for
   `draftsVisibleTo`, so copy its shape rather than inventing one.
2. **Remove the duplication.** The two pairs differ only in where the two
   booleans come from — a session, or a contact row. A shared pure core taking
   `(trip, isTraveller, isGuest)` that both wrappers call would leave one copy
   of the rule and no test needed to hold two together. Read
   `lib/access.ts:77` (`maySeeCosts`), which is already exactly that shape for
   costs, and ask why the read gate is not.

Prefer 2. If it turns out the session wrappers cannot be reduced to it without
contortion, do 1 and write down what stopped you.

## Acceptance

Either one function decides who may read a trip and the mail path calls it, or
a test fails when the two disagree about any combination of visibility,
travellership and grant.

## Found and fixed (2026-09-07)

Read `lib/digest/dayLetter.ts` and `lib/tripGate.ts`/`lib/access.ts` in full.
The Why's description of both pairs still matches the code exactly:
`mayMailTrip` is `isOpenToLink || traveller || (not private && granted)`, and
`mayMailCosts` is `isEnabled("costs") && (costsVisibility public ||
traveller || (not private && granted))` — the same shape `maySeeCosts(trip,
isGuestOf(trip))` inlines. Neither had moved since the ticket was filed;
`test/day-mail.test.ts` still only pins their own output, never comparing
against `lib/tripGate.ts`.

**Chose 1 (the parity test), not 2 (extraction), matching the instruction to
prefer the smaller change unless extraction is obviously clean — it is not.**
The two pairs cannot be reduced to one shared pure core without a change of
behaviour, not just of shape: `recipientsFor` (the mail side) includes the
owner's own copy *before* either wrapper is ever called — unconditionally,
for free, and without asking either function — while `mayReadTrip` and
`isGuestOf` each have their own `isOwner` branch baked into the same function
that does the traveller/guest logic. A shared `(trip, isTraveller, isGuest)`
core would need a fourth boolean (`isOwner`) threaded through both call
sites, and the mail side would have to pass `false` for a case that never
actually reaches it — a parameter kept alive for a caller that cannot use it.
That is the "contortion" the ticket asked to name rather than build around.

Built `test/day-mail-parity.test.ts` instead: a table over every
`{visibility, costsVisibility}` combination and three viewers (a traveller, an
approved journal guest, a signed-in stranger — the owner is excluded, and the
test's own comment says why), asserting `mayMailTrip(trip, isTraveller,
granted)` equals `await mayReadTrip(trip)` and `mayMailCosts(trip,
isTraveller, granted)` equals `await mayViewCosts(trip)` for the same
session, for every row. `mayMailCosts` was not exported before this — exported
it (with a comment saying why) so the test calls the real function rather
than re-deriving its formula, which would not have caught drift in the
formula itself.

Verified by hand that the test catches drift: temporarily removed the
`trip.visibility === "private"` branch from `mayMailTrip` and the suite failed
on exactly the rows that branch protects (`guest` viewer on a `private`
trip), then restored it and confirmed all pass.

Updated the doc comment above both functions in `dayLetter.ts` to point at
the new test instead of the nonexistent "B346" placeholder, and to say
explicitly why extraction was not the choice.

`npm run verify` passes. No OpenAPI change — this is entirely inside the mail
layer.
