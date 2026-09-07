---
id: B582
title: Postcards can only be started from the current trip's gallery
type: ISSUE
priority: medium
complexity: low
area: postcards
found: "2026-09-06T14:04:42Z"
merged: "2026-09-06T14:07:56Z"
completed: "2026-09-07T13:12:13Z"
---

# B582 — Postcards can only be started from the current trip's gallery

## Why

`app/[user]/trips/[trip]/gallery/page.tsx` renders the same
`GalleryPageContent` as the current-trip gallery, computes `photobook`, and
never computes `postcard` — so the "send a postcard" control exists only while
a trip is `current`. Nothing else enforces that: `postcardEntryFor` asks only
about capabilities and ownership, and `POST /api/v1/<user>/postcards` takes
any trip in the journal. An owner who wants to post a card from a trip that
ended last month has no way to start one in the browser.

## Work

Call `postcardEntryFor(trip)` beside the existing `photobookEntryFor(trip)`
and pass it to `GalleryPageContent`.

## Acceptance

As owner, open `/<user>/trips/<a finished trip>/gallery` with postcards and
contacts enabled: the postcard control is there and picking a photograph leads
to a working proposal page.
