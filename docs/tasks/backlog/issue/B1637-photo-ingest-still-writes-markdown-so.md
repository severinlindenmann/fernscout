---
id: B1637
title: "Photo ingest still writes markdown, so a day it creates is invisible to the readers"
type: ISSUE
priority: high
complexity: low
area: API v2
found: 2026-09-13T00:00:00Z
---

## Why

`lib/ingest/index.ts` writes days through `renderEntry`/`appendGallery`
(`lib/ingest/entry.ts`), which emit markdown directly and bypass
`lib/api/entries.ts` entirely. B1598 flipped every writer in that module to
JSON; ingest was not in its Work list and was missed.

So on the B1598 branch, **a day created by `npm run ingest` is written in a
format no reader can read**. It lands on disk, reports success, and renders
nowhere — the same failure B1598 exists to prevent, one door over.

Found by the agent that did the writer flip, reported rather than absorbed
into its own ticket.

## Work

Route ingest through the same writers everything else uses — `createDraft`
and `attachGallery` in `lib/api/entries.ts` — rather than teaching a second
module to emit the storage format. That is the whole lesson of B1630: one
writer, many callers.

If ingest genuinely cannot use them (it may want a slug it chose, or to write
a day and its gallery in one pass), say which and why in a comment, and flip
`lib/ingest/entry.ts` to `dayToJson` instead — but reach for that second.

**Must land with B1598**, not after it. Between the two, ingest writes files
the site cannot read.

## Acceptance

- A day written by `npm run ingest` is readable by `getAllEntries` and
  renders on the site.
- `lib/ingest/entry.ts` emits no markdown, or is gone.
- A test drives ingest and then reads the day back through the reader, rather
  than asserting the file was written.
