---
id: B1771
title: The first and last day of a trip keep photographs taken at the owner's own address
type: ISSUE
priority: high
complexity: medium
area: fernscout-helper icloud-export, narrow.mjs
found: "2026-09-15T06:24:25Z"
---

# B1771 — The first and last day of a trip keep photographs taken at the owner's own address

## Why

`narrow.mjs` keeps a photograph when it was taken within `--km` of anywhere one
of the trip's own people stood that day. On the first and last day of a trip
one of those places is home — the journey there and the journey back are part
of the day — so every photograph taken at the owner's own address on those two
days passes the filter and is published as part of the trip.

This is how a Swiss identity card, front and back with the MRZ readable,
photographed at home at 14:50, ended up inside a spa weekend in another
country. The filter is doing what it was written to do; what it has no notion
of is that one of the day's anchors is the place that must never be published.

`narrow.mjs` has no `--home` at all, although `find-trips/discover.mjs` already
takes one (and takes several, since a household has more than one).

## Work

Give `narrow.mjs` the same `--home lat,lng` (repeatable, defaulting to whatever
`household.json` records) and, on the first and last day of the selection, drop
or at minimum flag photographs taken within a few kilometres of a home
position. Flagging is enough if the count is printed and the frames are
reachable on the review page — the decision is the person's, the discovery is
not.

The radius wants to be a knob (`--home-km`, default ~5) rather than a constant:
what counts as "at home" differs between a village and a city block.

## Acceptance

A trip whose first and last day include photographs taken at a `--home`
position reports them, and they are out of `photos.json` (or marked) rather
than published as part of the trip.
