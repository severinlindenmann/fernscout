---
id: B554
title: The desktop winding-path sidebar shows a day's cost converted only, where the story feed now shows what was paid
type: ISSUE
priority: low
complexity: low
area: costs, currency, ui
found: "2026-09-06T09:12:12Z"
started: "2026-09-07T10:37:37Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T10:37:37Z"
---

# B554 — The desktop winding-path sidebar shows a day's cost converted only

## Why

B544 made the story feed and the mobile day sheet lead with what a day
actually cost — `THB 1'275 ≈ CHF 33` — through `useMoney().spend`.
`components/GamePath.tsx:244` draws the same badge on the desktop winding path
(`hidden lg:block`, which is why it was outside that ticket's 390px scope) and
still prints `money(day.cost)` alone. Two surfaces of the same journal now
disagree about what a day cost, and the desktop one is the one that cannot be
checked against a receipt.

Found while building B544.

## Work

Thread `costLocal` to the sidebar's day rows the way `DaySummary` already
carries it, and call `spend(cost, costLocal)` — the shared rule in
`lib/currency.ts`, not a third copy of when the `≈` belongs.

## Acceptance

- A single-currency day reads the same in the sidebar as in the story feed.
- A mixed-currency day is unchanged.
- `npm run verify` passes.
