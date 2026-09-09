---
id: B868
title: The chips in the menu panel hide their labels to fit a header row they no longer sit in
type: ISSUE
priority: medium
complexity: low
area: header, nav, a11y
found: "2026-09-07T19:40:00Z"
merged: "2026-09-07T17:41:25Z"
completed: "2026-09-09T16:46:55Z"
---

# B868 — The chips in the menu panel hide their labels to fit a header row they no longer sit in

## Why

The owner, on the menu panel: *"the top icons — can we improve them? The left
one feels bad, or not easy to understand."*

The left chip is the trip switcher, and it **has** a label: the trip's own
title. It was hidden below `sm`, and the comment in `TripSwitcher.tsx` says
why — and diagnoses this complaint exactly:

> Below sm there isn't room for both this label and the nav's icons without
> the header itself overflowing … which left a bare chevron next to two other
> round buttons, saying nothing about what it opens. A chevron is a direction,
> not a subject.

**The constraint that forced it is gone.** That was written when the seven nav
icons shared the header row with these chips. B770 moved the nav into the menu
panel and the chips went with it, so below `sm` they now sit in a 332px column
with room to spare rather than competing for a 358px row. The workaround
outlived its reason, and what it left behind was a suitcase and a chevron.

Two smaller things in the same row:

- **Docs was icon-only** (B843), for the same reason and with the same fault —
  a lone document glyph standing in for a subject.
- **The currency chip's `Coins` icon is 14px and reads as a link.** It sits
  beside the word "CHF", which already says it, so it is decoration that
  costs legibility.

## Work

- Show the trip label at every width. Cap it below `sm` so a long title cannot
  push the row wide; the desktop's fixed box (B286) is unchanged.
- Give the Docs chip its word.
- Drop the `Coins` icon.

## Acceptance

- The trip chip names the trip on a phone.
- Docs reads as Docs.
- The header row itself does not grow, and nothing scrolls sideways at 390px.

## Done

Measured at 390px on `/example/trips/asia-2023`:

| chip | width | row |
| --- | --- | --- |
| 🧳 Five months east ⌄ | 177px | 1 |
| CHF | 47px | 1 |
| EN | 56px | 1 |
| Docs | 81px | 2 |

Header still **65px**, `scrollWidth` 390. The row wraps to two lines, which is
the trade-off and is right here: this is a vertical menu, not a header, and
four labelled chips cannot fit 332px however they are arranged.

**One change reaches the desktop too**: the `Coins` icon is gone from the
currency chip everywhere, not only in the panel. That is deliberate — the word
was always doing the work — but it is a visible change at `sm` and up, unlike
the other two, which are scoped below it.
