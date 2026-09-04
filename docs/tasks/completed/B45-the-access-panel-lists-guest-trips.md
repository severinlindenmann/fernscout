---
id: B45
title: The access panel lists guest trips the reader cannot actually open
type: ISSUE
priority: medium
complexity: low
area: viewer, access
found: "2026-09-01"
started: "2026-09-03T19:23:10Z"
merged: "2026-09-03T19:34:28Z"
completed: "2026-09-04T06:18:50Z"
---

# B45 — The access panel lists guest trips the reader cannot actually open

## Why

`test/viewer.test.ts` states the property the access panel is supposed to have:

> The property that matters is that the panel never widens access: it reports
> what `mayReadTrip` would already allow, and being told about a trip you
> cannot open is the same leak as showing it in a list.

It does not hold for a `visibility: guest` trip. `resolveViewer`
(`lib/viewer.ts`) lists one for any active contact; `mayReadTrip`
(`lib/tripGate.ts:26`) lets nobody into one without the trip password cookie,
because the only doors it knows are `isTravellerOn` and `verifyTripToken`.
Being an approved contact is not one of them.

So an approved reader opens `/<user>/me`, is told "Vietnam 2026 — guest, you
were invited", clicks it, and lands on a password box. That is precisely the
harm `lib/digest/visibility.ts` refuses to cause on the other surface — *"a
mail saying '3 new days in Vietnam' that leads to a password box is worse than
no mail"* — and the access panel does it on every page load.

Found while building B35, which removed the per-trip arm of the same
condition. B35 did not change this: the arm it removed was dead, and the panel
listed guest trips to active contacts before and after. The over-report is
older than both.

## Work as first written — superseded

> Two shapes, and which one is right depends on B41 and B39. If neither lands
> first, the narrow fix is for `resolveViewer` to ask the same question
> `mayReadTrip` asks. Check the sibling surfaces while here: `listableTrips`
> and the trip switcher draw a similar distinction and may have the same gap.

B41 landed first, and took the first shape. What actually happened is below.

## What was true when this was written, and what is true now

The **Why** above was accurate on 2026-09-01 and is now history. B41 landed in
between and took the first of the two shapes the Work section predicted:
`mayReadTrip` (`lib/tripGate.ts:58`) asks `isJournalGuest`, which is the same
call `resolveViewer` makes, so an approved contact opens a `visibility: guest`
trip with nothing but a session cookie. B39 then removed the trip password, so
`verifyTripToken` is gone entirely and the grant is the only door. The reported
symptom — told about a trip, handed a password box — cannot happen any more.

`test/access-gate.test.ts` already held the panel and the gate to a table over
every viewer and every visibility, and derived the never-widens property from
it. `test/viewer.test.ts`'s docstring was already rewritten to point at that
table rather than merely claim the property.

**So this task was closed by verification, and one thing the earlier note
claimed was not actually true.** That note said the table "states that
exception and asserts it is the only one" about `listableTrips`. It did not.
`listableTrips` had no column in the table at all — it was spot-checked in two
places (a stranger sees no more signed in than out; a journal guest is refused
a private trip) and was otherwise unheld. The Work section named it explicitly
as the sibling surface to check, so the remaining work was to check it the way
the panel is checked.

## Work

Test-only. No production code changed; `lib/viewer.ts`, `lib/tripGate.ts` and
`lib/digest/visibility.ts` are untouched, because none of them was wrong.

- **`switcher` is now a column of the table** in `test/access-gate.test.ts`,
  filled for all seven viewers × seven trips and asserted against the real
  `listableTrips` called the way `app/[user]/layout.tsx` calls it — once over
  the whole journal, not once per trip, so the single grant lookup it does for
  the list is the thing under test. Two derived assertions follow the panel's:
  nothing the switcher advertises is refused by the gate, and the only trip the
  gate opens without the switcher listing it is `quiet-2026`, the `public` trip
  with `listed: false`. That exception is now asserted rather than described.
- **A buddy-link reader is a new block.** Everything else in the file reaches a
  trip through the file on disk or a journal-wide grant. A redeemed place
  (B33) is the third door, and the panel and the gate reach it by *two
  different queries* — `redeemedTripsFor` for the panel and the switcher,
  `redeemedPeopleOf` for the gate. Two queries answering one question is the
  exact shape this task reported, and nothing was holding them together. The
  block asserts the positive (the one private trip opens, and the panel says
  `traveller`, not `guest`), the negative that carries the weight (`robins-2026`,
  the journal's *other* private trip, is refused and named by neither surface,
  even though this reader holds a live journal grant *and* a live place
  elsewhere), and revocation (revoking the place stops all three surfaces
  together while the journal grant, and so the `guest` trip, survives).

## What that turned up

The buddy block is not decoration. Deleting the `revoked_at` filter from
`redeemedTripsFor` (`lib/tripPeople.ts:140`) — so the panel and the switcher
keep advertising a place the gate has stopped honouring, which is precisely
this task's bug in the one place the two sides run different SQL — passes the
entire pre-existing suite: 110 files, 1785 tests, 0 failures. With the new
block it fails. The equivalent mutation on the read side (`listableTrips`
forgetting that `private` is nobody else's) fails five tests, two of which are
the new switcher column.

## Acceptance

- A reader who cannot open a trip is not told it exists — for every value of
  `visibility`, and demonstrated against the real `resolveViewer` (the
  `describe` added in B35 runs it against a database and a session).
- `test/viewer.test.ts`'s stated property is either true or rewritten to say
  what is actually guaranteed.
- Closing this by verifying B41 or B39 already fixed it is a valid outcome, and
  the note saying so belongs in this file.

## Not in scope, and checked

`listableTrips` does not filter `test: true` trips, so `proving-2026` and
`proving-guest-2026` appear in the switcher for anyone who may read them. That
matches the panel, which has always listed them, and it is consistent with the
B70 decision: containment of invented content is about the surfaces that speak
*unasked* — the digest, push, the feed, the sitemap — and the trip page carries
a banner. The table now states it rather than leaving it unexamined. No task
captured; nothing was found that needed one.

An agent does not move anything to `completed/`.
