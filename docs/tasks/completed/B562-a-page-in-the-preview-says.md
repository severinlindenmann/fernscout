---
id: B562
title: A page in the preview says 9 · photos · full-bleed instead of where it came from
type: FEATURE
priority: medium
complexity: low
area: photobook, composer, ux
found: "2026-09-06T10:56:06Z"
merged: "2026-09-06T11:40:39Z"
completed: "2026-09-07T13:12:00Z"
---

# B562 — A page in the preview says 9 · photos · full-bleed instead of where it came from

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

Under each page in the preview: `8 · day`, `9 · photos · full-bleed`,
`23 · transport`, `26 · colophon`.

Those are the planner's own words for its page kinds. `full-bleed` is a
printer's term, `colophon` is a publisher's, and `photos` is neither — it is a
variant name from `BookPage`. None of them tell the reader the one thing they
want: **where this page came from, and what put it there.**

Same disease B549 treated in the warnings, one layer down. The composer stopped
naming error codes; it still names page kinds.

## Work

Say the provenance in the reader's words. A page from a day says which day —
"Day 1 · Denver, and a truck". A page that exists because an option is on says
which option, in the same words that option uses on the settings panel — the
route map pages say the route map is being printed, the costs page says the cost
summary is.

That second half is what makes the caption worth having: it is the explanation
of *why this page is in my book*, and it is the fastest route to "I do not want
this" — which is what the include-switches are for.

The wiring is mostly there. `BookPage`'s `day` variant carries `date`, and B534
added `date` to the `photos` variant for the drill-in. What is missing is a
label for the pages that belong to an option rather than to a day.

Keep the page number: it is the one technical thing a person ordering a printed
book does want.

## Acceptance

- No page caption contains `full-bleed`, `colophon`, `photos` or another
  internal variant name.
- A page belonging to a day names that day.
- A page that exists because of an option names that option, in the words the
  option itself uses.
