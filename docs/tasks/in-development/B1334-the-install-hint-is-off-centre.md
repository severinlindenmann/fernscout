---
id: B1334
title: The install hint is off-centre and explains nothing about how
type: ISSUE
priority: medium
complexity: low
area: helper
found: "2026-09-10T16:25:15Z"
started: "2026-09-10T16:25:22Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T16:25:22Z"
---

# B1334 — The install hint is off-centre and explains nothing about how

## Why

The install hint under the composer sat slightly off-centre (the ✕ hung off
the centred text with no width constraint), and it told people to use the
share menu without showing how — there is no reader-facing doc page for
adding a page to the home screen, so the sentence dead-ended. Owner's ask,
2026-09-10, with screenshots at 390px and desktop.

## Work

- The hint is now a centred `max-w-md` row (`mx-auto`), text in its own span.
- A "Wie →" button beside it opens a Sheet with the three illustrated steps
  (share icon → "Zum Home-Bildschirm hinzufügen" → opens like an app),
  browser-neutral wording, new `agent.room.install*` keys in en/de/hu.
  The sheet is the doc — `/docs` is developer prose, wrong audience.

## Acceptance

At 390px with the hint visible, its box centre matches the viewport centre
(measured 0px off in Playwright, 2026-09-10); pressing "Wie →" opens a sheet
listing the three steps; ✕ still dismisses for good.
