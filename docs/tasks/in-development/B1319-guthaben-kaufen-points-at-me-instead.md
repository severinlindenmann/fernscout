---
id: B1319
title: Guthaben kaufen points at /me instead of the account page, whose design is unloved
type: ISSUE
priority: high
complexity: medium
area: helper room, account
found: "2026-09-10T15:42:11Z"
started: "2026-09-10T15:42:20Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T15:42:20Z"
---

# B1319 — Guthaben kaufen points at /me instead of the account page, whose design is unloved

## Why

The room's "Guthaben kaufen" pointed at `/me`, a dense settings page, while
the actual buy control on `/[user]/account` was a popover dialog behind a
button, on a page whose payment card sat below storage and whose balance
rendered unformatted. The owner called the design bad and asked for a direct
link (owner's ask, 2026-09-10).

## Work

- `AccountPageContent.tsx`: the popover `BuyCreditsDialog` became an inline
  `BuyCreditsPanel` with `id="buy"` — always-visible slider, price via
  `formatChf(priceRappen(...))`, posting `/credits/purchase` and following
  `paymentUrl`. Payment card moved above storage; balance via
  `toLocaleString("de-CH")`; the per-send estimate column hides when both
  channels have zero recipients.
- `HelperRoom.tsx`: both buy links (account sheet, low-credit notice) go to
  `/<user>/account#buy`.

## Acceptance

Signed in as the owner, "Guthaben kaufen" in the room lands on
`/example/account#buy` with the slider visible without a further click, and
the balance reads `50'000`, not `50000`.
