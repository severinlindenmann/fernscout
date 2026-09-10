---
id: B1359
title: Small sheets open as a mostly white full-height page
type: FEATURE
priority: high
complexity: low
area: helper
found: "2026-09-10T18:23:02Z"
started: "2026-09-10T18:23:12Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T18:23:12Z"
---

# B1359 — Small sheets open as a mostly white full-height page

## Why

B1353 gave every Sheet a fixed 92dvh so it would stop opening as a
top-anchored stub — right for full-content sheets, and a huge white page for
the two-line ones (Darstellung, bring-agent). Owner's screenshot and
decision F01 A, 2026-09-10.

## Work

The Sheet is a bottom sheet with content height everywhere: anchored
bottom, `h-auto`, `max-h-[92dvh]` (80dvh on lg) — the same shape the
Guthaben sheet already had.

## Acceptance

At 390px the Darstellung sheet is ~157px tall and hugs the bottom
(measured 687→844 in Playwright); a tall sheet still stops at 92dvh and
scrolls inside.
