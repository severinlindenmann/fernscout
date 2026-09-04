---
id: B97
title: The guest list cannot tell a reading link from a writing link
type: ISSUE
priority: medium
complexity: low
area: contacts, ui, access
found: "2026-09-03"
started: "2026-09-04T07:30:32Z"
merged: "2026-09-04T07:57:03Z"
completed: "2026-09-04T20:01:43Z"
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

## What was built

`components/ContactsAdmin.tsx` — `AdminInvite` carries `kind`, `tripId` and
`expiresAt`, and each row is drawn by a new `InviteRow`: the kind in the words
the access panel already uses (`me.inviteGuestTitle`, `me.inviteBuddyTitle`, and
a new `contact.adminInvitePersonalTitle` for the third), the trip on a buddy
link, then name, language, uses and one state — `works until <date>`, `no end
date`, `expired` or `revoked`. A dead link is offered no revoke button, because
`resolveInvite` already refuses it and a button that claimed to do something to
it would be noise.

`app/api/contacts/admin/route.ts` gained an `inviteView`, the way `ownerView`
already exists for a contact. **One correction to the Why above:** the route was
never the place the fields were lost — it returned `listInvites(username)`
whole, and every field was already in the RSC payload; what dropped them was the
type on the other side. The mapping is there so the page's contract is stated
rather than "whatever `Invite` happens to hold", and so a column added upstream
cannot arrive on the client by accident.

Copy in `content/locales/{en,de,hu}.json` plus `npm run i18n:keys`:
`contact.adminInvitePersonalTitle`, `contact.adminInviteTrip`,
`contact.adminInviteExpires`, `contact.adminInviteExpired`,
`contact.adminInviteRevoked`, `contact.adminInviteNoExpiry`.

### The same blindness elsewhere: checked

- **REST** (`GET /api/v1/{user}/invites`) was already legible — `view()` returns
  `kind`, and `scope` as a **trip ref** rather than a bare id. No change.
- **MCP** (`list_invites`) named the kind, and got one real fix: a link whose
  date had passed rendered as `, until 2020-01-01`, which reads as live to
  anything skimming the line. It now says `expired <date>`, the rows carry a
  derived `live`, and the answer states in one sentence which kind leads to
  write access.

## Evidence

Rendered `/alex/contacts` on a dev server (one personal, one guest, one buddy
link, all issued the way the panel issues them):

```
A personal link, for one person | Oma · English · used 0× · no end date        [Revoke]
A link for someone to write     | the trip bus-2026 · used 0× · works until 2026-10-04  [Revoke]
A link for someone to read      | used 0× · works until 2026-10-04             [Revoke]
```

and after revoking the guest link and expiring the buddy link in the database:

```
A personal link, for one person | Oma · English · used 0× · no end date        [Revoke]
A link for someone to write     | the trip bus-2026 · used 0× · expired — it no longer works
A link for someone to read      | used 0× · revoked — it no longer works
```

`list_invites` over MCP against the same journal:

```
… — personal to alex, used 0×
… — buddy to alex/bus-2026, used 0×, expired 2020-01-01
… — guest to alex, used 0×, revoked
```

`test/guest-list-links.test.tsx` (new) asserts all of it on the rendered markup;
it fails 6 of 8 against the previous component, where the guest and buddy rows
were both `— · — · used 0×`. Two tests in `test/mcp.test.ts` cover the MCP list
through the real endpoint.

`npm run i18n:keys`, `npm run build`, `npx tsc --noEmit`, `npx eslint .` (0
errors) and `npx vitest run` (130 files, 2098 passed) all pass.

## Noticed while building, not absorbed

**B228** — making the expiry legible showed that the personal links this page
issues carry none at all: `case "invite"` in the admin route calls
`createInvite` without an `expiresAt`, while both other doors date every link
and `lib/contacts/invites.ts` argues at length that a link which never expires
is the shared password again. Captured rather than fixed here; B97 is about
reading the list, not about what the form writes.
