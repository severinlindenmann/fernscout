---
id: B1359
title: Small sheets open as a mostly white full-height page
type: FEATURE
priority: high
complexity: low
area: helper
found: "2026-09-10T18:23:02Z"
started: "2026-09-10T18:23:12Z"
merged: "2026-09-10T18:29:51Z"
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
scrolls inside. Round 2 (owner, iPhone): both sheet kinds pad the bottom
with env(safe-area-inset-bottom) — viewport-fit=cover had put their lowest
content under the home indicator — and each body has a minimum height, so
the Guthaben sheet holds its shape while "Looking…" waits for the numbers
instead of opening as a sliver and jumping.
