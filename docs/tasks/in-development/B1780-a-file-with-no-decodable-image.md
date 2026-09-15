---
id: B1780
title: A file with no decodable image survives every re-export and is rediscovered by each tool in turn
type: ISSUE
priority: low
complexity: low
area: fernscout-helper icloud-export, query.mjs
found: "2026-09-15T06:24:47Z"
started: "2026-09-15T06:40:03Z"
session: 135632db-3afb-4bd0-bf02-4ee0fb20ab0d
claimed: "2026-09-15T06:40:03Z"
---

# B1780 — A file with no decodable image survives every re-export and is rediscovered by each tool in turn

## Why

A library can hold a file with valid EXIF and no decodable image data — a 7.6
KB truncated JPEG in the case that found this. It is broken in the library, so
deleting the export and fetching it again returns the same bytes, and every
tool downstream discovers it separately: `bake.mjs` fails on it, `describe.mjs`
counts it as one it could not render, `build.mjs` asks `sips` for dimensions
and gets nothing. It came back a second time when the same date range was
queried again under a different trip name.

`query.mjs` is the one step that decides what the selection contains, and it is
the only place this needs to be said once.

## Work

Have `query.mjs` drop a file the library reports with no usable dimensions —
`osxphotos` knows the height and width — and name it once in its output, as
something broken in the library rather than something the export got wrong. If
the dimensions are not reliably available from the query, the count check
belongs in `export.mjs` beside B1772's instead; either way it is said once.

## Acceptance

A selection containing an undecodable file names it once at query time and does
not carry it into `uuids.txt`; no later step reports it again.
