---
id: B273
title: A reader cannot leave a postal address or phone number, so a postcard has nowhere to go
type: FEATURE
priority: medium
complexity: medium
area: contacts, invites
found: "2026-09-04T11:56:50Z"
started: "2026-09-04T14:16:22Z"
session: a3370c43-40d9-471c-a3d3-1a30c49b5302
claimed: "2026-09-04T14:16:22Z"
---

# B273 — A reader cannot leave a postal address or phone number, so a postcard has nowhere to go

## Why

Asked by the owner on 2026-09-04, looking at a live guest invite page
(`/<user>/invite/guest/<token>`). It collects a name, an email address and a
reading language, and nothing else.

Postcards are a capability of this software — `send-postcards` is one of the
ten skills, and it renders one card per recipient. The recipients have to come
from somewhere, and today the only place a reader's details can be typed is a
form that does not ask for them. `lib/contacts/mail.ts:131-133` already knows
the field is coming: *"Whether they asked for a postcard is on the overview
page; where they live is not in a mail."*

So this is the missing half of a feature that already half exists.

## Work

- Add a postal address and a phone number to the guest invite form and to the
  reader's own manage page (`/<user>/c/<token>`), so details can be added or
  removed later by the person they belong to rather than only at the moment
  they ask to join.
- **Both optional, and visibly so.** A reader asking to follow somebody's
  travel journal is not applying for anything; a required address is a reason
  to close the tab, and a required phone number more so. Say what each is for
  in the form — a postcard, and nothing else — because an address field with no
  stated purpose on a stranger's site reads as harvesting.
- **Phone: say whether anything sends to it.** Nothing in this codebase sends
  SMS today. A field collected for no implemented purpose should say it is for
  the owner to have, or not exist yet — decide, and write the reason down.
- Keep them out of mail, which the existing comment already commits to. Check
  the owner's contacts overview and the approval queue render them, and that
  nothing puts them in a notification.
- Storage: they go on the contact row. Check what `lib/contacts/` already
  stores and whether a migration is needed, and follow whatever the existing
  columns do about optional text.
- All three locales, and mind that an address is not one line in every country
  — a single multi-line field beats five wrong-shaped ones.

## Acceptance

- A reader can join without giving either field, and can add or remove both
  later from their own manage page.
- The owner sees them on the contacts overview; no mail contains them.
- `send-postcards` can find a recipient's address from a contact rather than
  being handed one.
- Tests for a contact with both fields, with neither, and for the mail
  exclusion.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
