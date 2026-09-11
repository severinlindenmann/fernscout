---
id: B1169
title: The room re-renders and shifts: RoomOpening hydration mismatch and uncontained scrolling
type: ISSUE
priority: medium
complexity: low
area: helper room
found: "2026-09-09T20:04:47Z"
started: "2026-09-09T20:06:21Z"
merged: "2026-09-09T20:26:53Z"
---

# B1169 — The room re-renders and shifts: RoomOpening hydration mismatch and uncontained scrolling

## Why

Loading `/agent` signed in throws a hydration mismatch on every visit:
`components/RoomOpening.tsx:64` and `:99` format dates with
`toLocaleDateString(undefined, …)`, so the server (its own locale) and the
browser disagree — "Friday 30 April" vs "Friday, April 30" — and React
regenerates the whole tree client-side. That is a visible jump on arrival, a
console error on every load, and part of what the owner reports as
"scrolling shifts the whole design". Same class as B1072, which names two
other components. Separately, none of the room's scroll containers
(`[role=log]` in `HelperAsk.tsx:790`, the panes in `HelperRoom.tsx`) set
`overscroll-behavior`, so rubber-banding at the ends chains to the page.

## Work

- `RoomOpening.tsx`: format both dates through the room's own
  `formatLongDate`/locale-fixed path (the same fix `HelperConsentList.tsx`
  documents), or `toLocaleDateString(locale, …)` with the page's own locale.
- `DayChip` in `HelperAsk.tsx:1041` has the same `undefined`-locale shape —
  it renders client-only so it cannot mismatch, but fix it the same way for
  consistency with the reader's chosen locale rather than the OS one.
- `overscroll-contain` on the log, both desktop pane scroll areas, and the
  phone dialogs/sheet.
- Not doing: B1072's other two components (that ticket stands).

## Acceptance

- Loading `/agent` signed in produces zero console errors (the check-page
  probe's `consoleErrors` is empty).
- The opening's dates render in the page locale, identically on server and
  client.
- Scrolling to the end of the conversation and continuing does not move the
  header or composer at 390px.
