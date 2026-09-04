---
id: B381
title: A day with no coordinates becomes a nameless place, inflating the stop and country counts a page contradicts itself about
type: ISSUE
priority: high
complexity: low
area: maps
found: "2026-09-04T21:53:18Z"
started: "2026-09-04T21:54:31Z"
merged: "2026-09-04T22:07:29Z"
---

# B381 — A day with no coordinates becomes a nameless place, inflating the stop and country counts a page contradicts itself about

## Why

Found by writing one deliberately blank day into a QA trip on fernscout.ch
(e85248d): title, date, prose and translations, no `lat`/`lng`, no `location:`,
no `country:` -- the day somebody spends on a train with nothing to report.
Read back, it is exactly that:

```
{"lat": null, "lng": null, "location": "", "country": ""}
```

`getPlaces` turns it into a `Place` anyway, and three things on the trip go
wrong at once:

- The stop list gains a nameless, flagless row -- `4. Sep - gleicher Tag -
  0 Medien` -- sitting among Ljubljana, Ohrid and Skopje.
- **Orte** goes 3 to 4 and **Lander** 2 to 3, counting `""` as a country.
- The same page's own "Zeit pro Land" breakdown still lists **two** countries,
  so the header contradicts the section beneath it.
- The current-trip header renders "Gerade sind wir in" followed by nothing,
  because the latest day's place name is the empty string.

**This is not B339, though it is next door.** B339 was days that *have* valid,
distinct coordinates and an empty `location:`, merged into one place by
`"" === ""`. Here there are no coordinates at all, and the question is not how
such days group but whether a day with nothing to plot is a place. It is not.

`location:` and coordinates are both optional and always have been -- the guide
tells an agent to leave them empty rather than invent one (B265, B267) -- so
this is reachable by any honest day.

## Work

Skip a day with no coordinates when building places: it cannot be drawn, and
counting it makes two counters disagree on one page. Decide separately what the
"right now we are in" line should say when the newest day has no place -- the
previous named stop, or nothing at all, but not an empty string dressed as a
name.

## Acceptance

A trip with three located days and one day carrying no coordinates reports
three stops and two countries, its country breakdown agrees with its counter,
and no nameless row appears in the stop list.
