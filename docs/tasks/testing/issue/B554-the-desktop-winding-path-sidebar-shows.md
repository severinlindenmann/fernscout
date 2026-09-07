---
id: B554
title: The desktop winding-path sidebar shows a day's cost converted only, where the story feed now shows what was paid
type: ISSUE
priority: low
complexity: low
area: costs, currency, ui
found: "2026-09-06T09:12:12Z"
started: "2026-09-07T10:37:37Z"
merged: "2026-09-07T10:56:41Z"
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

## Resolution

`components/GamePath.tsx`: swapped `const { money } = useMoney()` for
`const { spend } = useMoney()`, and the one call site,
`` `· ${money(day.cost)}` `` → `` `· ${spend(day.cost, day.costLocal)}` ``
(line ~257). No threading needed beyond that — `GamePath` already receives
`days: DaySummary[]` from `app/TripStory.tsx` (`<GamePath days={index} …>`,
where `index` is `buildStoryProps`'s own `DaySummary[]`), and `DaySummary`
has carried `costLocal` since B544. `spend()` is the same helper
`components/MobileDaySheet.tsx` already uses for the story feed's badge —
one shared rule, not a third copy.

Added a test to `test/day-path.test.tsx`: a day with `costLocal` now shows
both the paid figure and the converted one, marked `≈`, matching the pattern
already asserted for the story feed in `test/day-local-currency.test.tsx`.

**Fixing this surfaced a pre-existing gap in that other test file's
assertions**, worth recording since it looks like a regression at a glance:
`GamePath` draws every day in the sidebar at once, not only the one open, so
once it started using `spend()` the single-currency day's own `≈` began
appearing in the full page's HTML *regardless* of which day the reader had
open — including the mixed-currency and base-currency days' own test cases,
which asserted "no `≈` anywhere on this page" when they meant "not on *this*
day's card". Updated those two assertions in
`test/day-local-currency.test.tsx` to check only the markup from
`<main id="main"` onward, which is the day card actually open and excludes
the sidebar — the tests' original intent, now correctly scoped.

`npm run verify` passes with the change in place.
