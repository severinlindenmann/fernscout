---
id: B624
title: Phone autofill lands in the dialling-code box, and the number field is cut off on a phone
type: ISSUE
priority: medium
complexity: low
area: contacts, phone input, mobile
found: "2026-09-06T17:51:28Z"
started: "2026-09-06T17:55:54Z"
session: e5f23c58-bb87-4175-ad7b-5d3aed93169f
claimed: "2026-09-06T17:55:54Z"
---

# B624 — Phone autofill lands in the dialling-code box, and the number field is cut off on a phone

## Why

Reported from a phone, filling in a postal address after following a buddy
invite. The telephone field is split in two — a dialling-code box and the
national digits — by `PhoneField`, used from `components/ContactManage.tsx:217`
and from the same pair of forms in `components/ContactsAdmin.tsx`. The split is
right (`splitTel`/`joinTel`, see the note at `ContactManage.tsx:108`), but the
browser does not know about it: iOS autofill drops the whole number into
whichever input it sees first, which is the dialling code. The result is a
contact whose `tel` is nonsense, and the person has to notice and undo it.

Separately, at phone width the national-digits input is cut off on the right —
the two boxes and their gap overflow the form's column.

## Work

- Give the two inputs autocomplete tokens the browser can tell apart — the
  dialling-code box is not `tel`. `tel-country-code` and `tel-national` are the
  standard pair; check what iOS actually honours before claiming it is fixed.
- Fix the overflow: the row needs the code box at its intrinsic width and the
  number box flexible, not a two-column grid that assumes desktop.
- Both forms use the field, so fix it in `PhoneField` and not at either call
  site.

## Acceptance

- On an iPhone, autofilling the phone number puts the digits in the digits box
  and leaves a sensible dialling code.
- At 390px the whole number is visible and typable in both the contact's own
  page and the owner's contacts admin.
