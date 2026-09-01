---
id: B35
title: Per-trip read grants are honoured in three places and written by nothing
type: CHORE
priority: medium
complexity: low
area: contacts, digest, push, db
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
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

B41 settles the question it was waiting on, and settles it the other way: **a
guest is a guest of the journal, not of a trip.** Somebody let in sees every
trip they would see as an approved contact, and a trip that must be held back
from them is `visibility: private`. There will be no per-trip guest link and no
per-trip grant write path.

That makes this more than tidiness. Whoever builds B41 will open `lib/viewer.ts`
and `lib/digest/visibility.ts` — those are exactly the files it touches — read
`grants?.has(trip.id)`, and reasonably conclude that per-trip guest scoping is a
supported thing they should preserve or extend. The dead arm is positioned to
cause the wrong turn in the one task most likely to trip over it. Two tests make
it look load-bearing on top of that: `test/push.test.ts:189` is named *"a grant
naming this trip specifically covers it"*, and its neighbour asserts that a
grant for another trip does **not** cover this one — both constructing rows by
hand that no production path can produce.

Do this before B41, or as its first commit. Not after: the point is to remove
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

  *Built as `contactsWithReadGrant(owner, now): Promise<Set<string>>` — renamed,
  because "grants by contact" is the old shape's name and a `Map` is what it
  promises.* **One caller, not two.** `resolveViewer` does not consult
  `access_grants` at all any more, and the reasoning is worth having: with the
  trip id gone, the question left is "does this contact hold a read grant", and
  in this codebase that is the same question as `contact.status === "active"`,
  which the function has already answered two lines earlier. `approveContact`
  is the only thing that writes a grant and it sets `active` in the same call;
  `revokeContact` and an address change in `updateContactByOwner` are the only
  things that end an approval and both delete the grant in the same call. So
  `guest || hasGrant` would have been a second dead arm replacing the one this
  task exists to remove — the same mistake in a shorter sentence. The
  equivalence is now pinned by tests rather than asserted (see Acceptance), and
  it costs a database round-trip off every page render as a side effect.
- Rewrite the two tests in `test/push.test.ts` around 170–210 and the row built
  at `test/digest.test.ts:208`. The negative case is still worth keeping in some
  form — *a contact without a grant is not told about a guest trip* — it just
  should not be expressed through a trip id.
- `contact_invites.trip_id` (`lib/db/schema.ts:142`) is written `null` and never
  read. It goes the same way.

### The decision: the columns are dropped

`lib/db/migrations/007-journal-wide-grants.ts`. Dropped, not documented as
unused, for the reason the task was raised in the first place: a column whose
stated meaning nothing honours is read as a plan that has not landed yet, and
the next person to open `schema.ts` is the one building B41 — the task most
likely to extend it by mistake. A comment saying "unused" does not survive
being skimmed; a missing column does.

Two things settled the argument beyond that:

- **Keeping the column means keeping the sentinel.** `access_grants_unique`
  includes `trip_id`, so `approveContact` would have to go on writing `"*"`
  into a column nobody reads, and its own dedupe lookup would have to go on
  matching it, forever. That is not a door left open, it is a value that has to
  be maintained.
- **The rebuild hazard is real but bounded, and the migration handles it
  rather than hoping.** The new index is `(owner_id, contact_id, scope)`, so
  two grants for one contact — a pair only a hand-written row can produce —
  would collide. `up()` collapses duplicates *before* creating the index,
  keeping the one that grants the most (`expires_at: null` beats a date, a
  later date beats an earlier one, ties break on `granted_at` then `id` so two
  databases with the same rows keep the same one). Merging two grants has to
  keep what either allowed. Covered by *"007 on $name, against rows 006
  allowed"* in `test/db-migrations.test.ts`, which migrates to `006`, writes
  the pair `006` still permits, and then runs `007` over it.

  *Numbered `007`, not `006`: `006-standing-link` (B27) landed on `main` while
  this was in progress, and a migration name is the primary key in
  `kysely_migration` — renumbering one that has run anywhere is the one thing
  `lib/db/migrations/index.ts` says never to do, so the newer of the two moved.*

`down()` restores both columns, `access_grants.trip_id` defaulting to `"*"` —
which is what every surviving grant means. The suite's "rolls all the way down
and back up" exercises it on every dialect.

**Superseded, and B39 has now shipped it: trip passwords are gone.** The
paragraph below is kept as written because it is the argument that lost, and a
reversed decision with no trace of the reasoning gets re-proposed. What it got
wrong: the anonymous door it defends is the one that cannot be revoked, and for
this audience an address is not a burden but the only thing that makes "let
this person in, and not that one" possible. A closed trip now asks for an
e-mail address and mails a way in; the mail proves who you are, and the owner's
grant decides what you may read.

One factual claim below is also wrong, and it is worth naming because it was
part of the argument: `visibility: guest` never *required* a hash.
`assertTripAccessConfig` filtered to trips that had one and then looked for
ones that did not, so that branch could not fire. A `guest` trip with no hash
was simply a trip nobody could open.

Not doing: **trip passwords.** `passwordHash`, `signTripToken`, the unlock form
and `app/api/trip-access/route.ts` are also per-trip guest access, and they stay.
They are a different mechanism — anonymous, no contact record, no database row —
and they are the door for somebody who will not prove an email address, which is
most of the audience this is built for. `visibility: guest` currently *requires*
a hash (`assertTripAccessConfig`, `lib/access.ts:206`), so removing them would
redefine what `guest` means; that is a design change and would be its own task,
not a cleanup. After B41 a `guest` trip has two doors, one anonymous and one
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

## Evidence

Against the Acceptance lines above, in order.

- **No path in `lib/` reads or writes either column.** Both are gone from
  `lib/db/schema.ts`; `subscribersFor` (`lib/push.ts`) lost its
  `.where("trip_id", "in", …)`, `digestableTrips` takes a `boolean`,
  `resolveViewer` no longer looks a grant up at all, `approveContact` writes no
  `trip_id` and no longer matches on one, and `createInvite` no longer writes
  `trip_id: null`.
  `grep -rn "access_grants\|contact_invites" lib/ app/ scripts/ | grep -i trip_id`
  → nothing.
- **The grep.** `grep -rn "trip_id" lib/ | grep -v migrations` is not empty, and
  the criterion as written could not be met by any correct change: `reactions`,
  `tracking_points` and `print_orders` each have a legitimate `trip_id` of their
  own, and `lib/tripWrite.ts` has an unrelated `"invalid_trip_id"` error string.
  What the line is asking for holds — the remaining 18 hits are those four
  things and one prose mention in the `AccessGrantsTable` comment saying the
  column is gone. Neither `access_grants` nor `contact_invites` appears among
  them. The criterion is left as it was written rather than edited to fit.
- **The decision is written above**, the migration is
  `lib/db/migrations/007-journal-wide-grants.ts`, and
  `test/db-migrations.test.ts` covers it three ways: the columns are absent from
  both tables, the narrowed `access_grants_unique` refuses a second `read` grant
  for one contact while still allowing a different scope, and the duplicate
  collapse runs against rows written at `006`.
- **The three behaviours are unchanged.** This is the line the change risked, so
  it was tested rather than reasoned about:
  - *digest* — `test/digest.test.ts`, "an unlisted trip reaches only the readers
    actually granted it": the approved reader still gets `open-2026` **and**
    `quiet-2026`, the reader whose grant was cleared still gets only
    `open-2026`. "an expired grant is not a grant" still passes, so the expiry
    arm survived the signature change.
  - *`resolveViewer`* — `test/viewer.test.ts` gained a `describe` that runs the
    **real** function against a real database and a real signed-in session:
    confirmed-but-unapproved sees only the public trip, `approveContact` (which
    is what writes the grant) makes the guest trip appear, `revokeContact`
    (which deletes it) makes it disappear, no session sees only the public trip.
    Those four were then run against `lib/` checked out at `HEAD` — the
    pre-change code — and pass identically. That is the equivalence claim,
    demonstrated rather than argued.
  - *push* — `test/push.test.ts`: an approved contact's grant covers a trip that
    did not exist when it was written; a contact whose grant is gone is not
    notified; a grant of another scope is not a read grant. The two tests that
    constructed per-trip rows by hand are gone, since no schema can hold them.
- **A contact with no grant still gets none of the three**: the "no grant"
  half of each of the three bullets above.
- **The four checks**: `npx tsc --noEmit` clean, `npx eslint .` 0 errors (4
  warnings, all pre-existing on `main`), `npx vitest run` 76 files / 1196 tests
  passing, `npm run build` succeeds.
- **The dev server boots both ways** (`AGENTS.md`). With contacts and auth off:
  `/api/health` 200, and `006` ran on a fresh SQLite file — `access_grants` came
  up as `id, owner_id, contact_id, scope, granted_at, granted_by, expires_at`
  with `access_grants_unique on ("owner_id", "contact_id", "scope")`, and
  `contact_invites` with no `trip_id`. With them on (`SESSION_SECRET` and
  `CONTACTS_ENCRYPTION_KEY` set): `/api/health` 200 reporting both enabled, and
  `/example/me` — the access panel, which is `resolveViewer`'s only caller —
  renders 200 with nothing in the log.

One gap worth naming: `POSTGRES_TEST_URL` is unset on this machine and no
Postgres is reachable, so the migration was proved on SQLite only. The suite is
dialect-parameterised and CI supplies the URL, so `006` is covered there — but
it is the one thing about this change that has not been seen to run twice.

## Captured along the way

**B45** — the access panel lists `guest` trips to any active contact, while
`mayReadTrip` lets nobody into one without the trip password. The panel's own
test file states the opposite as its guarantee. Older than this task and
untouched by it — the arm B35 removed was dead — but it was found by reading
`resolveViewer` closely enough to delete part of it, and it is very likely B41
or B39's tail rather than its own change.
