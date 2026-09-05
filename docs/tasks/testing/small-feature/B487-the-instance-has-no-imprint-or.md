---
id: B487
title: The instance has no imprint or privacy page
type: FEATURE
priority: medium
complexity: low
area: landing, legal
found: "2026-09-05T15:31:06Z"
merged: "2026-09-05T15:31:22Z"
---

# B487 — The instance has no imprint or privacy page

## Why

fernscout.ch collects email addresses, phone numbers and postal addresses, and
hands some of them to Meta, Stannp and Gelato. It said none of that anywhere,
and had no imprint at all — which for a site reachable from Switzerland and
Germany is a legal gap as well as a trust one.

## Work

- `content/legal/<locale>.md`, rendered at `/legal` (`app/legal/page.tsx`,
  `lib/legal.ts`). Content rather than code because an imprint is nothing but
  real names, and `test/depersonalised.test.ts` is right to refuse those in
  `lib/`. English and German written; Hungarian falls back with a banner.
- A band above the landing colophon: "Hosted in Europe", no analytics, and the
  only link to `/legal`. Drawn only when `hasLegal()` — a fork with no imprint
  of its own gets no link rather than mine.
- `legal` added to `INSTANCE_DIRS`, to the deploy's `SHIPPED` list and to the
  reserved usernames.
- **Not** doing: a generated sub-processor list. The page names Meta, Stannp
  and Gelato in prose, so a provider swap is an edit to two markdown files.
  If that drifts once, generate it from `lib/capabilities.ts` instead.

## Acceptance

- `/legal` renders in English and German; `fs.locale=hu` shows the fallback
  banner over the English text.
- The landing page shows the band and the link; delete `content/legal/` and
  both the link and the page are gone.
- `npx vitest run test/legal.test.ts`.
- **On the deployed site**: check the contact address on the page is the one
  Severin actually wants published, and that the provider list still matches
  what `/api/health` reports as enabled (photobook is currently off).
