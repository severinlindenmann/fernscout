---
id: B548
title: The composer's first screen is a form; it should be the book
type: FEATURE
priority: high
complexity: medium
area: photobook, composer, ux
found: "2026-09-06T09:04:23Z"
---

# B548 — The composer's first screen is a form; it should be the book

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

See B547 for the argument. This is its first and largest child.

Opening the composer at 390px gives you `Format`, `Cover`, `Language of the
book`, `Binding` and five `Include the …` checkboxes — nine decisions — before
any part of the book is visible. The preview is below all of that, rendered
into a **scrollable iframe about a third of the viewport tall**, so the book is
a letterbox you scroll inside while the page scrolls around it.

Every one of those nine has a good default already. The planner chooses the
arrangement well; that is the whole reason this is fixable. Demanding nine
answers before showing the result asks the reader to imagine what the software
could simply show them.

## Work

**The book is the screen.** Full width, as large as 390px allows, spreads
swiped horizontally rather than scrolled inside a box. Above it the trip's name
and a plain line — pages and price. Below or sticky, one primary action:
order it.

**The nine settings move behind one entry** — "Change the format", or similar.
Not deleted: somebody who wants A4 landscape must still get it in two taps.
This ticket is about not demanding the answers before the question means
anything.

**Retire the iframe if it is what forces the letterbox.** Check first — it may
exist for style isolation, in which case keep it and give it the room. The
requirement is the book at full width, not a particular mechanism.

Vocabulary, while you are here: `1 volume(s)` and `16 warning(s)` are not
sentences. The book's own measurements — bleed, trim, recto, spine 1.8 mm,
300 DPI — belong wherever a person has asked for detail, not on the first
screen. B549 covers the warnings themselves.

**Not doing:** the day view (B550), the warnings' wording (B549), the order
step (B551). Coordinate: B549 edits the same screen, so one of you lands first
and the other rebases.

## Acceptance

- At 390px, part of the book is visible without scrolling.
- The preview is full-bleed to the page's own margins; no inner scrollbar.
- Reaching a format change takes at most two taps from opening the composer.
- No pluralisation of the form `volume(s)`.
