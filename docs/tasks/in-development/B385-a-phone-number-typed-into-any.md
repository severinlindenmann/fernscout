---
id: B385
title: A phone number typed into any of the four guest forms has no country, and only the sender finds out
type: FEATURE
priority: medium
complexity: low
area: contacts, whatsapp
found: "2026-09-04T22:00:00Z"
started: "2026-09-04T22:00:21Z"
session: 39691533-1e0d-44dd-a2e5-b2a7ce844518
claimed: "2026-09-04T22:00:21Z"
---

# B385 — A phone number typed into any of the four guest forms has no country, and only the sender finds out

## Why

Every phone field in the product is one free-text box:

- `components/ContactForm.tsx:274` — the public guest form
- `components/ContactsAdmin.tsx:519` — the owner adding or editing a guest
- `components/InviteRedeem.tsx:364` — somebody arriving on an invite link
- `components/ContactManage.tsx:166` — a guest correcting their own details

A Swiss person types `076 561 31 50`, which is what a Swiss person means by
their number, and it is stored exactly as typed. `lib/whatsapp/phone.ts:42`
then refuses it: a leading zero is a national prefix whose meaning depends on
where the reader is standing, and guessing it would send somebody's family
photograph to a stranger holding that number elsewhere. That reasoning is
right and should not change. Its consequence is that the contact is quietly
skipped at send time — nothing on the form, nothing on the owner's page, said
the number was unusable when there was still somebody there to ask.

Asking for the country at the moment of typing removes the ambiguity at the
only point where the person who knows the answer is present. It also makes
`defaultCountryCode` an operator's fallback for legacy rows rather than the
only thing standing between a national number and being dropped.

## Work

A dialling-code `<select>` next to the number input, in all four forms — the
person picks `+41` and types `765613150`. One shared component; four copies of
a country list is four lists that drift.

Keep storage as it is: one `PostalAddress.tel` string, written as `+<cc>
<national>`, so `toE164` reads it through its existing `+` branch and nothing
downstream changes. Splitting the column is not worth it for one field.

The list does not need every country — the journal's own locales and a
reasonable set, sorted, defaulting from the contact's locale (`de` → `+41` is
wrong for Germany, so default from the *journal's* country if there is one, and
otherwise leave it unselected rather than guessing).

Reading an existing row back into the form: parse a leading `+<cc>` if there is
one, otherwise leave the select empty and the digits in the box, so an old
value is shown as typed and not silently reinterpreted.

Not doing: libphonenumber. `phone.ts:26` explains why this codebase refuses
three prefixes rather than validating numbering plans, and a picker makes that
argument stronger, not weaker.

## Acceptance

In each of the four forms the country is a separate control, and a number
entered as `+41` + `765613150` round-trips: saved, reopened for edit as the
same two parts, and `toE164` returns `41765613150` with no
`defaultCountryCode` configured. A test covers the parse-back of a stored
`+41 76 561 31 50` and of a legacy `076 561 31 50`.
