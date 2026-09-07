---
id: B624
title: Phone autofill lands in the dialling-code box, and the number field is cut off on a phone
type: ISSUE
priority: medium
complexity: low
area: contacts, phone input, mobile
found: "2026-09-06T17:51:28Z"
started: "2026-09-06T17:55:54Z"
merged: "2026-09-06T18:04:46Z"
completed: "2026-09-07T13:12:33Z"
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

## Found

The component is `TelField` (`components/TelField.tsx`), not `PhoneField` —
the task's name for it was off; the file, the two `splitTel`/`joinTel`
helpers and the note at `ContactManage.tsx:108` were exactly where described.
It has four callers, not two: `ContactManage.tsx:216`, `ContactsAdmin.tsx:699`
(the pair the ticket named), and also `ContactForm.tsx:297` and
`InviteRedeem.tsx:366` — all four get the fix for free, being the same
component.

Fixed in `components/TelField.tsx`, both call sites untouched:

- **Autocomplete tokens** (`TelField.tsx:244`, `:305`): the code box now
  carries `autoComplete="tel-country-code"` (was `"off"`) and the digits box
  `autoComplete="tel-national"` (was `"tel"`) — the WHATWG pair for a split
  phone field.
- **Defensive reroute** (`TelField.tsx:124-134` for `guessMisplacedNumber`,
  wired into the code box's `onChange` at `:251-265`): no dialling code is
  more than 3 digits, so a value landing in the code box with more digits
  than that is the whole number, not a code. It is stripped to digits, tried
  as a 3/2/1-digit prefix against `DIAL_CODES`, and on a match rerouted to
  `onChange(cc, national)` instead of being kept as a "code". An ordinary
  short search keystroke (`"41"`, `"swi"`) is unaffected — it only fires past
  3 digits. Covered by `test/tel-field.test.ts` (five new cases).
- **Overflow** (`TelField.tsx:233`): the code box was a fixed `w-64` (256px)
  next to a `flex-1` digits box with no `min-w-0` — on a 390px phone (form
  column ~342px after the page's `px-6`) the code box alone left ~78px, and
  without `min-w-0` a flex child does not shrink below its content's
  intrinsic width anyway, so the digits box pushed past the column. Now
  `w-36 shrink-0 sm:w-64` on the code box and `min-w-0 flex-1` on the digits
  box — narrower on a phone, unchanged at `sm:` and up, and the digits box
  actually shrinks to fit instead of overflowing.

**Could not verify**: a real iPhone. Nothing here runs Safari/iOS, so
"autofilling puts the digits in the digits box" (acceptance line 1) is
demonstrated only by the two mechanisms above (the standard autocomplete
tokens, plus the defensive parse as a fallback if iOS ignores them, which is
the reported behaviour today) and by the unit tests on
`guessMisplacedNumber`, not by an actual autofill event. The 390px layout
(acceptance line 2) was reasoned from the page's own column width
(`PAGE_CLASS = "mx-auto w-full max-w-xl px-6 py-12 sm:py-16"` in
`ContactManage.tsx:57`) and the new fixed widths, not from a live browser at
that viewport — `npm run verify` passed (build, tsc, lint, vitest all green)
but that suite does not render or measure layout.
