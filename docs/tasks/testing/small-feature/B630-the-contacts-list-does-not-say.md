---
id: B630
title: The contacts list does not say whether a person is owner, buddy or guest
type: FEATURE
priority: medium
complexity: low
area: contacts page
found: "2026-09-06T17:51:44Z"
started: "2026-09-06T18:04:54Z"
merged: "2026-09-06T18:18:32Z"
---

# B630 — The contacts list does not say whether a person is owner, buddy or guest

## Why

`/<user>/contacts` lists people with different relationships to the journal —
the owner, buddies on a trip, guests of the journal — and the row does not say
which. The distinction matters at exactly the moment the owner is on that page:
a buddy can write to a trip, a guest can only read, and telling them apart from
a name and an address is guesswork.

## Work

- A short tag on each row: owner, buddy, guest. Buddy is per trip, so say which
  trip, or say how many.
- Read the relationship from what already decides it — `peopleOf()` for a
  buddy, the grant for a guest, `owner.email` for the owner — rather than
  storing a new field.
- A person can be more than one thing. Say so rather than picking a winner.

## Acceptance

- Each row on `/<user>/contacts` carries its relationship, and it matches what
  the gates actually allow.

## Found

Added `lib/contacts/relationships.ts` — `relationshipsFor(email, ownerEmail,
trips, guest)`, pure and unit-tested (`test/contact-relationships.test.ts`):
owner from `owner.email` (already normalised), buddy from `peopleOf()` per
trip (already merges `trip.md`'s `people:` with redeemed buddy-link rows), and
guest passed in already computed the way `journalReader` computes it —
`contact.status === "active"` **and** a live row from `contactsWithReadGrant`
(the same bulk query `lib/push.ts` and the digest use, one call for the whole
page rather than one per contact). A person can hold more than one at once;
nothing here picks a winner.

Wired into both readers of `AdminContact`:
- `app/[user]/contacts/page.tsx` — computes `tripMemberships` and
  `liveGrants` once, folds a `relationship` field into each row.
- `app/api/contacts/admin/route.ts`'s `GET` — same computation, so `refresh()`
  after an approve/revoke shows a tag that still matches what the action just
  changed. The per-action `POST` responses pass no relationship — the client
  never reads it there, since every action ends in a `refresh()`.

`components/ContactsAdmin.tsx`'s `ContactRow` renders the tags as pills
matching the existing `Channel` chip style — "Owner", "Buddy on {trip}" /
"Buddy on {count} trips", "Guest of the journal". New locale keys
(`contact.relationOwner`, `contact.relationGuest`, `contact.relationBuddyOne`,
`contact.relationBuddyCount`) added to `en.json`, `de.json` and `hu.json`,
`TranslationKey` regenerated with `npm run i18n:keys`.

The owner's own row (the "me.details" section, B621) is unchanged — it is
already unambiguously labelled and uses a different component
(`ContactManage`), so no tag was added there.

Two existing tests that render the real page/route without a database needed
a stub for the new `contactsWithReadGrant` call:
`test/contacts-admin-locale.test.tsx` and `test/contacts-way-back.test.tsx`.
Three fixture factories in `test/contact-push-devices.test.tsx`,
`test/contact-country-name.test.tsx` and `test/contact-provenance.test.tsx`
got a default `relationship`.

`npm run verify` passes fully (300 files, 3896 tests, 3 skipped Postgres-only).
