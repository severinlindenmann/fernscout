---
id: B41
title: An approved contact is shown a trip in their own panel and then asked for a password nobody gave them
type: ISSUE
priority: medium
complexity: medium
area: access, contacts, trips
found: "2026-09-01"
started: "2026-09-01"
---

# B41 — An approved contact is shown a trip in their own panel and then asked for a password nobody gave them

Split out of B33, which was doing two separable things. This is the half that is
a live bug and blocks everything else; B33 keeps the invite links.

## Why

Journal-wide guest access is already the model in the database. It is read in
three places and enforced in none.

- `access_grants` (`lib/db/schema.ts:149`) holds a per-contact read grant whose
  `trip_id` may be `*`, meaning every trip.
- `approveContact` (`lib/contacts/index.ts:511`) is the only thing that writes
  one, and it always writes `*`. A contact the owner has approved is already,
  in the database, a guest of the whole journal.
- `resolveViewer` (`lib/viewer.ts:94`) reads it and tells that person, on their
  own `me` page, that they may open every `visibility: guest` trip.
- **`mayReadTrip` never asks.** `lib/tripGate.ts:26` checks `isOpenToLink`,
  then `isTravellerOn`, then the password cookie — and nothing else.
  `isGuestOf` (`lib/tripGate.ts:108`) says so outright: *"Identified per-person
  access lands with the contacts work; until then the only way to be a guest is
  to hold the trip's password."*

So the site tells somebody what they may read and then refuses them. They click
a trip listed under "what you can read", and get a password form for a password
that was never issued to them — with no way to tell that from having got a
password wrong. The owner's only recourse is to send a shared password, which
is the mechanism B39 exists to delete.

This is the load-bearing change for the whole access rework. B39 cannot remove
the password until the gate has another way to let a guest in, and B33's invite
links are worth nothing if approval does not actually open anything.

## The two decisions this enforces

Both were settled while B33 was one ticket; they live here because this is the
code that enforces them.

**A guest is a guest of the journal, not of a trip.** Somebody let in sees every
trip they would see as an approved contact. There is no per-trip guest access
and none should be added — if a trip must be held back from people who are
otherwise let in, that is `visibility: private`. The unbuilt per-trip
granularity still in the schema and the read paths is B35, which should land
first: `lib/viewer.ts` and `lib/digest/visibility.ts` are files this task opens,
and the dead arm reads as a feature worth preserving.

**All three visibility values stay, and `private` does not widen.** A journal
guest sees `public` and `guest` trips. A `private` trip stays what `AGENTS.md`
says it is — the people on it and the owner.

That was re-decided rather than inherited, because journal-wide guests are
exactly what makes `guest` and `private` look redundant, and collapsing them
into a plain public/private pair is a good argument: two values are easier to
hold in your head than three. It loses on one case. Invite the family to the
journal and every non-public trip is theirs to read, including the week away
with one person the invitation was never meant to cover — and the only remedies
left are un-inviting somebody or not writing the trip up. A third value costs
less than that, because the trip that needs it is the one where getting it
wrong is unrecoverable.

The distinction is worth stating plainly wherever it is documented, since it is
what a person gets wrong at the moment they create a trip: **`guest` means the
people I let into this journal; `private` means only the people who were
there.**

## B45 is the same defect, seen from the other side

B45 was captured while B35 was being built: the access panel lists `guest`
trips to any active contact, and `mayReadTrip` then refuses them. That is this
bug reported from the panel rather than from the gate, and B45 says so — it
offers "closing this by verifying B41 already fixed it" as a valid outcome.

Take that seriously rather than treating it as a separate job. B45 names one
thing this file does not: `test/viewer.test.ts` already states the property
that is being violated — *"the panel never widens access: it reports what
`mayReadTrip` would already allow"* — so there is an existing test file whose
own stated contract is currently false. Fixing the gate should make it true.

Two concrete things to carry over: check `listableTrips` and the trip switcher
for the same gap while you are in there, and when you are done, write into
B45's file whether it is closed by this work. Leave B45 in `backlog/` either
way — moving a task to `completed/` is the author's gate, never an agent's.

## Work

- `mayReadTrip` (`lib/tripGate.ts:26`) consults the grant: an active contact
  with a live `read` grant may open a `visibility: guest` trip. `private` is
  unchanged and must keep returning false.
- `isGuestOf` (`lib/tripGate.ts:108`) the same way, which is what makes
  `costsVisibility: guests` finally mean something for an identified guest
  rather than only for a password holder.
- One helper, called by both, rather than the lookup written twice. It needs the
  signed-in address (`GUEST_COOKIE` → `resolveSession`), the contact record and
  its grant — the same three things `resolveViewer` already assembles at
  `lib/viewer.ts:56`. Reuse it if it fits; do not fork it.
- Expiry is already handled in `readGrantsByContact` (`lib/digest/visibility.ts:49`)
  and a second implementation will drift from it. An expired grant is not a
  grant, and a revoked contact is not a contact — `revokeContact` deletes the
  grant rows, so both fall out of one correct lookup.
- `VISIBILITY_NOT_A_LOCK` (`lib/api/agentCopy.ts:46`) says a journey is gated by
  "a password, invited guests and the trip's `people:` list", which stops being
  accurate once an invited guest is a guest of the journal rather than of the
  trip. Fix it here, with the `guest`/`private` sentence above, in `agent.md`
  and `AGENTS.md`. `VISIBILITY_MEANING` beside it is about *journal* visibility
  and is unaffected — the two are constantly confused, so check the distinction
  still reads clearly while you are in there.

Not doing: invite links (B33), removing the password (B39), anything about how
somebody becomes an approved contact (B37). This task changes only what the gate
accepts from somebody who already is one.

## Acceptance

- An approved contact opens a `visibility: guest` trip with no password. This is
  the case that fails today; write the test first and watch it fail.
- A journal guest is refused a `visibility: private` trip — not the page, not
  the metadata, not the RSC payload, in the shape `lib/tripGate.ts` describes at
  the top of the file.
- A contact whose status is `pending` reads no more than an anonymous visitor.
- A contact whose grant has expired, and one whose contact was revoked, are both
  refused.
- Costs on a `costsVisibility: guests` trip render for an approved contact and
  not for a stranger.
- What `resolveViewer` lists on the `me` page and what `mayReadTrip` permits
  agree for every combination of visibility and contact status — a table test,
  because the whole bug is that these two disagreed.
- `VISIBILITY_NOT_A_LOCK` no longer describes guests as belonging to a trip.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
