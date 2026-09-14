---
id: B1712
title: The hero's or-divider separates the WhatsApp button from nothing when the helper is off
type: ISSUE
priority: low
complexity: low
area: landing
found: "2026-09-14T09:20:00Z"
---

# B1712 — The hero's or-divider separates the WhatsApp button from nothing when the helper is off

## Why

`LandingHero` renders `OrDivider` unconditionally inside the
`whatsappNumber &&` block (`components/LandingSections.tsx`). The other door in
that row — the "Start writing" button to `/agent` — only exists when
`helper` is on. With it off, which is every self-hosted instance and was the
default when B1314 chose this design, the first screen reads

> or  ⟨Start using WhatsApp⟩

with nothing before the word. B1711 made this more visible rather than
causing it: the headline above now says "Send a voice note", so the WhatsApp
button is the hero's only call to action and the stray "or" sits directly
under it.

Noticed while building B1711 and deliberately left alone there —
`test/landing.test.tsx` asserts `role="separator"` for exactly this case, so
it is B1314's chosen behaviour and a person decides whether it changes.

## Work

Either render the divider only when `helperEnabled` is also true, or decide
the divider stays and say so here. If it changes, the assertion in
`test/landing.test.tsx` ("offers a WhatsApp link when this instance has a
number configured") moves with it.

## Acceptance

- With `helper` off and a WhatsApp number configured, the hero shows one door
  and no leading "or".
- With both on, the divider is still between the two buttons.
- The landing test asserts whichever of those is decided, not neither.
