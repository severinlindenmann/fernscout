---
id: B1283
title: The phone country field is too narrow for its own default value, so the dialling code is cut off
type: ISSUE
priority: low
complexity: low
area: contacts, mobile
found: "2026-09-10T10:46:32Z"
started: "2026-09-11T13:21:54Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T13:21:54Z"
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

## Acceptance

- At 390px the phone country control shows its dialling code for Switzerland,
  Germany and the United States.
- `input.scrollWidth <= input.clientWidth` for the default value.
