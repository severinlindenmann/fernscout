---
id: B363
title: The letter's permission gate is a second copy of the site's, and nothing holds them together
type: CHORE
priority: medium
complexity: medium
area: mail, access
found: "2026-09-04T20:22:13Z"
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
