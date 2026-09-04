---
id: B08
title: Serve WebP alongside JPEG with <picture> in the gallery (W30 gap)
type: CHORE
priority: low
complexity: low
area: media, gallery
found: "2026-09-01"
started: "2026-09-04T06:30:09Z"
session: 2b6d1969-424a-4788-9497-eb5e151a5391
claimed: "2026-09-04T06:30:09Z"
---

# B08 — WebP alongside JPEG in the gallery

## Why

Item 4 of the five in `docs/plans/W30-media-upload.md`. The other four
shipped; its index row says so: "upload and originals done; WebP `<picture>`
is not". The plan's own directory sketch shows `media/<day-slug>/01.webp`
beside the JPEG.

Partly overtaken by events. `app/[user]/media/[...path]/route.ts` already
answers a `?w=` request with `image/webp` — `resizedCopy` re-encodes, and the
response hard-codes that content type. So a browser asking for a sized
derivative gets WebP today.

What is missing is the unsized case and the negotiation: a request with no
`?w=` is served the stored file as-is, and there is no `<picture>` element
offering a browser the choice. Check what the gallery actually requests before
writing anything — this may be a two-line change or already moot.

## Work

1. Establish whether any real gallery path fetches an unsized original. If not,
   close this as done and say why.
2. If it does: emit the WebP derivative at write time and offer both through
   `<picture>`, with JPEG as the fallback source.

## Acceptance

- The gallery renders identically in a browser without WebP support.
- No new bytes on disk for a format nobody is served — if the sized path
  already covers it, the answer is a closed item, not a new derivative.
