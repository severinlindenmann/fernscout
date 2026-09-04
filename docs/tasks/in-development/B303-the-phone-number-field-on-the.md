---
id: B303
title: The phone number field on the guestbook and the admin guest form never says what it is for
type: ISSUE
priority: low
complexity: low
area: contacts, i18n
found: "2026-09-04T14:33:46Z"
related: B274
started: "2026-09-04T16:07:52Z"
session: 46daaba3-3210-4263-85a6-d285caefd837
claimed: "2026-09-04T16:07:52Z"
---

# B303 — The phone number field on the guestbook and the admin guest form never says what it is for

## Why

Found while building B273, which added a phone number field to the guest
invite form (`components/InviteRedeem.tsx`) and gave it a hint —
`contact.telHint`, "kept on file for the owner — nothing on this site sends
to it yet" — because a field with no stated purpose on a stranger's site
reads as harvesting (B273's own Work section says so).

The same field already existed in three other places before B273, and none
of them say what it is for: `components/ContactForm.tsx:250` (the guestbook,
`/{user}/i/<token>`), `components/ContactManage.tsx:148` (the reader's own
manage page, `/{user}/c/<token>`), and `components/ContactsAdmin.tsx:420` (the
owner adding or editing a guest by hand). All three render `contact.tel` with
`(contact.optional)` beside it and nothing underneath — the exact gap B273
was filed to close on the invite form.

## Related

Both are contact-facing copy that does not say what a thing is for — the
manage link's label (B274) and the phone field's silence in three components
(B303). One i18n pass over `contact.*` covers them, in all three languages,
and doing them separately means writing the same strings twice.

## Work

Add `{t("contact.telHint")}` under the tel input in the three files above,
the same way `InviteRedeem.tsx` does it now. The key and its three
translations already exist (`content/locales/{en,de,hu}.json`) — B273 added
them — so this is only wiring, not new copy, except that `ContactsAdmin.tsx`'s
form is the owner typing about somebody else and may want a differently
worded key (`contact.adminAddressHint` already has that split for the
address fieldset's hint; consider `contact.adminTelHint` for parity, or
decide the existing wording reads fine either way and reuse it).

## Acceptance

- Every place `contact.tel` is rendered as a form field also renders a hint
  saying what it is for, in a screenshot or a rendered-HTML test.
- `npm run build`, `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`.
