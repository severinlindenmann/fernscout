---
id: B1339
title: Guest card and new-user hero run together on the landing page
type: FEATURE
priority: medium
complexity: low
area: landing, i18n
found: "2026-09-10T17:00:44Z"
started: "2026-09-10T17:01:04Z"
merged: "2026-09-10T17:07:58Z"
---

# B1339 — Guest card and new-user hero run together on the landing page

## Why

On the landing page the `ReaderInvite` card (the yellow-edged guest door,
B427) sits directly above `LandingHero`'s `<h1>`, separated by 16px
(`components/LandingSections.tsx` — the h1 carries `mt-4`). At phone width
the two read as one block, and nothing says who each block is for: a
first-time visitor reads the guest card first and takes it as the page's
pitch; a guest scrolling past it lands in marketing that is not for them.

The owner reviewed four drafts (design canvas "Landing: Gast oder neu",
2026-09-10) and chose Option B: keep both blocks where they are, widen the
gap, and give each block an audience label in the existing mono kicker
voice (B733).

## Work

- In `ReaderInvite`, add a `Kicker` line above the card's `<h2>`:
  "Für Gäste und Mitgereiste" (new key `home.inviteKicker`).
- In `LandingHero`, add a `Kicker` above the `<h1>`:
  "Dein eigenes Reisetagebuch" (new key `landing.heroKicker`), and widen
  the gap between the card and the hero from `mt-4` to `mt-12`.
- Two new locale keys in `en`, `de`, `hu` (real translations), then
  `npm run i18n:keys`.
- Not doing: reordering the sections (B427 decided the guest card leads),
  a second yellow edge or divider between the blocks, or any change to the
  signed-in arrangement in `Landing.tsx`.

## Acceptance

At 390px on `/`, the guest card carries a small uppercase mono label naming
guests, the hero carries one naming "your own journal", and there is
visibly more air between the card and the hero than between elements inside
each block. `npm run verify` passes (locale coverage and the regenerated
`TranslationKey` union included).
