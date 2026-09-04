---
id: B221
title: A comment in mapFrame points at a file and a helper that do not exist
type: ISSUE
priority: low
complexity: low
area: maps, docs
found: "2026-09-04T07:25:50Z"
started: "2026-09-04T08:08:59Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T08:08:59Z"
---

# B221 — A comment in mapFrame points at a file and a helper that do not exist

## Why

`lib/mapFrame.ts:134`, the doc comment on `frameSpanKm`:

> The number the "is this too close in to draw a coastline" question is asked
> of — see `hasUsableBasemap` in lib/mapBasemap.ts.

There is no `lib/mapBasemap.ts` and no `hasUsableBasemap` anywhere in the
repository — `grep -rn hasUsableBasemap .` returns that one line, its own
mention. The question it describes is not asked either: `lib/basemap.ts` says
in as many words that nothing decides in advance whether Natural Earth has
anything to say about a place, because an empty clip draws the clean
background by itself. So the comment sends a reader to a file that does not
exist, to read about a decision the code deliberately does not make.

`frameSpanKm` itself is real and used (`components/WorldMap.tsx`, for the zoom
ceiling). Only the sentence about it is wrong.

Noticed while reading the file for B177. Small, and the kind of thing that
costs somebody ten minutes at exactly the wrong moment.

## Work

Say what `frameSpanKm` is actually for — the zoom ceiling in `WorldMap`, and
the band thresholds in `lib/basemap.ts` — and drop the dead reference. Check
the neighbouring comments in the same file for others of the same vintage
while the file is open.

## Acceptance

- `grep -rn "mapBasemap\|hasUsableBasemap" --exclude-dir=node_modules .` finds
  nothing outside `docs/tasks/`.
- The replacement names a file and a symbol that exist.
