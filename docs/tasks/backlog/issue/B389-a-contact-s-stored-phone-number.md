---
id: B389
title: A contact's stored phone number that toE164 cannot parse is shown to the owner as if it were fine
type: ISSUE
priority: low
complexity: low
area: contacts, whatsapp
found: "2026-09-04T22:11:55Z"
---

# B389 — A contact's stored phone number that toE164 cannot parse is shown to the owner as if it were fine

## Why

B385 gave the four phone boxes a dialling-code `<select>`, so a number typed
in from now on either has a country or is honestly shown with none. It did
nothing about a number already on file that `toE164`
(`lib/whatsapp/phone.ts`) cannot turn into E.164 — a legacy `076 561 31 50`
with no `+`, or a `+<cc>` for a country outside `TelField.tsx`'s
`DIAL_CODES`. `components/ContactsAdmin.tsx`'s read-only row view
(`postal?.tel && … <dd>{postal.tel}</dd>`, no other check) prints that string
next to every other detail with no different treatment, so it reads to the
owner exactly like a number that works. The owner has no way to tell, from
that page, that this contact is one `lib/digest/dayWhatsapp.ts`'s send loop
will quietly skip — the same "nothing on the owner's page said it was
unusable" problem B385's Why section named for the *form*, still true for
the *list*.

## Work

On that row, when `postal.tel` is set but `isMessageable(postal.tel,
defaultCountryCode)` (`lib/whatsapp/phone.ts`) is false, say so next to the
number — not instead of it, since the owner still needs to see what is on
file to fix it (most likely by opening "Edit" and picking a country in the
B385 select now sitting there). `defaultCountryCode` is
`whatsappCountryCode()` (`lib/whatsapp/settings.ts`), already available to
`app/[user]/contacts/page.tsx` since B385's wiring.

Not doing: auto-fixing the row, or refusing to save an unmessageable number
— an owner adding a contact's landline on purpose, with no intention of ever
messaging it, is a real case and not this ticket's to prevent.

## Acceptance

A contact whose `postalAddress.tel` is `"076 561 31 50"` (no
`defaultCountryCode` configured) renders on `/​<user>/contacts` with a visible
note that the number is not currently messageable, next to the number
itself. The same contact with `defaultCountryCode: "41"` configured, or with
a `tel` of `"+41 76 561 31 50"`, renders with no such note. A contact with no
`tel` at all is unaffected (the whole block is still absent, as today).
