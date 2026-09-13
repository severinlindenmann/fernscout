---
id: B1685
title: A photograph attached through the media door never reaches the day it names
type: ISSUE
priority: high
complexity: medium
area: api
found: "2026-09-13T14:43:50Z"
merged: "2026-09-13T15:12:42Z"
---

# B1685 — A photograph attached through the media door never reaches the day it names

## Why

`POST /api/v2/{user}/media` accepts a photograph naming a trip and a day,
answers `201`, writes the bytes into that day's media folder — and the day
never learns about it.

Driven on the live instance against a day an agent had just created and
published:

```
$ curl … /api/v2/test-freshagent/trips/bern-2026/days/2026-03-10-arrival-in-bern
media on day     : null
declined.media   : "attaching a photo in a separate call"

$ curl … "/api/v2/test-freshagent/media?trip=bern-2026"
[{"src": "/media/bern-2026/2026-03-10-arrival-in-bern/14bf0b8e….jpg",
  "day": "2026-03-10-arrival-in-bern", "caption": "…the arcades of the old town."}]
```

And on disk, the file is there while the day file is not:

```
$ ssh … 'ls …/trips/bern-2026/media/2026-03-10-arrival-in-bern/'
14bf0b8e37cf289c33f3ecea841798eb.jpg
14bf0b8e37cf289c33f3ecea841798eb.jpg.meta.json
$ ssh … python3 -c '…json.load(day)…'
media key: None
declined.media: attaching a photo in a separate call
status: published
```

So a **published day with a photograph uploaded for it shows no photograph**,
and the day still asserts that media was consciously declined. Three rules
break at once:

- AGENTS.md's contract rule — *"a field the API takes is a field it has to
  show … an agent cannot check its own work"*. The upload is accepted and
  invisible on the resource that owns it.
- T6, the write-path invariant: supplying a previously-declined section
  clears the stored decline. It fires on `PATCH` (verified working) and not
  through this door, so the day goes on claiming a decline that is no longer
  true.
- The 422's own promise. The day was told to answer or decline `media`; it
  declined, then was given media, and nothing reconciled the two.

This is how a fresh agent, given only the published guides and no source,
actually behaved — it followed `ingest-photos.md`, uploaded three
photographs, got three `201`s, and ended with three days that show none of
them. It only found the pictures by guessing that a separate listing door
might exist.

Whether the day was meant to be patched afterwards is exactly the question:
nothing in `add-a-day.md` or `ingest-photos.md` says so, and a `201` that
requires an undocumented second call is the failure class B540 named.

## Work

Decide which of these the door is, and make the document say it:

1. **The media door attaches.** On a write naming a day, append the item to
   that day's `media` and retract `declined.media` through the same
   `retractDeclines` path `lib/api/v2/write.ts` already owns. Then the `201`
   is true and the guides need no change.
2. **The media door only stores bytes**, and attaching is
   `POST .../days/{slug}/media` (B1656/D20) or a `PATCH` of the day. Then the
   upload response must say so in its `next`, `ingest-photos.md` must say so,
   and a day-scoped upload that is never attached is a leak worth reporting.

Option 1 is the smaller diff and matches what a caller expects from a request
that names a day. Option 2 is defensible but is not what the guides currently
describe.

Either way, a test must drive upload → read the day back, because both a
schema test and a route test pass today.

Not doing: changing what `POST .../media` does for a **trip-scoped** upload
with no day — that is T2 and is correct as it stands.

## Acceptance

- Upload a photograph naming a trip and a day, then `GET` that day: the
  photograph is in `media`, and `declined.media` is gone.
- A published day with an uploaded photograph renders it on the page.
- A test covers the round trip, not just the `201`.
