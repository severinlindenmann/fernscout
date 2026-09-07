---
id: B666
title: A phone cannot send its position to a journal while the trip is happening
type: FEATURE
priority: low
complexity: medium
area: api, gps, privacy
found: "2026-09-07T07:49:33Z"
---

# B666 — A phone cannot send its position to a journal while the trip is happening

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B665 gives a journal somewhere to keep where somebody went, filled from an
export after the fact. During the trip there is nothing: the line only exists
once Google has been asked for it, weeks later.

**A PWA cannot fill this gap, and it is worth writing down so nobody tries.**
Web geolocation runs only while the page is open and in the foreground; iOS
suspends it the moment the screen locks, and a Wake Lock keeps the screen on,
not the tracking alive. There is no background geolocation on the web. Building
one would mean a native app, which is a whole product this one does not want.

The lazy answer is that the apps already exist — OwnTracks, Overland, GPSLogger
all do nothing but batch fixes and POST them somewhere. This journal only has
to be the somewhere.

## Work

`POST /api/v1/<user>/gps`, agent token with `write:content`, appending to
B665's store and nothing else.

Accept the shape OwnTracks and Overland already send — a batch of points with
`lat`, `lon`, a timestamp, whatever else they include ignored — and apply the
same thinning rule as the importer, so a chatty logger cannot fill the disk.
Under B661's ceiling like every other write.

**It writes and never reads.** No `GET`, no listing, no "where am I now" — the
store stays unreadable over HTTP, which is B665's whole shape. `/openapi.json`
documents the one route and its refusals; `/agent.md` explains what to point
an app at.

**Not doing:** an app, a live position on the site, geofencing, any
notification.

## Acceptance

- An OwnTracks-shaped batch posted with a valid token lands in the store and
  thins to the same rule the importer uses.
- A trip-scoped token is refused; an unauthenticated call is refused.
- There is no route that reads the store back, asserted by a test.
- `npm run verify` passes and the route is in `/openapi.json`.
