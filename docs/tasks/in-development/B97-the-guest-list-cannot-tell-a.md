---
id: B97
title: The guest list cannot tell a reading link from a writing link
type: ISSUE
priority: medium
complexity: low
area: contacts, ui, access
found: "2026-09-03"
started: "2026-09-04T07:30:32Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T07:30:32Z"
---

# B97 — The guest list cannot tell a reading link from a writing link

## Why

B33 gave a journal three kinds of invite link — `personal`, `guest` and
`buddy` — and B79 put the two new ones on the access panel, where an owner
issues them. The only place any of them can be *revoked* is the guest list at
`/{user}/contacts`, and that list cannot say which is which.

`app/api/contacts/admin/route.ts:82` returns `listInvites(username)`, which is
every kind. `AdminInvite` (`components/ContactsAdmin.tsx:52`) drops `kind`,
`tripId` and `expiresAt` on the way through, and the row renders as

```
{name ?? "—"} · {locale ?? "—"} · used {uses} times
```

(`ContactsAdmin.tsx:742`). A guest link and a buddy link carry no name and no
locale when they are issued from the access panel, which is how they are
normally issued, so both render as `— · — · used 0 times`. Two rows, identical,
one of which leads to somebody writing to a trip.

So the owner who has done exactly what the panel told them — sent a writing
link to the wrong person, come here to kill it — is choosing between
indistinguishable rows, and the cost of guessing wrong is asymmetric: revoke
the reading link by mistake and the family cannot ask to read; leave the
writing link alive and a stranger can join a trip. Revoking is also
irreversible in the only direction that matters here, since a link cannot be
shown again.

This is the reason B79 stopped at issue-and-copy rather than growing a list of
its own: revoking belongs on the guest list, and the guest list is one tap
below the buttons. That argument holds only once the list is legible.

## Work

Carry what the row already has in the database through to the screen:

- Add `kind`, `tripId` and `expiresAt` to `AdminInvite` and to the admin
  route's response. All three are on `Invite` already (`lib/contacts/invites.ts`).
- Say, per row, which kind it is and — for `buddy` — which trip, in the same
  plain words the access panel uses: a link for someone to *read*, a link for
  someone to *write* to a named trip. `me.inviteGuestTitle` and
  `me.inviteBuddyTitle` are the wording already shipped; do not invent a
  second vocabulary for the same two things.
- Say when it expires, or that it already has. An expired link is dead and
  offering a revoke button beside it is noise.
- A `personal` link keeps reading as it does now.

Copy in all three of `content/locales/{en,de,hu}.json` plus the key union.

Not doing: issuing links from this page (that is the access panel's job, B79),
and any change to what a link grants.

## Acceptance

- A journal holding one personal, one guest and one buddy link shows three
  rows that a reader can tell apart without opening anything, asserted by a
  test on the rendered markup.
- The buddy row names its trip.
- An expired or revoked link says so and offers no revoke button.
- `npm run i18n:keys`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`,
  `npm run build`.
