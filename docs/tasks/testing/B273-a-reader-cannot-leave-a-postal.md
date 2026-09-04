---
id: B273
title: A reader cannot leave a postal address or phone number, so a postcard has nowhere to go
type: FEATURE
priority: medium
complexity: medium
area: contacts, invites
found: "2026-09-04T11:56:50Z"
started: "2026-09-04T14:16:22Z"
merged: "2026-09-04T14:48:19Z"
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

**Corrected after reading the code.** The reader's own manage page
(`/<user>/c/<token>`, `components/ContactManage.tsx`) and the older personal
guestbook (`/<user>/i/<token>`, `components/ContactForm.tsx`) already had a
full postal-address fieldset and a phone number — `lib/contacts/`'s storage,
encryption, `isPostable`/`hasAnyDetail` and the admin overview
(`components/ContactsAdmin.tsx`) were all built for this already, and none of
that needed touching. The one gap was specifically the page the owner was
looking at: `/<user>/invite/guest/<token>` (`components/InviteRedeem.tsx` and
`app/api/contacts/redeem/route.ts`), which by design (B33) asks a
**returning** reader nothing beyond identity, so that a redemption can never
silently rewrite a choice they already made. That reasoning does not apply to
a **brand-new** reader — there is no existing choice yet to overwrite — so:

- Added an optional postal-address fieldset, a phone number and a "send me a
  real postcard" checkbox to `InviteRedeem`'s "form" step only (a brand-new
  reader, no session, no known contact). The "confirm" step (an
  already-known reader — signed in, or email on file) is unchanged: no
  fields, one button, exactly as B33 built it.
- Extended `POST /api/contacts/redeem` to accept an address the same way
  `POST /api/contacts/request` already does — `hasAnyDetail`/`isPostable` and
  the `invalid_address` 400 are shared logic, not reimplemented.
- **Both optional, and visibly so** — the address fieldset carries
  `contact.addressHint` ("only if you'd like a real postcard"), same as the
  guestbook.
- **Phone: says whether anything sends to it.** New key `contact.telHint` —
  "kept on file for the owner — nothing on this site sends to it yet" — shown
  under the new field. The three older tel fields (`ContactForm`,
  `ContactManage`, `ContactsAdmin`) still say nothing; captured separately as
  B303 rather than expanded into here.
- Mail exclusion needed no code change — `lib/contacts/mail.ts` already never
  puts an address in a letter — but got a regression test (see Acceptance).
- **`send-postcards` reading from a contact**, the Acceptance line that turned
  out to be the largest remaining gap: `scripts/postcard.ts` had carried a
  comment since it was written — "Once the contacts work lands, this reads
  from the contacts table instead" — but never did. Added `--from-contacts`,
  backed by a new `lib/postcard/contacts.ts` (`postcardRecipientsFromContacts`),
  selecting `active` + `wantsPostcard` + `isPostable` contacts. Doing this
  required switching the `postcard` npm script from plain `node` to `tsx
  --conditions=react-server` (matching `digest`/`photobook`): `lib/contacts`
  imports other `lib/` modules without file extensions, which plain Node's
  ESM loader cannot resolve at all, `server-only` aside.
- All three locales for the one new key, in place, alphabetically.

## Acceptance

- A reader can join without giving either field, and can add or remove both
  later from their own manage page.
- The owner sees them on the contacts overview; no mail contains them.
- `send-postcards` can find a recipient's address from a contact rather than
  being handed one.
- Tests for a contact with both fields, with neither, and for the mail
  exclusion.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
