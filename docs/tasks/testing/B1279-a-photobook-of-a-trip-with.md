---
id: B1279
title: A photobook of a trip with three photographs contains none and cannot be ordered
type: ISSUE
priority: high
complexity: medium
area: photobook
found: "2026-09-10T10:34:09Z"
started: "2026-09-11T04:23:02Z"
merged: "2026-09-11T04:50:48Z"
---

# B1279 — A photobook of a trip with three photographs contains none and cannot be ordered

## Why

`test-mobile`, one trip, one published day, **three photographs on it**. Built a
book through the maker end to end. The result:

- The order button is **disabled**, under a red line reading *"A book needs at
  least one photograph. Bring one back into the selection before paying."*
- The spreads render the day's text with **empty grey rectangles where the
  photographs go** (pages 4 and 5, "Day 1 · Old town, bears, and Einstein").
- The cover is blank white with the title only.
- On the same screen, the "Worth knowing before you order" panel says *"These 2
  photographs have too few pixels for this size…"* and renders two of them
  correctly, at `naturalWidth: 1600`, from
  `/test-mobile/media/bern-weekend-2026/2026-09-05/02.jpg` and `…/03.jpg`.

So the page can find and display the photographs while telling the person the
book has none of them.

**It is not a resolution threshold.** Switching from Square 20×20 to Pocket
square 14×14 changes the blur warning from two photographs to one — that panel
follows the size — and leaves the order refusal identical. Setting hardcover
does not change it either.

**It is not a mobile layout problem.** Reproduced at 1280×900 with the same
result: one image on the page, order disabled, same message.

**The instruction cannot be followed.** *"Bring one back into the selection"*
names a control that is not on the page at any width — there is no photograph
grid in "Change how the book is made", which offers only cover, format, and six
include/exclude switches.

`app/[user]/(trip)/photobook/page.tsx:59` states the intended behaviour plainly:

> Every photograph is in the book until the owner says otherwise, so the grid
> starts fully selected.

Which is the opposite of what happens here, so something between
`getAllMedia(trip.ref, AS_AUTHOR)` and the selection the order check reads is
dropping every image.

This makes a 40-credit feature unusable on a journal that has photographs, and
the failure is silent right up to the moment of paying.

## Worth checking while investigating

- `/example/…/photobook` is a **404** for every trip on the demo journal, so
  there is no working example on this instance to compare against.
  `photobookEntryFor(trip)` returning null is the gate; whether that is right
  for the demo is a separate question, but it does mean this feature has no live
  reference rendering.
- The day's `gallery` entries carry journal-relative `src` values
  (`/media/bern-weekend-2026/2026-09-05/01.jpg`) and were attached through the
  helper's inbox, which renames files by hash. If the selection is keyed on
  something other than that `src`, that is the likely join that is failing.

## Acceptance

- A trip with photographs produces a book whose spreads contain them, and whose
  order button is enabled.
- The blur warning and the "needs at least one photograph" check are computed
  from the same set, so they cannot disagree.
- Any message telling the person to change the selection is only shown where a
  selection control exists.
