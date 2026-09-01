---
id: B68
title: A journal guest is push-notified about a private trip they cannot open
type: ISSUE
priority: medium
complexity: low
area: push, trips, digest
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
---

# B68 — A journal guest is push-notified about a private trip they cannot open

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

**Correction, on reading the file.** That sentence is no longer there: `git log
-S` puts its removal in `aeb3b6e`, the B39 commit this task was found during.
So B39 deleted the claim and left the gap, and what was above the function when
this was built was a comment that simply never mentioned `private` at all —
less wrong and no more useful. The third Work item below is done anyway,
because a doc comment that lists two of the three questions the code asks is
how the third goes on being forgotten.

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

### The answer on `people:`, written before building it

**No, and not here.** They get nothing, and that is the accepted cost.

The mechanical reason is the one the Work item names: a subscription carries a
`contactId`, `isPersonOn` matches an *address*, and turning one into the other
means resolving a contact record — which `lib/push.ts` deliberately cannot do.
It does not import `lib/contacts` (W10, docs/plans/W12-push.md), and the
addresses it would have to decrypt to make the match are exactly what that
boundary exists to keep out of the notify path.

The reason it is not merely mechanical: the digest already refuses `private`
for its own travellers, on its own stated grounds — *"they can open it, but the
digest is addressed by contact and has no way to know a contact is also a
traveller"*. Push is addressed by device, which knows less, not more. Two
surfaces answering the same question the same way is worth more than a handful
of people on `people:` getting a notification about a trip they wrote.

If it is ever wanted it is a design — subscriptions would need to carry
something that identifies a traveller — and it is not this task. Asserted as a
cost rather than left to be rediscovered: `test/push.test.ts` has the case.

### Captured, not absorbed

**B82** — `subscribersFor` does its own `access_grants` lookup and never asks
`grantIsLive`, so an **expired** grant still notifies. `lib/grants.ts` is "the
one place that decides" and push is the only reader of that table that does not
ask it. Nothing writes a non-null `expires_at` today, which is the only reason
it is not live; B41 recorded that the answer must change for every surface at
once, and this one does not. Its fix is to *remove* the local query in favour
of `contactsWithReadGrant`, which is a different change from this one.

## Acceptance

- `subscribersFor` returns `[]` for a `visibility: private` trip, with a
  contact who is active, granted and subscribed — the case that fails today.
- A test that would have caught it, beside the existing `guest` cases in
  `test/push.test.ts`.
- The four checks.

### Where it is asserted

Beside `test/push.test.ts`, push becomes the **fourth column** of the table in
`test/access-gate.test.ts` — `panel`, `read`, `digest`, `push` over every
viewer and every trip, including the two `test: true` trips B70 added. B41
built that table for the panel, B52 added the digest, and push was the last
surface still answering "may this person be told about this trip" on its own.

One table now answers *which surfaces may mention which trips to whom*, and two
properties are derived from it rather than restated: nothing the panel mentions
is refused by the gate, and nothing the digest or push announces is refused by
the gate. The one deliberate disagreement between the two announcing surfaces —
push reaches an unlisted `public` trip and the digest does not — is pinned by
its own test, with the reasoning, so that "making them consistent" has to
argue with something.
