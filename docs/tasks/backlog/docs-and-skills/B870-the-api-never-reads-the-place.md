---
id: B870
title: The API never reads the place and time out of a photograph and only says so 1700 lines away
type: DOCS
priority: medium
complexity: low
area: docs, api, media
found: "2026-09-07T17:36:50Z"
---

# B870 — The API never reads the place and time out of a photograph and only says so 1700 lines away

## Why

`POST .../trips/<trip>/media` does not read EXIF. A photograph carrying GPS and
`DateTimeOriginal` adds no location, no country and no time to the day — the
day keeps `"coordinates": "unknown"` and the fields stay empty.

Verified live with a file carrying GPS 38.7223 N, −9.1393 W and
`2026-09-06 09:14`. Nothing was read.

This is **correct and documented**: EXIF extraction belongs to the local
`npm run ingest` CLI, which runs on the machine the journal lives on.
`/agent.md` says so — around line 2100, in the ingest section, about seventeen
hundred lines after the media endpoint an agent is actually reading.

So the document is not wrong; it is unreachable at the moment of need. An agent
working over the network — the documented common case — has every reason to
assume the coordinates in a phone's photograph do something, and no reason to
read the local-CLI chapter.

The helper's own wizard reads EXIF in the browser and sends the values
explicitly, which is why this never showed up in testing until somebody used
the API directly.

## Work

Say it where the endpoint is described: this route stores files and reads
nothing out of them, so send `lat`, `lng` and `time` on the day yourself if you
want them. Link to the ingest section rather than repeating it.

Check `/openapi.json`'s media operation for the same silence.

## Acceptance

An agent reading the media endpoint learns that EXIF is not read, at that
endpoint.
