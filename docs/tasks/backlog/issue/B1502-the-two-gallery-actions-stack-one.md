---
id: B1502
title: The two gallery actions stack one per line on a small phone, and the step bar wraps mid-row
type: ISSUE
priority: high
complexity: low
area: postcards
found: "2026-09-11T18:30:46Z"
---

# B1502 — The two gallery actions stack one per line on a small phone, and the step bar wraps mid-row

## Why

Two faults at 390, both spacing:

- The gallery\x27s two actions — *Fotobuch erstellen* and *Postkarte senden* —
  stack one per line, so the header is three rows deep before the filter chips.
  They are short enough to sit side by side.
- On the postcard page the step bar wraps mid-row: `1 Ansehen` and
  `2 Schreiben` on one line, `3 Senden` and `1 von 3` on the next, which reads
  as two groups rather than one bar. It also sits hard against the intro above
  it.

## Work

The gallery actions share a row at every width. The step bar fits three pills
across 390 — tighter padding and the count under the row rather than beside it
— and takes a margin above so the intro is not touching it.

## Acceptance

At 390: two actions on one row in the gallery header; three steps on one row on
the postcard page, with air above them.