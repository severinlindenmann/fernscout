---
id: B1283
title: The phone country field is too narrow for its own default value, so the dialling code is cut off
type: ISSUE
priority: low
complexity: low
area: contacts, mobile
found: "2026-09-10T10:46:32Z"
started: "2026-09-11T13:21:54Z"
merged: "2026-09-11T13:48:24Z"
completed: "2026-09-11T19:13:24Z"
---

# B1283 — The phone country field is too narrow for its own default value, so the dialling code is cut off

## Why

On the contact form — both the owner's **Add a guest** and the guest's own
confirmation page — the phone number row is a country selector beside a number
field. At 390px the selector is **144px wide** and its own default value needs
**198px**:

```js
{ v: "🇨🇭 Switzerland (+41)", w: 144, scrollW: 198, clipped: true }
```

so it renders as *"🇨🇭 Switzerlan"* — with the dialling code, the one part of that
value a phone number actually needs, cut off entirely. On the guest's page it is
the first thing they see about their own telephone number.

It is the field's *initial* state, not a long edge case: any country whose name
plus code is longer than about eleven characters is truncated on a phone, and
Switzerland is the instance's own default.

## Work

- Give the value the room it needs, or show less of it. The code is the load
  bearing part; the full country name is what the list is for.
- Check the row at 320px too — the narrowest phone still in use — and in German,
  where "Schweiz (+41)" is shorter but "Vereinigte Staaten (+1)" is not.

## Built

`components/TelField.tsx`'s closed-control `displayValue` (line ~225) now
renders flag + dialling code only (`🇨🇭 +41`) instead of flag + full name +
code (`🇨🇭 Switzerland (+41)`). The open dropdown list is untouched and still
shows the full name, which is where choosing a country actually needs it.
The box itself (`w-36 shrink-0 sm:w-64`) is unchanged — showing less made
widening unnecessary. One shared component, so `ContactForm`,
`ContactsAdmin`'s `GuestForm`, `InviteRedeem` and `ContactManage` all get the
fix.

Not measured in a real browser this session. What to measure, and where:
open `/‹user›/contacts` (owner) or a guest confirmation page, resize to
390px and then 320px, switch the journal/browser to German, and open the
phone field closed (don't click it) for Switzerland, Germany and the United
States — read `input#‹id›-cc`'s `scrollWidth` vs `clientWidth`
(`scrollWidth <= clientWidth` is the acceptance line) or just read the
rendered text isn't clipped. Expected values are short regardless of locale
now (flag + up to 3 digits), so it should pass comfortably, but nobody has
looked.

`npm run verify` passed (build, tsc, eslint, tests, knip); no test in the
suite asserts the closed-control's display string.

## Acceptance

- At 390px the phone country control shows its dialling code for Switzerland,
  Germany and the United States.
- `input.scrollWidth <= input.clientWidth` for the default value.
