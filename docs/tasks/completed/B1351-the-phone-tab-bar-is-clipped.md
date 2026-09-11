---
id: B1351
title: The phone tab bar is clipped by the iPhone's rounded corners in the PWA
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-10T17:35:32Z"
started: "2026-09-10T17:35:41Z"
merged: "2026-09-10T17:49:10Z"
---

# B1351 — The phone tab bar is clipped by the iPhone's rounded corners in the PWA

## Why

In the installed PWA the tab bar's corners were clipped by the iPhone's
rounded screen corners: `viewport-fit` was unset, so
`env(safe-area-inset-bottom)` — which the bar already pads with — resolved
to 0 in standalone mode.

## Work

`viewportFit: "cover"` in the root layout's viewport export. The body
paints its own cream ground, so drawing into the insets shows colour rather
than bars; the existing safe-area paddings now actually apply.

## Acceptance

On an iPhone with the PWA installed, the Chat/Dateien/Wie-es-aussieht bar
sits above the home indicator with its corners un-clipped. Needs the owner's
device — no emulator shows the physical corner radius.
