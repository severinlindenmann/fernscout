---
id: B756
title: A party of five overlaps the title it was moved onto, and the vehicles cannot be found on a real book
type: ISSUE
priority: high
complexity: low
area: photobook, print
found: "2026-09-07T13:38:21Z"
merged: "2026-09-07T13:50:03Z"
---

# B756 — A party of five overlaps the title it was moved onto, and the vehicles cannot be found on a real book

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Reported against the live site, and one of the two is mine.

**Five figures come down through the title.** B749 moved the party from a
fraction of the page (`0.52`) to a lower one (`0.4`) so they would stop
floating. It was checked against a party of *two* and a one-line title, which
is the only case where two unrelated percentages happen to agree. On
`example/asia-2023` — five figures, a title that wraps — they overlap the
words.

**"I don't see any train, car, aeroplane."** Not a bug in the drawing: driven
against that same trip, the transport page draws all six correctly. It is that
`includeVehicles` and `includeFigureMarks` both ship **off**, so the owner who
asked for the feature went through the questions, was shown both tiles, and
came away thinking it did not work. A switch somebody has to find is a feature
they do not have.

## Findings (2026-09-07)

**Placement is now derived, not guessed.** In the PDF the party's feet sit on
the top of the title's own first line (`titleBaseline + cap height + 5mm`),
which is party-independent and wrap-independent and cannot overlap by
arithmetic. In the preview they are rendered *inside* the title's own stack
rather than absolutely positioned, so the browser does the same arithmetic for
free. The two percentages that had to agree by coincidence are gone.

**Both drawings start on where there is something to draw.** The same rule
`includeCharts` has followed since B642, and the same safety: `hasFigures` and
`hasTransport` are already computed on both photobook pages, so a journal that
has described nobody and a trip that never said how it moved still start off —
there the switches would draw nothing anyway. `DEFAULT_OPTIONS` is unchanged
for callers with no trip to look at, and a saved arrangement is untouched.

**Validated against the demo, which is what was asked for.** A first visit to
`example/asia-2023` with nothing touched, straight out of the questions:
figures on exactly three pages (title, first chapter divider, colophon) and
six vehicles on the transport page — train, bicycle, flight, car, bus, boat,
with "1 day walking" correctly drawing nothing. The title page checked in the
preview (figures bottom 197px, title top 205px — no overlap) and in the PDF at
two sizes with a five-figure party and a two-line title.

`npm run verify`: all four passed (4588 tests).
