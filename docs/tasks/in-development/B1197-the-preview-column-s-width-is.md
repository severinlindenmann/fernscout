---
id: B1197
title: The preview column's width is stored and never read back after a reload
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-09T22:34:28Z"
started: "2026-09-09T22:35:07Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-09T22:35:07Z"
---

# B1197 — The preview column's width is stored and never read back after a reload

## Why

Persona round (Elena): she dragged the preview to 443px, worked on, and a
reload reset it to 380px. B1121 stores the width in localStorage on drag
release and reads it in a lazy `useState` initializer — but the server
renders 380, and the hydration pass keeps the server-rendered inline style
(the initializer's client value loses), so the stored width is never
applied. The classic storage-in-initializer trap the photobook composer
already hit (B603's neighborhood).

## Work

Read the stored width in a `useEffect` and set state — the standard
adjust-after-mount shape — leaving the initializer at the default so
server and client agree at hydration.

## Acceptance

Resize, reload: the width survives (Playwright assertion on the column's
style).
