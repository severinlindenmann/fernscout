---
id: B667
title: The importer folder is flat, so it only ever describes one kind of data
type: CHORE
priority: medium
complexity: low
area: importers, docs
found: "2026-09-07T08:33:27Z"
started: "2026-09-07T08:33:43Z"
session: 1d31e523-3a22-4905-82fd-39e3d55289f5
claimed: "2026-09-07T08:33:43Z"
---

# B667 — The importer folder is flat, so it only ever describes one kind of data

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B665 put four importers in `importers/` as a flat folder, and all four happen
to read positions. The folder therefore *says* it is the GPS folder while
being named as though it were the importer folder, and `importers/types.ts`
defines `Fix` — a coordinate and an instant — as though that were what every
importer everywhere produces.

The second kind of data is already foreseeable: a bank export into a trip's
costs (B663 keeps `inbox/files/` for exactly that arrival). Under the flat
layout `revolut.ts` would sit beside `gpx.ts` with nothing saying they answer
different questions, and the shared `Fix` would have to grow fields that mean
nothing to either.

## Work

The kind goes in the path:

```
importers/
  README.md  LICENSE        unchanged, still MIT
  types.ts                  the shape every importer has, whatever it reads
  gps/
    types.ts                Fix, and the geo helpers
    google-timeline.ts google-records.ts gpx.ts fixes.ts
```

`Importer<Row>` in the root `types.ts` — `id`, `label`, `detect`, `parse` — and
`GpsImporter = Importer<Fix>` in `gps/types.ts`. One generic parameter and
nothing else: the second kind is `importers/costs/` with its own `types.ts` and
its own consumer, and that is the whole extension story. No registry, no plugin
interface, no shared base class.

Discovery moves from `importers/*.ts` to `importers/gps/*.ts` in
`scripts/gps.mts` — a GPS command reads GPS importers, and a future costs
command reads its own folder rather than filtering a shared pile.

Docs to follow: `importers/README.md`, `docs/gps.md`, `AGENTS.md`, the root
`README.md`, and `knip.jsonc`'s entry pattern.

## Acceptance

- `npm run gps -- formats` lists the same four importers from their new home.
- `npm run gps -- import` on a real export behaves identically.
- The root `types.ts` names no coordinate; `Fix` is only in `gps/`.
- `importers/README.md` says where a non-GPS importer goes.
- `npm run verify` and `npm run unused` pass.
