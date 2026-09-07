---
id: B522
title: A photo carries no caption, so nothing can be said about a picture
type: FEATURE
priority: medium
complexity: medium
area: content model, day page, gallery
found: "2026-09-05T21:15:32Z"
started: "2026-09-05T21:20:00Z"
merged: "2026-09-05T21:43:49Z"
completed: "2026-09-07T13:11:38Z"
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

## What was built, and what the Why got wrong

The Why held up — half the feature really was there. Four things it did not
say, found while building:

- **`galleryLines` already wrote `caption:`** (`lib/ingest/entry.ts:57`), so
  the write path was one field on `UploadCandidate` and one line in each of
  `storeUploads`' two `items.push` calls. Nothing about the `gallery:` block
  needed rewriting.
- **`lib/ingest/entry.ts` carried a third private copy of the YAML escaper**,
  and it was the second one to be wrong in the way B204 already cost a trip id.
  `yamlString` escaped backslash and quote and nothing else. That was harmless
  while every value it rendered came off a file or a validated field; a caption
  is written straight from a request body, and a vertical tab, form feed,
  escape or NUL in one produced a day gray-matter could not parse — invisible
  at every reading path, and undeletable through the API, because every delete
  path resolves the day first.

  The first fix here was a newline escape added to that private copy, which
  was the same mistake one layer down. `lib/validate/frontmatter.ts` already
  holds `quoteScalar`, written for B204, which escapes the whole C0 range and
  "cannot emit invalid YAML whatever it is handed" — so the actual fix was to
  **delete `yamlString` and call the shared one**, which is a smaller diff than
  the wrong fix was. `singleLineProblem` from the same module is the paired
  door check, and refuses a two-line caption by name rather than folding it.

  Found by the security pass over the branch, not by the tests, which is worth
  recording: `test/photo-captions.test.ts` was already testing `\n`, `\r\n` and
  `\r` through that exact path and asserting the frontmatter survived. It
  tested the characters the private escaper happened to handle.

  `attachGallery` still writes its splice without re-reading it, where
  `editEntry` parses first and refuses — the missing second defence, captured
  as **B528** rather than absorbed here.
- **The captions arrive positionally, not as a map**, which the Work section
  offered as one of two options. There is no key to use: `src` does not exist
  until the server has named the file. So `captions[n]` describes the n-th file
  through both doors, and *more* captions than files is refused rather than
  shifted along — a caption under the wrong photograph is worse than none. The
  map keyed by `src` is the **PATCH**, where the src does exist.
- **`captionsFor` lives in `lib/validate/media.ts`, not in the route.** A
  `route.ts` may export only handlers, and this needed a test of its own.
  `CAPTION_MAX_CHARS` (300) moved there with it, and `lib/validate/entry.ts`
  imports it for the PATCH side, so one number answers both doors.

`spliceCaptions` walks the `gallery:` block item by item and touches only the
`caption:` line — it deliberately does *not* replace the block wholesale the
way `spliceCosts` does, because a partial payload could then delete
photographs, and `src`/`width`/`height` are measured off the file and are not
the caller's to restate. `test/photo-captions.test.ts` asserts the surrounding
bytes are unchanged rather than merely that the caption changed.

One judgement call on the alt text. The ticket asks for `alt={caption}` on both
grids; on the day's `Gallery` the caption was already drawn inside the button,
so alt was empty *on purpose* — repeating it made a screen reader say every
photograph's description twice. Both grids now carry `alt={caption ?? ""}` with
the visible caption marked `aria-hidden`, which is the same accessible name as
before and gains the alt where an image fails to load. Nothing regresses; it is
just not the improvement the ticket implies for that one component.

## Acceptance

- `POST …/trips/<trip>/media` with a caption per file writes `caption:` into
  the day's `gallery:` block, and reading the day back returns it.
- A `PATCH` on the day changes a caption without touching the prose or the
  title (a test that asserts the surrounding bytes are unchanged).
- The trip gallery page shows the caption on the tile, not only in the
  lightbox, and the `<img>` alt is the caption where there is one.
- `npm run verify` green.
