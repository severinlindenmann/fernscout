---
id: B1349
title: The files tab's upload block stacks two lonely buttons around a paragraph
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-10T17:35:31Z"
started: "2026-09-10T17:35:40Z"
merged: "2026-09-10T17:49:09Z"
---

# B1349 — The files tab's upload block stacks two lonely buttons around a paragraph

## Why

On the phone files tab, "Dateien wählen" and "Kamera" sat as two lonely
buttons separated by the none-chosen line and the what-goes-where paragraph.
Owner's iPhone-15 PWA screenshot, 2026-09-10.

## Work

`PhotoPicker` gained a `bare` mode (button only); the room's upload block
lays the picker and the camera button side by side in one wrapping row, with
the status line and the inbox hint below both. The wizard's and EditDay's
full picker are unchanged.

## Acceptance

At 390px the two buttons share a row (same top, measured in Playwright);
the hint paragraph sits under them.
