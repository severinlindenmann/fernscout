---
id: B1267
title: The menu holds two entries both labelled Trips that go to different places
type: ISSUE
priority: low
complexity: low
area: navigation
found: "2026-09-10T10:08:11Z"
---

# B1267 — The menu holds two entries both labelled Trips that go to different places
## Why

Open the menu on a phone and the word **Trips** appears twice, 680px apart:

- a chip in the top row, with a suitcase and a chevron — a `<button>` whose
  `aria-label` is *"Switch trip"*, opening the trip switcher
- a row in the list below, with a compass — an `<a href="/example/trips">`, the
  trips index page

Two controls, one word, two destinations, and nothing in the label distinguishes
them. On a phone they are far enough apart that they are never seen together, so
whichever one the person taps feels like the only one — and the two do different
things.

The icons do carry the distinction (a suitcase versus a compass), but an icon is
not what a person reads a menu by, and neither icon says "switch" or "index".

## Work

- Name what each does. The chip is a switcher — its `aria-label` already says so
  and the visible label does not. The row is the list of every trip.
- Check the same pair in German and Hungarian, where the two may already differ
  or may collide the same way.

## Acceptance

- No two controls in the open menu carry the same visible label.
- The switcher's visible label matches its `aria-label`.
