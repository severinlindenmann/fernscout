---
id: B35
title: Per-trip read grants are honoured in three places and written by nothing
type: CHORE
priority: medium
complexity: low
area: contacts, digest, push, db
found: "2026-09-01"
---

# B35 — Per-trip read grants are honoured in three places and written by nothing

## Why

`access_grants.trip_id` (`lib/db/schema.ts:154`) is documented as *"a trip id,
or `*` for every trip"*, and three read paths honour a specific id:

- `resolveViewer` — `guest || grants?.has(trip.id)` (`lib/viewer.ts:94`)
- `digestableTrips` — `granted.has("*") || granted.has(trip.id)`
  (`lib/digest/visibility.ts:37`)
- `subscribersFor` — `.where("trip_id", "in", [trip.id, "*"])`
  (`lib/push.ts:109`)

**Nothing writes one.** `approveContact` (`lib/contacts/index.ts:546`) is the
only insert in the codebase and it always writes `*`; `lib/contacts/invites.ts:71`
writes `trip_id: null` into `contact_invites` and never reads it back. The
comment at `lib/contacts/index.ts:544` says why — *"Per-trip grants are W09's
job"* — and W09 shipped the password gate instead. So the granularity has been
sitting there unbuilt long enough that the codebase now documents it as a
placeholder rather than as a plan.

B33 settles the question it was waiting on, and settles it the other way: **a
guest is a guest of the journal, not of a trip.** Somebody let in sees every
trip they would see as an approved contact, and a trip that must be held back
from them is `visibility: private`. There will be no per-trip guest link and no
per-trip grant write path.

That makes this more than tidiness. Whoever builds B33 will open `lib/viewer.ts`
and `lib/digest/visibility.ts` — those are exactly the files it touches — read
`grants?.has(trip.id)`, and reasonably conclude that per-trip guest scoping is a
supported thing they should preserve or extend. The dead arm is positioned to
cause the wrong turn in the one task most likely to trip over it. Two tests make
it look load-bearing on top of that: `test/push.test.ts:189` is named *"a grant
naming this trip specifically covers it"*, and its neighbour asserts that a
grant for another trip does **not** cover this one — both constructing rows by
hand that no production path can produce.

Do this before B33, or as its first commit. Not after: the point is to remove
the misleading thing before somebody reads it.

## Work

Collapse the grant to what it actually means — this contact may read this
journal's guest trips.

- Drop the `trip_id` arms from the three read paths above, so a `read` grant is
  simply present or absent.
- `readGrantsByContact` (`lib/digest/visibility.ts:49`) returns
  `Map<contactId, Set<tripId>>`. With no per-trip grants it wants to be a set of
  contact ids, and its two callers (`lib/digest/index.ts:151`, `lib/viewer.ts:71`)
  simplify with it. Change the signature rather than leaving a set that only
  ever holds `"*"`.
- Rewrite the two tests in `test/push.test.ts` around 170–210 and the row built
  at `test/digest.test.ts:208`. The negative case is still worth keeping in some
  form — *a contact without a grant is not told about a guest trip* — it just
  should not be expressed through a trip id.
- `contact_invites.trip_id` (`lib/db/schema.ts:142`) is written `null` and never
  read. It goes the same way.

One decision to make and record here before writing the migration:

- **Drop the columns, or leave them and document them as unused?** Dropping
  means a new numbered migration (the pattern is `lib/db/migrations/005-signin-link.ts`)
  that also rebuilds `access_grants_unique`, which is currently
  `(owner_id, contact_id, trip_id, scope)` (`lib/db/migrations/001-initial.ts:97`)
  and would become `(owner_id, contact_id, scope)` — and that new index will
  collide on any deployment that already holds two grants for one contact.
  Nothing produces such rows today, but the migration should still decide what
  it does if it finds them rather than failing halfway. Leaving the column is
  cheaper and keeps the door open if per-trip access is ever wanted back; it
  also leaves a column whose stated meaning nothing honours, which is how this
  task came to exist. Lean to dropping.

**Superseded by B39, which removes trip passwords outright.** The paragraph
below is kept as written because it is the argument that lost, and a reversed
decision with no trace of the reasoning gets re-proposed. What it got wrong:
the anonymous door it defends is the one that cannot be revoked, and for this
audience an address is not a burden but the only thing that makes "let this
person in, and not that one" possible. B39 replaces the password with the
sign-in flow that already exists.

Not doing: **trip passwords.** `passwordHash`, `signTripToken`, the unlock form
and `app/api/trip-access/route.ts` are also per-trip guest access, and they stay.
They are a different mechanism — anonymous, no contact record, no database row —
and they are the door for somebody who will not prove an email address, which is
most of the audience this is built for. `visibility: guest` currently *requires*
a hash (`assertTripAccessConfig`, `lib/access.ts:206`), so removing them would
redefine what `guest` means; that is a design change and would be its own task,
not a cleanup. After B33 a `guest` trip has two doors, one anonymous and one
identified, and that is intended.

## Acceptance

- No path in `lib/` reads or writes `access_grants.trip_id` or
  `contact_invites.trip_id`.
- `grep -rn "trip_id" lib/ | grep -v migrations` returns nothing if the columns
  are dropped, and only the two `schema.ts` declarations if they are kept.
- The decision on dropping the columns is written in this file, and if they are
  dropped a migration exists and `test/db-migrations.test.ts` covers it.
- A contact with a grant is still told about guest trips in the digest, still
  sees them in `resolveViewer`, and still receives push for them — the three
  behaviours must be unchanged, which is the whole risk of this change.
- A contact with no grant still gets none of the three.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
