---
id: B1259
title: A trip prints the span of the days written rather than its own dates, and a single day reads as 5 Sep to 5 Sep
type: ISSUE
priority: medium
complexity: low
area: trip page
found: "2026-09-10T10:01:50Z"
---

# B1259 — A trip prints the span of the days written rather than its own dates, and a single day reads as 5 Sep to 5 Sep

## Why

A trip created through the wizard with

```yaml
start: "2026-09-05"
end:   "2026-09-08"
```

and one day written, on 5 September, shows this under its title on the trip page:

> **Bern Weekend**
> 5 Sep – 5 Sep

`components/TripHero.tsx:184` renders `stats.firstDate` and `stats.lastDate` —
the span of the *entries that exist*, not the trip's own `start` and `end`.

Two things are wrong with that line and they are worth separating.

**It contradicts the trip.** The dates in `trip.md` are the ones the person
typed and cannot casually change; the same page reasons from them elsewhere
("The trip is over" comes from the real `end`). A reader is told this was a
one-day trip when it was four. Worse for a trip in progress: the range grows day
by day as the journal is written, so the trip advertises a shorter span than it
has, right up until the last day is published.

**A single day is printed as a range of itself.** "5 Sep – 5 Sep" is not
something anybody writes, and every trip has this shape on its first day.

## Work

- Decide which fact the line is stating. The trip's own dates are the honest
  answer for a heading under the trip's title; the span actually covered is a
  different, also-useful fact, and if it is worth showing it needs a label
  saying so rather than sitting where the trip's dates belong.
- Whichever is chosen, collapse an equal pair to one date.
- Check the same values are not being used elsewhere on the same assumption —
  the day strip, the sitemap, the trip card on `/<user>/trips`.

## Acceptance

- A trip declaring 5–8 September with one day written shows 5–8 September.
- A trip whose start and end are the same day shows one date, not "X – X".
