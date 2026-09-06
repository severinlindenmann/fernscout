---
id: B565
title: The transport and costs pages are tables, and nothing shows the weather or the shape of the trip
type: FEATURE
priority: medium
complexity: high
area: photobook, print, design
found: "2026-09-06T10:56:07Z"
---

# B565 — The transport and costs pages are tables, and nothing shows the weather or the shape of the trip

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The book's three summary pages are the weakest thing in it.

*How we got about* is a sentence and a rule: **"3"** days driving, then "3 legs
written down, from Denver to Cannon Beach". *What it cost* is a six-row table of
category against amount, a total, and two lines of budget. Both are the shape a
database would print if asked. They sit in a book of photographs.

And the trip's own weather is not in the book at all. Since B325 a day can carry
a measured reading in `weatherData` — a real archive measurement at that day's
own coordinates, credited — and `lib/entries.ts` already parses it onto the
entry. `lib/photobook/` never looks at it. The one number in this system that is
both trustworthy and interesting is missing from the artefact people pay for.

A photobook of a journey should be able to show the shape of that journey: how
far, how, how much, in what weather. That is the thing nobody's own photographs
can show them, and it is the strongest argument for a book over a folder of
pictures.

## Work

**Design the two pages that exist**, and add an optional spread that earns its
paper.

Charts rather than tables: spend by category, spend over time against the
budget, distance or days by transport mode, temperature across the trip with the
wet days marked. Choose what the data supports — a trip with no `costs.md` and
no weather gets fewer, and must still look deliberate rather than broken.

**The optional spread is one switch**, alongside the existing include-switches,
and off is a legitimate answer: somebody printing a book of photographs may not
want a page of charts in it.

### The trap, and it is the whole cost of this ticket

**Everything drawn here has to be drawn twice** — once by the PDF renderer in
raw PDF operators, once by `lib/photobook/preview.ts` for the browser — and the
two must agree or the composer lies about the book. That is B552's duplication,
and a chart is far more geometry than a rectangle of text.

So: **compute the geometry once, render it twice.** Pure functions that take the
numbers and the box and return points, paths and labels in millimetres; the PDF
renderer and the preview both consume that and neither does arithmetic of its
own. `graticuleStep()` is the existing precedent — extracted for exactly this
reason when the map drifted between the two.

A chart whose axis is computed separately in two places will disagree, and the
disagreement will be found by a customer holding the printed book.

### Also

Weather must come from `weatherData` only. **Never infer, never fill a gap with
something plausible** — AGENTS.md is explicit and it is not softened by a chart
needing a continuous line. Days without a reading are gaps and should look like
gaps. Credit the archive, as the day pages do.

**Not doing:** new data collection. No new frontmatter, no lookups, nothing
asked of the author. This draws what the trip already recorded.

## Acceptance

- The transport and costs pages read as designed pages rather than tables.
- An analytics spread can be switched on and off, and off is the default until
  somebody decides otherwise.
- A trip with no costs and no weather still produces a book that looks
  deliberate.
- Every chart's geometry comes from one shared computation — a test pins the
  preview and the PDF to the same numbers.
- No weather value appears that did not come from `weatherData`.
