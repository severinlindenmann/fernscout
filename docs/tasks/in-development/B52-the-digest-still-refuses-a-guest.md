---
id: B52
title: The digest still refuses a guest trip to a reader who can now open it
type: FEATURE
priority: medium
complexity: low
area: digest, access
found: "2026-09-01"
started: "2026-09-01"
---

# B52 — The digest still refuses a guest trip to a reader who can now open it

## Why

`lib/digest/visibility.ts` excludes every non-public trip from a digest, and its
own comment says why and when that should change:

> Until identified access can actually unlock the gate, a line about one of
> these trips would be a link to a door the reader has no key for. When that
> lands, this function is the single place that changes.

B41 landed it. An approved contact holding a live `read` grant now opens a
`visibility: guest` trip with no password (`mayReadTrip`, `lib/tripGate.ts`), so
a digest line about one would lead somewhere they can actually read. The file's
comment was updated to say the rule is now deliberate rather than forced;
`digestableTrips` itself was left alone.

The cost of leaving it: the owner writes up a `guest` trip for exactly the
people they invited, and the mail that exists to tell those people about new
days says nothing about it. They are told about the public trips and left to
discover the one that was written for them.

The reason it was not done in B41: it changes what lands in somebody's inbox.
That is the owner's decision about their own readers, not a side effect of
fixing a gate, and `digestableTrips` is the function whose stated rule is *"a
digest never contains a line about a trip the reader cannot open"* — widening it
deserves its own look.

## Work

- `digestableTrips` (`lib/digest/visibility.ts:37`) sends a `guest` trip to a
  reader holding the grant, exactly as it already sends an unlisted public one.
  `private` stays never, for everyone, whatever else changes.
- The reader's grant is already in hand: `runDigest` (`lib/digest/index.ts:151`)
  fetches `contactsWithReadGrant` for the whole run and passes `granted` per
  contact.
- The doc comment at the top of the file is the specification; rewrite it to
  match rather than leaving the old three-case list beside new behaviour.
- Check `test/digest.test.ts`, which pins the current exclusion and states it as
  a rule.

Not doing: `private` trips, push notifications (`lib/push.ts` draws its own
line), or anything about what a digest line *says* about a guest trip.

## Acceptance

- A reader with a live `read` grant gets a digest line for a `visibility: guest`
  trip, and following it lands on the trip rather than a password form.
- A reader without one gets no line about it — the existing property, unchanged.
- No reader ever gets a line about a `private` trip.
- The comment at the top of `lib/digest/visibility.ts` describes the rule that
  is implemented.
