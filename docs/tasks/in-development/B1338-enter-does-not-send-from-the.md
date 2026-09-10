---
id: B1338
title: Enter does not send from the desktop composer
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-10T16:54:18Z"
started: "2026-09-10T16:56:26Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T16:56:26Z"
---

# B1338 — Enter does not send from the desktop composer

## Why

The composer decides Enter-sends by reading `(pointer: coarse)` once at
mount (B1211/D13). A room mounted while Chrome's device emulation was on —
exactly the owner's situation after mobile testing — kept `coarse: true`
after switching back to desktop, so Enter inserted a line break until a full
reload. `components/HelperAsk.tsx`.

## Work

The media query is subscribed (`addEventListener("change")`) instead of
read once, so Enter behaviour follows the actual pointer live — emulation
toggles, tablets docking to keyboards.

## Acceptance

With the room open, toggling DevTools device emulation off makes Enter send
without a reload; on a real phone Enter still breaks the line.
