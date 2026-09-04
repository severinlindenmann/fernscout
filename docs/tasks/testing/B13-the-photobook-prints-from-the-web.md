---
id: B13
title: The photobook prints from the web derivatives, not the originals
type: ISSUE
priority: medium
complexity: medium
area: photobook, media
found: "2026-09-01"
started: "2026-09-04T05:58:32Z"
merged: "2026-09-04T06:30:05Z"
---

# B13 — The photobook prints from the web derivatives

## Why

Ran end to end, on the demo journal:

```
npm run photobook -- --trip example/parks-2025
```

It works. It writes nine files — two PDFs, a preview, a plan, a PDF/X report
and four provider requests — and every one of the 43 photographs in the book
comes back as a warning:

```
! [low-resolution] example/trips/parks-2025/media/zion-narrows/01.jpg is 1600px
  wide but is printed 324mm wide, which needs 3826px — it will print at about
  125 DPI.
```

That is not a demo-content problem. `mediaFileFor()` in
`lib/photobook/source.ts:30` resolves a photograph to
`path.join(tripDir(ref), "media", relative)` — the browser derivatives, capped
at 2000px by `MEDIA_WIDTHS` in `lib/mediaSizes.ts:12`. It never looks in
`originals/`.

The originals are right there, and they were kept for this. `lib/media.ts:40`:

> …a full-page photobook plate at 300 dpi wants roughly 2500×3500, so the one
> artefact the print pipeline needs was the one being thrown away…

`lib/ingest/index.ts:560`:

> Named after the derivative rather than the camera, so the two line up when
> the photobook goes looking for a better version of `01.jpg`.

Both write paths honour it — ingest (`lib/ingest/index.ts:564`) and the media
API (`lib/api/media.ts:340`) — `.gitignore` explains the exclusion in those
terms, and `lib/exportZip.ts:114` deliberately leaves them out of an export
because "they are what the photobook needs". Everything in the system is
arranged around a lookup that was never written. The photobook goes looking
for a better version of `01.jpg` in exactly one place: the folder that holds
the worse one.

So the pipeline is complete and its output is not printable. A 210mm book at
125 DPI is a book you would not send.

## Work

1. In `mediaFileFor` (or a resolver beside it), prefer
   `tripOriginalsDir(ref)/<slug>/<name>.*` over the derivative, falling back
   to the derivative when there is no original. `tripOriginalsDir` is in
   `lib/media.ts:49` and already honours `MEDIA_ORIGINALS_DIR`.
2. Match on **basename, any extension**. Ingest keeps the camera's own
   extension (`lib/ingest/index.ts:567`), so `01.jpg` in `media/` may be
   `01.heic`, `01.cr2` or `01.jpeg` in `originals/`.
3. That is where it stops being a one-line change. The PDF writer embeds JPEG
   bytes verbatim as DCTDecode streams and rejects anything else —
   `readJpeg()` at `lib/postcard/pdf.ts:44`, called from
   `lib/photobook/render.ts:574`. A HEIC or RAW original needs transcoding to
   JPEG at a print size before it can be embedded. Decide: transcode on
   demand, or accept only JPEG originals and fall back for the rest. Either
   is fine; silently falling back with no warning is not.
4. The warning must keep telling the truth. When it falls back, say the
   original was missing rather than only reporting the DPI.

Not doing: PDF/X conversion. The report already says exactly what is missing
(ICC output intent, embedded fonts, CMYK) and hands over a Ghostscript command
in `gs-pdfx.sh`; that is a deliberate stopping point, not a gap. Ordering is
B07.

Do not "fix" the demo warnings by shipping larger demo photographs — the demo
media are web derivatives on purpose and there are no originals for them. The
test needs a fixture with an original that is genuinely bigger.

## Acceptance

- With a trip that has `originals/`, the run reports no low-resolution warning
  for any photograph whose original is large enough, and the plan JSON names
  the file it actually read.
- With a trip that has no `originals/`, behaviour is exactly as today, plus a
  warning that says the original is missing.
- A fixture test covers the extension mismatch — `01.jpg` in `media/`, `01.HEIC`
  or `01.jpeg` in `originals/` — because that is the case a naive path join
  gets wrong.
- `npm run photobook -- --trip example/parks-2025` still completes and writes
  all nine files.

## What was built

The Why held up in full: `mediaFileFor` was the only resolver and it only ever
looked in `media/`. Reproduced before touching anything — 43 photographs, 43
`low-resolution` warnings, the full-page plates at 125 DPI.

`printSourceFor()` in `lib/photobook/source.ts` now decides which copy is
printed, and it is the only place that can, because it is the only module in
`lib/photobook/` that knows `originals/` is a sibling of `media/`. It matches
on **basename, any extension, case-insensitively**, preferring a JPEG when a
day holds both `01.jpg` and `01.heic`.

**Decision on step 3: only a JPEG original is printed.** Transcoding on demand
would put a decoder for every camera raw format into the print path, and
`readJpeg` embeds DCTDecode bytes verbatim precisely so it needs no decoder at
all. A HEIC or RAW original therefore falls back to the derivative — and says
so, which is the half that was actually missing. Two things carry it:

- `BookPhoto.fallbackReason`, which the planner appends to the DPI warning:
  "…at about 125 DPI. This is the web copy: no original was kept for it."
  Resolution alone reads as "the photograph is small", which sends somebody
  hunting for a bigger file they may already have on disk.
- a `no-original` warning per reason, once per book rather than once per plate,
  so a trip with no originals at all is one line rather than forty-three.

The dimensions now come from the original's own JPEG header. The frontmatter
records the *derivative's* size by construction, so believing it would have
planned the layout from 1600px while printing 6400 — this is why the fix is not
only a path change.

## Evidence

- `npm run photobook -- --trip example/parks-2025` — nine files, and 43
  `low-resolution` warnings, each now naming the missing original.
- The same trip with `originals/` seeded at 4× (upscaled from the derivatives,
  written as `01.JPEG` so the extension mismatch is under test): **zero
  warnings**, interior 7.9 MB → 48.3 MB, and the plan names
  `example/trips/parks-2025/originals/vegas-and-a-cooler/01.JPEG` at 6400px.
  The seeded originals were deleted afterwards; the demo ships none on purpose.
- `test/photobook-source.test.ts` — nine tests, eight of which fail against the
  code as it was.
