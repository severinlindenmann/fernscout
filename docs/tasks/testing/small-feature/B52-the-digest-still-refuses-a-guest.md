---
id: B52
title: The digest still refuses a guest trip to a reader who can now open it
type: FEATURE
priority: medium
complexity: low
area: digest, access
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-05T08:24:22Z"
---

# B52 — The digest still refuses a guest trip to a reader who can now open it

## Why

`lib/digest/visibility.ts` excludes every non-public trip from a digest, and its
own comment says why and when that should change:

> Until identified access can actually unlock the gate, a line about one of
> these trips would be a link to a door the reader has no key for. When that
> lands, this function is the single place that changes.

B41 landed it. An approved contact holding a live `read` grant now opens a
`visibility: guest` trip (`mayReadTrip`, `lib/tripGate.ts`), so a digest line
about one would lead somewhere they can actually read. The file's comment was
updated to say the rule is now deliberate rather than forced; `digestableTrips`
itself was left alone.

The cost of leaving it: the owner writes up a `guest` trip for exactly the
people they invited, and the mail that exists to tell those people about new
days says nothing about it. They are told about the public trips and left to
discover the one that was written for them.

The reason it was not done in B41: it changes what lands in somebody's inbox.
That is the owner's decision about their own readers, not a side effect of
fixing a gate, and `digestableTrips` is the function whose stated rule is *"a
digest never contains a line about a trip the reader cannot open"* — widening it
deserves its own look.

### Corrected before building (B39 landed after this was written)

Three things in the original text were already out of date, and are fixed above
and below rather than left to mislead:

- **There is no password anywhere.** This said a grant opens a guest trip "with
  no password", and the acceptance said a reader lands on the trip "rather than
  a password form". B39 removed trip passwords entirely — `lib/access.ts` keeps
  only `visibility` predicates and `accessSecret()`, and the gate a refused
  reader meets is a sign-in prompt. `digestableTrips` had already been rewritten
  by B39 too: the `password` case it once refused outright no longer exists as a
  concept, and the code excluded `guest` and `private` together, with a comment
  naming B52 as where that is revisited.
- **The line numbers had moved.** `digestableTrips` was at
  `lib/digest/visibility.ts:39`, not `:37`; `runDigest` calls it at
  `lib/digest/index.ts:188`, not `:151`. Neither is quoted below any more —
  both files are small and the function names are unambiguous.
- **The fixture the tests needed did not exist.** `test/digest.test.ts` had a
  `guest` trip called `locked-2026` and titled "Private trip", and no actually
  `private` one, so "no reader ever gets a line about a `private` trip" was not
  being tested at all. Renamed and a real `private` trip added.

## Work

- `digestableTrips` (`lib/digest/visibility.ts`) sends a `guest` trip to a
  reader holding the grant, exactly as it already sends an unlisted public one.
  `private` stays never, for everyone, whatever else changes.
- The reader's grant is already in hand: `runDigest` (`lib/digest/index.ts`)
  fetches `contactsWithReadGrant` for the whole run and passes `granted` per
  contact.
- The doc comment at the top of the file is the specification; rewrite it to
  match rather than leaving the old three-case list beside new behaviour.
- Check `test/digest.test.ts`, which pins the current exclusion and states it as
  a rule.

Not doing: `private` trips, push notifications (`lib/push.ts` draws its own
line — and misses a case of its own, which is B68), or anything about what a
digest line *says* about a guest trip.

## What was found while building it

**The rule is a relation between two files, so the test has to be.** "A digest
never contains a line about a trip the reader cannot open" cannot be asserted
inside `test/digest.test.ts`, which knows nothing about `mayReadTrip`. It is now
asserted where both sides already exist: `test/access-gate.test.ts` builds a
table of every viewer against every visibility and pins the gate to it, and a
new block there runs `digestableTrips` for the same viewers and requires its
output to be a subset of what the gate opens — checked against the live
`mayReadTrip` *and* against the table, so a gate that started saying yes to
everything could not make it pass. The two positive assertions beside it (an
approved reader is told about the guest trip; an ungranted reader is told only
about the public listed one) are what stop the subset being satisfied by
mentioning nothing.

**The two sides are joined by one word, and it means slightly different things.**
`granted` here is a live `read` grant (`contactsWithReadGrant`); at the gate it
is `isJournalGuest`, which is an **active** contact holding a live grant.
`planDigest` skips every contact that is not `active` before it reaches
`digestableTrips`, which is what closes the gap. Revoking clears both together
so they do not come apart in practice, but the digest's half is the looser one
and the status check above it is load-bearing. Said in the file's comment, and
mirrored in the test's `grantedFor`.

**`private` is refused even for somebody who was on the trip.** `mayReadTrip`
lets a traveller into their own `private` trip; the digest still says no,
because it is addressed by contact and has nothing that could tell it a contact
is also on `people:`. That keeps the subset property true and fails in the safe
direction. Asserted.

**A second problem, not absorbed:** `digestableTrips` never asks whether a trip
is `test: true`. `isIndexable` is the only place that flag is honoured, so a
test trip falls into the "not advertised" branch and is mailed to every granted
reader — content nobody lived, in a mail with no banner and nowhere to put one.
Captured as **B70**, which also names the same gap in `lib/push.ts`. Widening to
`guest` here extends the reach of that bug, which is the argument for fixing it
soon rather than the argument for fixing it in this task.

Also captured: **B71**, an order-dependent assertion in
`test/media-upload.test.ts` and a single unreproduced failure of it, unrelated
to this work.

## Acceptance

- A reader with a live `read` grant gets a digest line for a `visibility: guest`
  trip, and following it lands on the trip rather than the gate. *(The second
  half was written as "rather than a password form"; B39 removed passwords, so
  what the reader must not meet is the sign-in gate.)*
- A reader without one gets no line about it — the existing property, unchanged.
- No reader ever gets a line about a `private` trip.
- The comment at the top of `lib/digest/visibility.ts` describes the rule that
  is implemented.
