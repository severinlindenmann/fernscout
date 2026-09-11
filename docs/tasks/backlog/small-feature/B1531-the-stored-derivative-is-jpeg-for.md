---
id: B1531
title: The stored derivative is JPEG for a reader that never sees it and a printer that only sometimes needs it
type: FEATURE
priority: low
complexity: medium
area: media
found: "2026-09-11T20:28:21Z"
---

# B1531 — The stored derivative is JPEG for a reader that never sees it and a printer that only sometimes needs it

## Why

Ingest writes the 2000px derivative as JPEG (`makeDerivative`,
`lib/ingest/image.ts`). Two things are true about that file:

**A reader almost never receives it.** `app/[user]/media/[...path]/route.ts` is
its own image optimiser: `?w=` goes to `resizedCopy`, which is sharp → **webp
at quality 78**, cached under `content/.cache/media/`. Every gallery tile and
every full photo comes through `mediaLoader` with a width, so what reaches a
browser is already webp at the size it asked for. Measured on the live
instance: 574 cached webp variants, 48 MB.

**A printer sometimes does.** When no usable original is kept — a HEIC, a RAW,
or a photograph imported before originals existed — `printSourceFor` falls back
to exactly this JPEG, and the PDF writer embeds its bytes verbatim as a
DCTDecode stream. It can do nothing with a webp.

So the format is chosen for a consumer that does not use it, and the one
consumer that does is the fallback nobody wants to be in.

Live numbers, 2026-09-11: `media/` across the journal is **77 MB**, `originals/`
**284 MB**. A webp re-encode at the same visual quality typically saves 25-35%
of the derivative, so the prize is roughly **20-25 MB** on a 418 MB journal —
real, and small beside the originals it sits next to.

## Work

Switch `makeDerivative`'s photo output to webp, and backfill.

**Only after print no longer depends on it.** That is the whole risk in this
ticket: B1528 (a JPEG print copy where the original cannot be embedded) and an
answer for photographs with no kept original at all. Land those first and the
fallback has somewhere to go; land this first and a HEIC-sourced book quietly
loses its photographs.

Check on the way through:

- `RESIZABLE` already includes `.webp`, so the optimiser keeps working.
- `contentTypeFor` and the no-`?w=` path serve the stored file directly to
  anything that asks for it without a width — a mail client, a feed reader, an
  agent. webp is fine in browsers and is not fine everywhere else.
- `.ingest.json` and the fingerprint cache key on filenames; a backfill that
  renames `01.jpg` to `01.webp` has to leave both able to recognise what they
  already imported.
- The postcard and photobook **previews** read the derivative too (the drawn
  card, the composer's spreads) — those are HTML and webp suits them.

## Acceptance

A newly ingested photograph is webp in `media/`, is served as it always was,
and a book whose photographs have no usable original still prints them. The
saving is measured on a real trip and written here, not estimated.
