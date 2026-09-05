---
id: B522
title: A photo carries no caption, so nothing can be said about a picture
type: FEATURE
priority: medium
complexity: medium
area: content model, day page, gallery
found: "2026-09-05T21:15:32Z"
---

# B522 — A photo carries no caption, so nothing can be said about a picture

## Why

`caption` already exists on `GalleryItem` and `MediaTile` (`lib/types.ts:18`,
`lib/types.ts:55`), and the day's `Gallery` draws it under the polaroid and in
the lightbox (`components/Gallery.tsx:84`, `:105`). `getAllMedia()` carries it
to the trip gallery (`lib/entries.ts:407`). So half the feature is built.

The half that is missing is every way of putting one there:

- **The API cannot write one.** The upload endpoint composes the `gallery:`
  block itself (`lib/api/media.ts` → `storeUploads`), and `updateDraft` splices
  scalars, `costs:` and `translations:` but never `gallery:`
  (`lib/api/entries.ts:499`). OpenAPI says so out loud —
  *"**You do not write these**"* (`lib/api/openapi.ts:132`). A remote agent that
  was told what a photo shows has nowhere to put it.
- **No skill mentions it.** `add-a-day` and `ingest-photos` never say the field
  exists, so an agent working on disk does not write one either. The only
  captions in the repo are in `scripts/build-demo-content.mjs`.
- **The trip gallery drops it on the tile.** `components/GalleryGrid.tsx:159`
  is `alt=""` and only the lightbox (`:211`) shows the text — so a caption
  written today is invisible on `/[user]/trips/[trip]/gallery` until you click.

Cost of leaving it: photographs on a family journal are the part that needs a
line of context most — who is in it, which pass that is — and today the only
place to say it is the prose, where it is detached from the picture.

## Work

- Let a caption be written through the API. Cheapest route: accept an optional
  `captions` map (`src` or index → text) on the media POST, and add a
  `gallery:` splice to `updateDraft` so a caption can be corrected after the
  fact without a re-upload. Reuse the existing splicer — the point of
  `appendGallery` is that hand-written prose and titles survive a textual edit.
- Update `GalleryItem` in `lib/api/openapi.ts` and the "you do not write these"
  sentence, plus `lib/api/documentation.ts:1237` and `agent.md`.
- Say the field exists in `add-a-day` and `ingest-photos`, with the standing
  rule attached: **a caption is what you were told, not what the picture looks
  like to you.** No invented weather, no invented names. Empty beats plausible.
- Render it on the trip gallery tile, and use it as the `alt` on both grids
  (`GalleryGrid.tsx:159`, `Gallery.tsx`) — an empty `alt` stays the fallback
  when there is no caption.

Not doing: rich text, per-caption translations, or a caption on the postcard
and photobook renderers. Separate captures if they turn out to be wanted.

## Acceptance

- `POST …/trips/<trip>/media` with a caption per file writes `caption:` into
  the day's `gallery:` block, and reading the day back returns it.
- A `PATCH` on the day changes a caption without touching the prose or the
  title (a test that asserts the surrounding bytes are unchanged).
- The trip gallery page shows the caption on the tile, not only in the
  lightbox, and the `<img>` alt is the caption where there is one.
- `npm run verify` green.
