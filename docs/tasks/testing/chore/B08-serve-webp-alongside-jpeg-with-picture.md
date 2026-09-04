---
id: B08
title: Serve WebP alongside JPEG with <picture> in the gallery (W30 gap)
type: CHORE
priority: low
complexity: low
area: media, gallery
found: "2026-09-01"
started: "2026-09-04T06:30:09Z"
merged: "2026-09-04T07:17:25Z"
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

## What was built

**Work item 1 first, as the task asks — and the answer is yes, one path does.**
The open photograph. `<img src={item.src}>` in both lightboxes carried no
`?w=`, and a request with no width is served the stored file as it is. So the
grid thumbnails have been WebP for a while and the full-screen picture — the
largest thing on the page, the one a reader waits for — was the camera
original.

Measured on the example journal, which ships small photographs, so a real
camera file is worse:

```
01.jpg          image/jpeg  147683 bytes
01.jpg?w=480    image/webp   15910
01.jpg?w=2000   image/webp   90086
```

**Work item 2, without writing anything at ingest time.** The plan's fifth item
was a `.webp` beside every `.jpg`; `resizedCopy` (`lib/media.ts`) has since made
that unnecessary — it re-encodes on demand and caches under
`content/.cache/media`. So `components/FullPhoto.tsx` offers a `<picture>`: a
`<source type="image/webp">` listing every width in `MEDIA_WIDTHS` with
`sizes="(max-width: 896px) 100vw, 896px"` (the frame is `max-w-4xl`), and the
untouched original as the `<img src>` underneath. A browser with no WebP
ignores the source element and gets exactly the bytes it got before, which is
the first acceptance line; nothing new is written for a format nobody asks for,
which is the second — a derivative appears on disk only for a width a browser
actually requested.

Two sources are skipped, the same two `components/mediaLoader.ts` skips: an
absolute URL is somebody else's server and cannot answer `?w=`, and the SVG
placeholders the demo content ships would be rasterised for nothing.

**In a real browser**, Chromium at 390px, the day viewer:

```
source[type=image/webp]  …/01.jpg?w=320 320w, … ?w=2000 2000w
img.currentSrc           http://localhost:3097/example/media/…/01.jpg?w=480
```

— so the phone took 16KB of WebP where it used to take 148KB of JPEG. React
renders the attribute as `srcSet`; HTML attribute names are case-insensitive,
and `currentSrc` above is the proof the browser honoured it.

**Left alone: the video poster.** `poster={item.poster}` in both grids is the
other unsized fetch, and a `poster` attribute takes one URL with no
negotiation and no fallback — pointing it at `?w=` would serve WebP to a
browser that may not decode it, with nothing to fall back to. That is a
trade this task's first acceptance line forbids.

Built with **B16**, which rewrote the same two components into one shared
viewer; the `<picture>` lives in `FullPhoto`, which both now render.
