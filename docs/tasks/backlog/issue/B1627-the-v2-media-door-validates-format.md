---
id: B1627
title: The v2 media door validates format for a trip photo but not one declined to the inbox
type: ISSUE
priority: medium
complexity: low
area: API v2 / media
found: "2026-09-12T21:10:15Z"
---

# B1627 — The v2 media door validates format for a trip photo but not one declined to the inbox

## Why

`storeMediaV2` (`lib/api/v2/media.ts`) branches on whether `intent.trip` is
present. A photo landing on a trip goes through `storeTripPhoto`, which calls
`validateMediaBatch` — format, size, longest edge — before anything is
written. A photo (or any other kind) with `trip` declined falls into the
`else` branch and calls `storeInboxFile` directly, with **no format or size
check at all**.

v1's `POST /api/v1/{user}/inbox` refused this (`kindForExtension` returned
`null` for an extension it did not recognise, and the route answered 400).
Found while repointing `test/inbox-route.test.ts` from the deleted v1 inbox
route to the v2 media door + `GET/DELETE /api/v2/{user}/inbox` (B1624): a
`payload.exe` staged as a declined-trip "photo" upload lands in the inbox
with a `201`, where v1 answered `400`.

## Work

Either: give `storeMediaV2`'s inbox branch the same
`kindForExtension`-style check v1's inbox door had (an image/video claiming
`kind: "photo"` should look like one), or decide this is deliberately
permissive now that the inbox is a flat bucket for "anything, sorted later"
and document why. Not decided here — this is the finding, not the fix.

## Acceptance

- A `kind: "photo"` upload with `trip` declined and a filename/format this
  server does not treat as an image or video either is refused, or the
  decision to accept it anyway is written down in `lib/api/v2/media.ts`'s own
  comment.
- `test/inbox-route.test.ts`'s "an inbox-declined upload is staged with no
  format check" test is updated to match whichever behaviour is chosen.
