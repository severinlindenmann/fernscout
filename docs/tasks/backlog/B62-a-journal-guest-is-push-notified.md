---
id: B62
title: A journal guest is push-notified about a private trip they cannot open
type: ISSUE
priority: medium
complexity: low
area: push, trips, digest
found: "2026-09-01"
---

# B62 — A journal guest is push-notified about a private trip they cannot open

## Why

`subscribersFor` (`lib/push.ts:87`) asks two questions and skips a third. It
lets everybody through for a trip that `isOpenToLink`, and otherwise takes any
subscription tied to an active contact holding a `read` grant. It never asks
what kind of closed trip this is.

A `read` grant is journal-wide and means *this person may read the journal's
`guest` trips*. It has never meant a `private` one — `mayReadTrip`
(`lib/tripGate.ts`) refuses a `private` trip to a journal guest before it looks
at anything else, and `isGuestOf` refuses it for costs on the same grounds.
So a family member approved into the journal, subscribed to notifications, is
sent a push about a `private` trip whose page then refuses them.

That is the exact harm `lib/digest/visibility.ts` was written to prevent, in
its own words: *"a digest never contains a line about a trip the reader cannot
open… it tells somebody something private exists and then refuses them, which
is the one thing a private trip is for."* The digest guards it; push does not.

The comment above `subscribersFor` even claims the case is impossible — *"a
trip that the people let in should not hear about is `visibility: private`,
which never reaches this function"* — and nothing enforces that. `notify` calls
it with whatever trip an entry belongs to.

Found while removing trip passwords (**B39**), which is why the comments in
that file talk about passwords: the grant check was already there and correct
for `guest`, and the missing `private` case was never the password's fault.

## Work

- One line at the top of `subscribersFor`: a `private` trip has no eligible
  subscribers, because there is no record anywhere of who was on it other than
  `people:`, and a subscription is not tied to an address.
- Consider whether `people:` should get notifications for their own `private`
  trip. Probably yes and probably not here: a subscription carries a
  `contactId`, not the address `isPersonOn` matches, so it needs a real answer
  rather than a guess. Say which in this file before building it.
- The doc comment above the function asserts the bug away. Rewrite it to
  describe what the code does.

## Acceptance

- `subscribersFor` returns `[]` for a `visibility: private` trip, with a
  contact who is active, granted and subscribed — the case that fails today.
- A test that would have caught it, beside the existing `guest` cases in
  `test/push.test.ts`.
- The four checks.
