---
id: B1542
title: The title page's reverse is printed on, so the title leaf reads as a page rather than a title
type: ISSUE
priority: medium
complexity: low
area: photobook
found: "2026-09-11T21:18:24Z"
started: "2026-09-11T21:23:17Z"
merged: "2026-09-11T21:30:53Z"
---

# B1542 — The title page's reverse is printed on, so the title leaf reads as a page rather than a title

## Why

`draftsForFront()` in `lib/photobook/plan.ts:1297` opens with
`{ kind: "title", align: "recto" }` and nothing after it. `emit()`
(`lib/photobook/plan.ts:1356`) inserts a blank only when the *next* draft asks
for a side it cannot have, so whatever follows the title — the intro, or the
left half of the route spread, which asks for `verso` and already is one —
prints on the back of the title leaf.

Every chapter opener carries `align: "recto"`, so a day chapter that lands on a
verso gets a blank facing page and reads as a fresh start. The title page,
which is the one page in the book that most wants that, does not get it: turn
the leaf and the trip has already begun on its reverse.

A blank verso after the title page is the printing convention — the title leaf
is a leaf, not a page — and it is what the rest of this planner already does
for chapters.

## Work

Give the title its own blank verso in `draftsForFront()` — the smallest form is
pushing `{ kind: "blank" }` straight after the title draft, since the title is
always page 1 and its reverse is therefore always page 2. Do not reach for a
new `align` value; `emit()` inserts blanks *before* a draft and cannot express
"leave the page after this one empty".

Watch what it moves: everything downstream shifts by one page, so the route
spread's `align: "verso"` now falls where it wants without a blank of its own,
and the padding arithmetic in `growOrPad` sees a book one page longer.
`normalisePageCount` may therefore choose a different signature count.

Not doing: the back cover, the colophon, or any other convention page. One
blank, after the title.

## Acceptance

- A rendered book's page 2 is blank; the intro or the route spread starts on
  page 3.
- The blank is not counted as content anywhere that reports what the book
  holds, and no `blank-padding` warning is raised for it.
- Seen in a real render — `/docs/branding/print` shows margins, not sequence,
  so this one needs an actual PDF of an existing trip, not a fixture built for
  the change.

## What was found and done

**Valid.** `draftsForFront()` (`lib/photobook/plan.ts:1297`) opened with the
title alone, and `emit()` (`:1356`) only inserts a blank *before* a draft whose
`align` cannot be satisfied — so the intro printed on page 2, the back of the
title leaf. Confirmed on `example/alps-2024` before the change:
`1 R title / 2 L intro`.

The fix is the one line the Work section named: a `{ kind: "blank" }` pushed
straight after the title draft, with the reasoning beside it. No new `align`
value — `emit()` cannot express "leave the page after this one empty", and
teaching it to would have been a second concept for one page.

Nothing downstream needed adjusting. `splitIntoVolumes()` takes `frontLength`
as an argument, so the extra page is accounted for by arithmetic that was
already there, and the route spread's own `align: "verso"` now falls where it
wants without a blank of its own — on `example/asia-2023` the spread sits on
4–5 exactly as it did before.

## Evidence

- `test/photobook.test.ts` — "opens with the title on a recto" now also asserts
  `pages[1].kind === "blank"`. Fails without the change
  (`expected 'intro' to be 'blank'`), passes with it.
- `npm run verify` — all 5 steps, 539 files, 7048 tests.
- `npm run photobook -- --trip example/alps-2024 --outline`:
  `1 R title / 2 L blank / 3 R intro / 5 R chapter 1/3`.
- A real PDF, not a fixture: `alps-2024-interior.pdf` rendered from the
  existing example trip, page 2 white and page 3 the intro.
- No `blank-padding` warning appeared that was not there before; the trip's
  own short-book warning is unchanged.
