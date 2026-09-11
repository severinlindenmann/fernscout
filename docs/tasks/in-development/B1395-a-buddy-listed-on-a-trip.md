---
id: B1395
title: "A buddy listed on a trip has no way to give or correct their address on /me"
type: ISSUE
priority: medium
complexity: low
area: the owner's own page, contacts
found: "2026-09-10T20:45:00Z"
started: "2026-09-11T06:40:40Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T06:40:40Z"
---

# B1395 — A buddy listed on a trip has no way to give or correct their address on /me

## Why

`/<user>/me` has a "Deine Angaben" section — name, language, the consents, and
the postal address a postcard would go to. It is drawn at
`MePageContent.tsx:763`:

```
{manage && !viewer.owner && ( … <ContactManage … /> … )}
```

`manage` is built in `page.tsx:78-82` and needs two things: `contacts` enabled,
**and a contact row whose email matches the viewer's**. No row, no section — no
heading, no form, nothing on the page about an address at all.

**A buddy can be signed in, hold write access, and have no row.**
`writableTrips` comes from `tripsVisibleTo` → `isPersonOnWith`
(`lib/viewer.ts:147`), which is satisfied by *either* the hand-written
`people:` block in `trip.md` *or* a redeemed buddy-link row. Only the second
passes through the contacts queue. Somebody the owner typed into `people:` —
the ordinary way a travelling companion is named — is a person on the trip with
no contact record anywhere.

For that person, `writableTrips.length > 0` and `manage === undefined` at the
same time. The page renders their buddy block at `:832` — handover, agent keys,
write access to the trip — and never once offers them a field for their own
address.

Nowhere else takes it either:

- `/<user>/contacts` is the owner's page, and B621 moved the *owner's* own row
  there precisely because a guest keeps theirs on `/me`. A buddy has neither.
- `/c/<token>` (`app/api/contacts/manage/route.ts`) is the self-serve form, and
  the token arrives by mail — a mail sent to contacts. No row, no mail, no
  token.
- The helper has no contact tool at all (B1393).

So the address on a card addressed to them is whatever the owner typed, and
they cannot correct it. If the owner never typed one, they cannot be sent a
postcard from the trip they were on — and `me.detailsBodyTraveller` exists
(B320) specifically because this page is supposed to speak to travellers.

## Work

Give a signed-in person on a trip somewhere on `/me` to enter and correct their
own details, in the section that already exists.

- The lazy shape is to stop requiring a pre-existing row: when the viewer is on
  a trip (`writableTrips.length > 0`) and has no contact record, render the same
  section with an empty form, and let saving create the row. `requestContact`
  is the one door into that table and files everything `pending` — keep it that
  way, and do not mint a manage token for a row that does not exist yet.
- The address is theirs, given by them about themselves, which is the one case
  where the confirmation question is simpler than usual: their address is
  already proven (they are signed in as it — `resolveAccess`), so decide
  whether that alone is enough to file the row `confirmed`, or whether the
  ordinary mail still goes. Say which in the code, with the reason.
- **Consents still start off.** A buddy typing a street is not a buddy asking
  for post — `wantsPostcard`, `wantsEmailDigest` and `wantsWhatsapp` are ticks
  on the same form everybody else gets, which is the rule the owner's own row
  already follows (`app/api/contacts/admin/route.ts:270-275`).
- **The owner must not be able to overwrite what the person themselves
  wrote**, or at least must not do so silently. `updateContactByOwner` and
  `updateContactSelf` are separate functions today; check which wins and
  whether it is the right one, and capture it rather than widening this ticket
  if it is not.
- Check the copy: `me.detailsBody` versus `me.detailsBodyTraveller` (`:789`)
  already branches on `writableTrips`, so the traveller sentence is written and
  in place — it is only ever shown to a traveller who happens to also be a
  contact today.

**Not in this ticket.** No change to who may read a trip, to grants, or to
`approveContact`. Nothing here lets an owner or an agent write somebody else's
address — it is the person's own row, edited by that person.

## Acceptance

- Sign in as an address that appears in a `trip.md` `people:` block and nowhere
  in contacts: `/<user>/me` offers the details section with an empty form, and
  saving files the row. Driven in a browser (`test-in-a-browser`) — the
  acceptance is what somebody sees.
- The same address, signed in again later, sees its own values and can change
  them.
- A buddy who arrived by a redeemed buddy link (who has a row today) still sees
  exactly what they see now — no regression on the working path.
- With `contacts` switched off, the section is absent for everybody, as now.
- `npm run verify` clean.
