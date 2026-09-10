---
id: B1344
title: A turn that arrived via WhatsApp looks identical to a web turn
type: FEATURE
priority: high
complexity: medium
area: helper
found: "2026-09-10T17:04:30Z"
started: "2026-09-10T17:04:43Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T17:04:43Z"
---

# B1344 — A turn that arrived via WhatsApp looks identical to a web turn

## Why

A turn that arrived over WhatsApp rendered exactly like a web turn, and
the owner asked for the source to be visible — a WhatsApp glyph on those
turns, nothing on web turns (E08, 2026-09-10). The server already stored and
returned `origin` per turn; only the UI dropped it.

## Work

`origin` now travels through the `history`/`opened` props into the
`Exchange`, and a small inline WhatsApp SVG (aria-labelled "arrived via
WhatsApp", de/hu translated) renders inside the person's bubble when
`origin === "whatsapp"`. Web turns are unmarked by design.

## Acceptance

test/helper-room.test.tsx: rendering a history with one whatsapp and one
web turn shows exactly one mark. On the live site, a day written from
WhatsApp and reopened in the room shows the glyph on those turns.
