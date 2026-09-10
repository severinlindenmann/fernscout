---
id: B1353
title: The sheets open top-anchored on a phone and the credits entry still says Speicher
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-10T17:35:33Z"
started: "2026-09-10T17:35:42Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T17:35:42Z"
---

# B1353 — The sheets open top-anchored on a phone and the credits entry still says Speicher

## Why

Two faults from the owner's phone: the menu entry still said "Guthaben &
Speicher" after the storage moved to the files pane (E07), and every Sheet
opened as a short top-anchored stub — Chrome gives `<dialog>` a UA
`height: fit-content`, so `top-[8dvh] bottom-0` never stretched it; a sheet
with little content (Darstellung) sat under the header and looked like
nothing had opened.

## Work

The menu entry and sheet title read "Guthaben"/"Credits"/"Kreditek". The
Sheet carries an explicit `h-[92dvh]` on phones (`lg:h-auto` keeps the
desktop bottom-sheet sizing).

## Acceptance

At 390px the Darstellung sheet spans from 8dvh to the viewport bottom
(measured 68→844 in Playwright); the ⋯ menu reads Sprache · Darstellung ·
Guthaben · Eigenen Agenten anbinden.
