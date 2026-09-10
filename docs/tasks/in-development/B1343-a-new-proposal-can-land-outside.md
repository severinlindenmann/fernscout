---
id: B1343
title: A new proposal can land outside the visible chat
type: FEATURE
priority: high
complexity: medium
area: helper
found: "2026-09-10T17:04:29Z"
started: "2026-09-10T17:04:42Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T17:04:42Z"
---

# B1343 — A new proposal can land outside the visible chat

## Why

A turn ending in a proposal focused the card, which scrolls the minimum —
on a tall card the accept buttons stayed below the fold (E05 A,
2026-09-10).

## Work

After focusing the first proposal of the latest turn, the room also calls
`scrollIntoView({ block: "nearest" })` on it, so as much of the card as fits
is shown, buttons included wherever the card fits at all.

## Acceptance

On desktop, a turn that answers with a proposal leaves the card and its
Speichern/Sein-lassen row in view without manual scrolling.
