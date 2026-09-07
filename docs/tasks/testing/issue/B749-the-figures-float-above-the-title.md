---
id: B749
title: The figures float above the title with a gap, and repeat on every chapter divider
type: ISSUE
priority: medium
complexity: low
area: photobook, print
found: "2026-09-07T00:00:00Z"
merged: "2026-09-07T13:21:37Z"
---

# B749 — The figures float above the title with a gap, and repeat on every chapter divider

## Why

Reported the moment B740 made the figures visible at all, which is the point
of making a drawing visible: *"make the figures feel less out of place, right
now it is not centred nicely"* and *"the figure is used too often"*.

**They sit apart from the title.** `render.ts`'s title case places them at
`c.y + c.height * 0.52` and the title block below, so on a square page there
is a band of paper between the party and the words they belong to. Whatever
"centred" is finally right here, two things on a page with nothing between
them read as two decisions rather than one.

**They repeat.** B727 put them on *every* chapter divider, plus the title page
and the colophon that already had them. On a one-country trip that is three
pages of the same drawing in a short book; on a four-country trip it is six.
The owner's answer when asked: the first divider only, so a book carries them
at most three times however long the trip is.

## Work

- Sit the party on the title, not above it with a gap: close the distance so
  the two read as one block hanging off the same margin.
- `figures` on a chapter page only when `index === 1`. The planner already has
  the index and the count on the draft, so this is where the decision belongs
  — the renderer keeps drawing whatever it is handed.
- Not doing: a second position, a mirrored pose, or a size that varies by
  page. Those were the other two answers to "too often" and were not chosen.

## Acceptance

- A four-country book draws the party three times: title, first divider,
  colophon.
- The title page's figures and its title read as one block.
- Looked at in the composer's preview and in the rasterised PDF, per
  `check-a-drawing` — both, since B740 is the record of what happens when only
  one is checked.

## Findings (2026-09-07)

Both, and both were one number each.

**On the title, not above it.** The party's box moved from `c.height * 0.52`
to `0.4` in `render.ts`, and the preview's from `bottom:52%` to `40%`. The
title's own baseline is at `0.34`, so they now sit on it rather than across a
band of paper from it. Checked in the rasterised PDF: the pair stand directly
over "Algarve" with the rule and the dates beneath.

**Once per book.** `figures` on a chapter page is filled only when
`draft.index === 1`, in `materialise` — the decision belongs to the planner,
which already has the index and the count; the renderer goes on drawing
whatever it is handed. So the ceiling is three appearances (title, first
divider, colophon) however many countries a trip crosses; a four-country book
used to draw six. `test/photobook-travellers.test.ts` counts them, and counts
the preview's drawings against the plan's pages so the two cannot drift.

While here, `materialise`'s seventh argument became `marks: { figures,
vehicles }` rather than growing a second loose boolean beside the first.

`npm run verify`: all four passed (4529 tests).
