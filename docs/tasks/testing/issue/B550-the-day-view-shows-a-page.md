---
id: B550
title: The day view shows a page belonging to the next day, and its photo controls are unlabelled glyphs
type: ISSUE
priority: medium
complexity: low
area: photobook, composer
found: "2026-09-06T09:04:24Z"
merged: "2026-09-06T09:38:44Z"
---

# B550 — The day view shows a page belonging to the next day, and its photo controls are unlabelled glyphs

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Two defects in the day view B534 added, both found by looking at it at 390px.

**It shows a page that belongs to a different day.** Opening *Denver, and a
truck* (3 June) shows spreads containing pages 8 · day, 9 · photos, 10 · photos
and 11 · day — and page 11 is *Red country*, 19 June. The slice is taken by
spread rather than by page, so the facing page of the last spread comes along
whatever day it belongs to. A person editing one day is looking at another
day's page and cannot tell.

**The per-photograph controls are three unlabelled glyphs** — `‹`, `★`, `›` —
in a row under each thumbnail, with "Adjust what stays in frame" wrapping to two
cramped lines beneath. Nothing says what the star does or what moves where.

## Work

For the slice: decide by page, not by spread. A spread whose facing page is
another day's should render that half as context rather than as this day's —
dimmed, or not at all. `previewSlice.ts` is where this lives.

For the controls: give each an accessible name and a visible affordance. They
are move-earlier, use-as-the-day's-main-photograph, and move-later — say so.
The star in particular carries no meaning to anybody who has not read the
source.

## Acceptance

- Opening a day shows no page belonging to another day, or shows it visibly as
  context.
- Every control in the day view has a name a screen reader can announce and a
  person can guess.
