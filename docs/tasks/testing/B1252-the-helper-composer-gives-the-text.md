---
id: B1252
title: The helper composer gives the text under half the screen width on a phone
type: ISSUE
priority: medium
complexity: low
area: helper, mobile
found: "2026-09-10T09:49:04Z"
started: "2026-09-11T06:40:31Z"
merged: "2026-09-11T08:13:12Z"
---

# B1252 — The helper composer gives the text under half the screen width on a phone

## Why

Measured on fernscout.ch at a 390px viewport, in the helper room's composer:

| | |
| --- | --- |
| viewport | 390px |
| composer row | 340px |
| **textarea** | **190px**, at x=75 |

The textarea is 49% of the screen. Take off its own `px-3` and the text column
is about 166px — roughly 22 characters. One ordinary sentence about a day —
*"On Saturday we walked through the old town of Bern, crossed the Nydegg bridge
and watched the bears…"* — wraps into six lines, hits the `max-h-[152px]` ceiling
and starts scrolling inside a box the person cannot see the top of.

The width goes to three controls that flank the field on the same row: the
attach paperclip on the left, and the microphone and send buttons on the right,
each a round tap target. On a desktop width they cost nothing. On a phone they
cost more than half the line, and describing a day by typing is the thing this
room is for. Speaking is offered, but a person on a train is typing.

Screenshot from the run: `11-consent.png`.

## Work

- Let the text have the row. The usual shape on a phone is the field on its own
  line with the controls beneath or overlaid at the trailing edge, growing
  upward as the text does — not three tap targets sharing the line with it.
- Keep every control reachable one-handed and keep the tap targets at their
  current size; this is about where they sit, not how big they are.
- Check the same row in German, where the placeholder is longer.

## Acceptance

- At 390px the text column of the composer is at least 80% of the viewport
  width, measured on `document.querySelector("textarea").getBoundingClientRect()`.
- A two-sentence day description fits in three lines or fewer before scrolling.
- The attach, microphone and send controls are all still tappable at 390px.
