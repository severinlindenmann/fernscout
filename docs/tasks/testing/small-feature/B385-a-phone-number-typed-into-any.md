---
id: B385
title: A phone number typed into any of the four guest forms has no country, and only the sender finds out
type: FEATURE
priority: medium
complexity: low
area: contacts, whatsapp
found: "2026-09-04T22:00:00Z"
started: "2026-09-04T22:00:21Z"
merged: "2026-09-04T22:15:48Z"
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

## Built

One shared component, `components/TelField.tsx`: a `<select>` of dialling
codes (`DIAL_CODES` — the neighbours of Switzerland, the UK, North America,
and Hungary, which already has its own WhatsApp template; honestly not the
whole ITU list, see the doc comment) beside the digits `<input>`, plus
`splitTel`/`joinTel` — the only new surface. Storage is unchanged: still one
`PostalAddress.tel` string, `+<cc> <national>`, still read by `toE164`'s `+`
branch.

Wired into all four forms — `ContactForm.tsx`, `ContactsAdmin.tsx`'s
`GuestForm`, `InviteRedeem.tsx`, `ContactManage.tsx` — each keeping the
dialling code in its own `useState` (or, for `ContactsAdmin`, a `cc` field on
`GuestFields`) rather than re-deriving it from the stored string on every
render: deriving it fresh would lose the selection the instant the digits are
cleared, since `joinTel` correctly refuses to store a bare `+cc` with nothing
after it.

The default: `lib/whatsapp/settings.ts`'s existing `whatsappCountryCode()` —
the operator's own configured fallback, already used by `toE164` for legacy
rows — threaded through from each server page
(`app/[user]/i/[token]/page.tsx`, `app/[user]/invite/redeemPage.tsx`,
`app/[user]/contacts/page.tsx`, `app/[user]/c/[token]/page.tsx`,
`app/[user]/me/page.tsx`) as a `defaultCountryCode` prop. It only seeds a
field that starts with no number at all; an existing (even unparseable)
value is always parsed back by `splitTel`, never overridden — this is what
"the journal's own country if there is one" resolved to, since no such field
exists on a journal's `config.json` and inventing a currency-to-country guess
would have been exactly the kind of guess the ticket warns against.

Evidence, acceptance line by line:

- **Country is a separate control, all four forms**: `components/TelField.tsx`
  renders the `<select id="{id}-cc">` beside `<input id="{id}">`; wired at
  `ContactForm.tsx` (`contact-tel`), `ContactsAdmin.tsx`'s `GuestForm`
  (`guest-tel`), `InviteRedeem.tsx` (`invite-tel`), `ContactManage.tsx`
  (`manage-tel`). `test/contact-tel-hint.test.tsx` (predates this ticket,
  asserts on those exact ids) still passes unmodified.
- **`+41` + `765613150` round-trips, `toE164` → `41765613150`, no
  `defaultCountryCode`**: `test/tel-field.test.ts`, "round-trips through
  storage with no defaultCountryCode needed" — `joinTel("41", "765613150")`
  → `splitTel` back to `{ cc: "41", national: "765613150" }`, and
  `toE164(stored)` (no second argument) → `"41765613150"`.
- **Parse-back of `+41 76 561 31 50`**: same file, "parses back a stored
  value written as typed with spaces" → `{ cc: "41", national: "76 561 31
  50" }`.
- **Parse-back of legacy `076 561 31 50`**: same file, "a legacy national
  number has no country to find, and is shown as typed" → `{ cc: "",
  national: "076 561 31 50" }` — shown in the digits box, select left
  unselected, exactly as the ticket asks.

`npm run verify`: build → tsc → eslint → vitest, all four green (2784
passed, 3 skipped for the Postgres dialect nobody started here, same as
before this change).

New capture from this work: B389 (see backlog) — a contact whose stored
number this picker cannot parse (a legacy row, or a country outside
`DIAL_CODES`) is shown correctly in the form but the owner's read-only guest
list (`ContactsAdmin.tsx`'s row view) still prints the bare string with no
flag that it is unmessageable, so the same "quietly skipped at send time"
problem this ticket closes for the *form* still stands for the *list*.
