---
id: B1771
title: The first and last day of a trip keep photographs taken at the owner's own address
type: ISSUE
priority: high
complexity: medium
area: fernscout-helper icloud-export, narrow.mjs
found: "2026-09-15T06:24:25Z"
started: "2026-09-15T06:39:51Z"
merged: "2026-09-15T07:09:13Z"
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

## Built, 2026-09-15 — fernscout-helper `aa69dbd`

**Valid when taken**: `narrow.mjs` had no notion of home at all, and keeps
anything within `--km` of anywhere the trip's own people stood that day.

It takes `--home lat,lng` (repeatable, as `find-trips/discover.mjs` does) or
`homes` in `household.json`, and leaves out photographs taken within
`--home-km` (default 5) of a home **on the first and last day of the selection
only** — a photograph at home mid-trip is somebody else's and the place filter
already dealt with it. It says how many and on which days. `--keep-home` is how
somebody says the departure morning's kitchen table really does belong. With no
home position known the run says the check did not happen rather than passing
silently.

`--people <file>` was added at the same time, so the flag matches
`discover.mjs` and a test can hand over a fixture instead of the household's
own file.

Keeper: six checks in `icloud-export/narrow.test.mjs`, including the
no-home-known case.
