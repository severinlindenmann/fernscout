---
id: B1327
title: Bring-your-own-agent is in the footer twice, and the menu entry opens nothing on desktop
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-10T15:59:36Z"
started: "2026-09-10T15:59:54Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T15:59:54Z"
---

# B1327 — Bring-your-own-agent is in the footer twice, and the menu entry opens nothing on desktop

## Why

"Eigenen Agenten anbinden" appeared twice — a grey footer line under the
composer and an entry in the ⋯ menu — and on desktop the menu entry opened
nothing: the shared `Sheet` dialog carried `lg:hidden`, so every sheet it
rendered (bring-agent, the shortcut cheatsheet) was display:none on a laptop.
The owner reported both (2026-09-10, with screenshots).

## Work

- Removed the footer line; the ⋯ menu entry is the one home (D11's sheet is
  unchanged behind it).
- `Sheet`: `lg:hidden` → `lg:mx-auto lg:top-auto lg:max-h-[80dvh] lg:max-w-xl`,
  so on a laptop it is a centred bottom sheet rather than nothing. Fixes the
  "?" cheatsheet on desktop too, which had the same class.

## Acceptance

At 1440px, ⋯ → "Eigenen Agenten anbinden" opens a visible dialog (~576px
wide, bottom-anchored); the footer carries no bring-agent line. At 390px the
sheet still opens full-width from 8dvh. Checked in Playwright on 2026-09-10.
