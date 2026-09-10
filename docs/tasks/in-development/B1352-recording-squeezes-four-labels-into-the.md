---
id: B1352
title: Recording squeezes four labels into the composer row
type: ISSUE
priority: high
complexity: low
area: helper
found: "2026-09-10T17:35:33Z"
started: "2026-09-10T17:35:42Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T17:35:42Z"
---

# B1352 — Recording squeezes four labels into the composer row

## Why

Holding the microphone in the composer exploded the row: "Hört zu… 5s",
the "Die Sprache, die du sprichst" label and a full-width select all
rendered as row items beside the textarea (owner's screenshot).

## Work

The compact branch of `RecordButton` now renders a two-digit stopwatch
("5s"), a screen-reader-only language label with a small inline select, the
sr-only status and errors — no sentences in the row. The full-size form is
unchanged.

## Acceptance

At 390px, recording shows the coral mic, "5s" and a small language select
in one line; nothing wraps vertically.
