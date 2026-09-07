---
id: B06
title: Location tracking ingest and route rendering (W20)
type: FEATURE
priority: medium
complexity: high
area: tracking, map, db
found: "2026-09-01"
superseded: ingest, importers and route rendering shipped as B665 and B671; live position is B666, map tiles is its own capture — see B665
---

# B06 — Location tracking ingest and route rendering

## Why

The one work package from the original run that was never started. Verified
2026-09-01: there is no `POST /api/track`, no positions table in
`lib/db/schema.ts`, and no tracking code in `lib/` or `app/`. The only
"overland" strings in the repo are trip prose in the demo content.

**The design already exists** — `docs/plans/W20-tracking.md`, covering
roadmap F1–F4, E4, E6 and B7. This item is the tracking entry in the backlog,
not a second copy of that plan. Read the plan before starting; what follows is
only what a reader needs to decide whether to pick it up.

Scope, in one line each: `POST /api/track` taking the OwnTracks and Overland
payloads with a per-trip token; a manual "check in here" button for the
low-tech case; Douglas–Peucker simplification so a five-month track does not
ship 400k points; privacy defaults with a kill switch; a Google Timeline
importer for both export formats; and, separately, real map tiles — the baked
`lib/worldLand.json` cannot do city level.

Complexity is `high` because of that last one. Tiles are a hosting decision
(Protomaps self-hosted vs a metered provider), not just code, and the plan
flags it as its own roadmap item rather than part of the ingest.

## Why it is medium and not high priority

It is the largest missing feature, but nothing is broken without it and no
other item depends on it. A PWA cannot track location in the background on
either platform — that constraint is the first line of the plan — so this is
always about accepting data from an app that can, which is a narrower promise
than "the journal tracks you".

## Work

Follow `docs/plans/W20-tracking.md`. Worth splitting: F1/F2 (ingest and manual
check-in) stand alone and are the useful half; F3/F4 and the tile question can
follow.

## Acceptance

The plan's own list, unchanged:

- OwnTracks posts land and render.
- 400k points render without shipping 400k points.
- Live position never appears on a public trip.
- Both Timeline formats import; malformed input degrades, never crashes.

## Superseded, 2026-09-07

Three of the four acceptance lines are met, by work that was never filed
against this id:

- **B665** built the store (`lib/gps/`), the thinning, `trips/<trip>/track.json`
  and the map that draws the road actually driven. A long track no longer
  ships its points.
- **B671** built the way in — `POST /api/v1/<user>/import` — and `importers/`
  now parses Google Timeline, Google Takeout, GPX and JSON Lines, degrading
  rather than crashing on malformed input.
- Live position never reaches a reading path at all: `test/gps-store.test.ts`
  asserts the import graph, which is a stronger answer than "never on a public
  trip".

What is left is not this ticket:

- **Live ingest from a phone** is **B666**, already captured.
- **Real map tiles** — the one thing `lib/worldLand.json` cannot do — is a
  hosting decision, and W20 flagged it as its own roadmap item. Captured
  separately rather than kept alive inside a ticket whose other four fifths
  are done.
