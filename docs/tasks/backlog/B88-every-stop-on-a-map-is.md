---
id: B88
title: Every stop on a map is a dot, which says nothing about where the point actually is
type: FEATURE
priority: low
complexity: low
area: map, ui
found: "2026-09-03"
---

# B88 — Every stop on a map is a dot, which says nothing about where the point actually is

## Why

On `/[user]/trips` the lifetime map marks each stop with a filled circle —
`components/LifetimeMap.tsx:123–131`, `r={size(2.2)}` with a cream ring. It is
a large, symmetrical blob, and it has two problems that a pin does not.

**It covers the thing it marks.** A dot is centred on the coordinate, so the
place it points at is underneath it. `size()` (`:62`) scales the radius with
the frame, which B46 introduced so a one-city journal did not get a marker
wider than its own map — but it scales it *up* on a wide frame too. A journal
spanning two continents draws stops several hundred kilometres across, sitting
on top of the coastline that would tell you which city it is. A pin's tip is
one point and its head sits above the ground it names, so the map underneath
stays readable.

**Two stops near each other merge into one shape.** Dots of equal weight,
overlapping, read as a single larger dot. Pins overlap legibly, because the
heads stack and the tips stay apart.

There is a third thing, which is that dots are what every other element on the
map already is: `WorldMap.tsx:369` draws reference towns as circles, and the
route's own vertices are circles. Nothing distinguishes "a place on this trip"
from "a town for orientation" except size and fill.

The same circle appears on all four maps, at four sizes:
`LifetimeMap.tsx:127` (`size(2.2)`), `WorldMap.tsx:534` (`px(13–18)`, and the
clustered marker carries a count),`WorldMap.tsx:430`, and `MiniMap.tsx:118`
(`px(9)`).

## Work

Draw a pin instead of a dot on the lifetime map: a teardrop or a
circle-plus-tail whose **tip is the coordinate**, with the body above it. Keep
the accent colour per trip (`ACCENT_HEX`) and the cream outline, so the legend
at `LifetimeMap.tsx:139–150` still matches.

Two things to get right, because a pin is not a rotation-free shape the way a
circle is:

- It must keep its size on screen, not in viewBox units — the `size()` helper
  at `:62` exists for exactly this and a hand-written path will not get it for
  free. B46 is the record of what happens otherwise.
- The route polyline (`:110–119`) joins the *coordinates*, so a pin whose body
  sits above the tip means the line arrives at the tip and the body floats over
  it. That is correct and is what a pin should look like; check it does not
  read as the line missing the marker.

**Scope: the lifetime map on `/[user]/trips` only.** `WorldMap`'s markers are
interactive — selectable, clusterable, carrying a count when `many`
(`:551–560`) — and a pin has to hold a two-digit number and a focus ring
without either looking wrong. That is a separate change and should be a
separate task once this one has been looked at. `MiniMap` is small enough that
a dot is probably right. Say in a closing line which way the WorldMap question
went, so nobody re-opens it.

Not doing: a map library, a marker image, or clustering on the lifetime map.

Related: B78 for the transport styling on the same maps.

## Acceptance

- `/example/trips` draws each stop as a pin whose point sits on the coordinate,
  and the coastline under each stop is visible in a way it is not now.
- The pin is the same size on screen for a journal spanning one city and one
  spanning two continents.
- The legend still pairs each trip's colour with its title.
- The map still carries its `role="img"` and `aria-label` (`:73–74`) — the
  marker change must not turn it into something a screen reader enumerates.
- `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, `npm run build`.
