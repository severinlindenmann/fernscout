---
id: B1179
title: A reopened conversation reads as one undifferentiated wall with no date
type: ISSUE
priority: low
complexity: low
area: helper room
found: "2026-09-09T20:30:39Z"
started: "2026-09-09T20:31:02Z"
merged: "2026-09-09T20:44:36Z"
---

# B1179 — A reopened conversation reads as one undifferentiated wall with no date

## Why

A conversation reopened from the history panel draws as small grey
sentence / plain answer / small grey sentence with tight, even spacing —
sixteen turns read as one wall, and nothing says when the conversation
happened, though the history panel grouped it under a date a moment
earlier.

## Work

More air between exchanges than within one (the answer belongs to its
sentence), and one quiet date line above a conversation drawn from
storage — `formatLongDate` of its first turn. Within the room's no-bubbles
doctrine: no avatars, no background blocks.

## Acceptance

Reopening a stored conversation shows its date once at the top; an
exchange's question and answer sit visibly closer to each other than to
the next exchange.
