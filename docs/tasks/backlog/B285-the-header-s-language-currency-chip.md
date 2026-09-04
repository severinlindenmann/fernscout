---
id: B285
title: The header's language/currency chip drifts to the middle of the row on desktop
type: ISSUE
priority: medium
complexity: low
area: header, nav, ui
found: "2026-09-04T12:50:12Z"
---

# B285 — The header's language/currency chip drifts to the middle of the row on desktop

## Why

Reported directly: on desktop, on a page with no trip in context (or any
journal with a single trip and a single currency), the language selector sits
alone in the middle of the header with a large gap on either side, instead of
sitting tight against the nav.

`components/PageHeader.tsx:76-104` lays the header out as one flex-wrap row:
title (`flex-[1_1_12rem]`, line 77), the chip cluster — `TripSwitcher`,
`CurrencySwitcher`, `LocaleSwitcher` (line 95-99) — and the nav wrapper (line
101, `flex w-full grow justify-end lg:w-auto`). `TripSwitcher` renders `null`
when there are fewer than two trips (`components/TripSwitcher.tsx:62`) and
`CurrencySwitcher` renders `null` when the journal has one currency
(`components/CurrencySwitcher.tsx:38`), so the chip cluster can shrink to just
the `LocaleSwitcher`.

The chip cluster's own box is `shrink-0` with no `grow` — correct, it should
stay its natural width. But at `lg` and up, both its neighbours grow: the
title (`flex-[1_1_12rem]`, grow 1) and the nav wrapper (`grow`, unconditional,
line 101 — grow 1 at every breakpoint, not just below `lg`). Any leftover
width in the `max-w-7xl` row is split between those two, so the chip cluster —
pinned between them, itself not growing — ends up wherever the title's
stretched box happens to end, which on a short title and a small nav is
somewhere near the middle of a wide desktop row.

This is a side effect of B170's fix (`docs/tasks/testing/B170-…md`), which
added the unconditional `grow` to the nav wrapper so it fills its own line
when forced onto a second row below `lg` — that reasoning only applies while
the nav is on its own full-width line; the class wasn't scoped to stop once
the nav shares line 1 with the title and chips (`lg:w-auto`). B170 measured
title-clipping on wide chip clusters (day counter + multiple chips); it never
measured the opposite case of a narrow chip cluster with the nav sharing the
row.

## Work

Make the nav wrapper's `grow` apply only while it's actually forced onto its
own line, i.e. below `lg` — `grow lg:grow-0` in place of the unconditional
`grow` at `components/PageHeader.tsx:101`. At `lg` and up this leaves only the
title growing, so the chip cluster and nav end up as one tight group at the
right edge of the row instead of the chip cluster floating mid-row.

Not doing: anything about the below-`lg` (mobile) layout, which this leaves
unchanged — the nav wrapper is `w-full` there regardless of `grow`.

Re-measure B170/B212's own acceptance (title not clipped, nav not clipped) at
1280/1440 after this change, since both touch the same row's space
distribution.

## Acceptance

- On `/example/trips`, `/example/search` or `/example/me` (no trip in
  context), or a single-currency journal's page, at 1024-1439px, the
  `LocaleSwitcher` chip sits immediately next to the nav (normal `gap-x-3`),
  not with a multi-hundred-pixel gap on either side.
- B170/B212's acceptance (journal title not clipped at 1280/1440, nav not
  clipped at any width) still holds.
