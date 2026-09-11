---
id: B1267
title: The menu holds two entries both labelled Trips that go to different places
wontDo: "The duplicate was raised and overruled twice already. B886 set the chip to 'Switch trip' for exactly this reason; B894 reverted it to 'Trips' the same day because the owner asked for the short word twice, knowing it repeats nav.trips. Asked again on 2026-09-11 and answered the same way."
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

## Closed, 2026-09-11 — asked a third time, answered the same

`components/TripSwitcher.tsx:94-99` already carries the history in a comment:
the word is `trips.chip` because *"'Reise wechseln' proved too long again on a
phone"*, and *"that duplicate name is a real cost and was raised and overruled,
which B886 records."*

The sequence: **B886** changed the chip to `trips.switch` ("Switch trip") on the
reasoning this ticket gives. **B894**, the same day, reverted it to `trips.chip`
because the owner asked for the short word twice and accepted the duplication
knowingly.

So this ticket's observation is correct and its fix has already been tried,
disliked and reverted. Closed rather than left open, because an open ticket
proposing a reverted change is how it gets made a third time by somebody
looking for something useful to do.

If the duplication is ever worth solving, the untouched half is the *other*
entry — the destination label — not the chip.
