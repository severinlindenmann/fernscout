---
id: B1334
title: The install hint is off-centre and explains nothing about how
type: ISSUE
priority: medium
complexity: low
area: helper
found: "2026-09-10T16:25:15Z"
started: "2026-09-10T16:25:22Z"
merged: "2026-09-10T16:33:35Z"
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
listing the three steps; ✕ still dismisses for good. Round 2 (owner,
2026-09-10): the row carries `lg:hidden` — at 1280px it does not render at
all, because a desktop browser installs from its own omnibox PWA icon, not a
share menu.
