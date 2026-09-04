---
id: B210
title: MEDIA_ORIGINALS_DIR outside the content root writes a ../ chain into the photobook plan
type: ISSUE
priority: low
complexity: low
area: photobook, media
found: "2026-09-04T06:14:25Z"
started: "2026-09-04T08:20:03Z"
session: 7d30451d-0304-4631-8484-d96036fb11b4
claimed: "2026-09-04T08:20:03Z"
---

# B210 — MEDIA_ORIGINALS_DIR outside the content root writes a ../ chain into the photobook plan

## Why

Noticed while building B25, which made the photobook plan record paths
relative to the content root so two machines produce the same JSON.

`bookFile()` in `lib/photobook/source.ts` is `path.relative(contentRoot(),
absolute)`. For the default layout the original is
`content/<user>/trips/<trip>/originals/…`, so that is a clean relative path.
But `tripOriginalsDir` honours `MEDIA_ORIGINALS_DIR` (`lib/media.ts:49`) —
"another disk, usually" — and an originals directory outside the content root
comes back as `../../../mnt/photos/<user>/<trip>/day/01.jpg`.

Nothing breaks: `resolvePrintFile()` resolves it back, the book renders, and
no absolute path reaches the JSON, so B25's acceptance still holds. But the
plan stops being portable in the way B25 wanted it to be — the number of `../`
segments depends on where the content root happens to sit — and the string is
unreadable in a warning, which is the other job `file` now does.

Small: it only bites an instance that sets `MEDIA_ORIGINALS_DIR`, and only in
the plan JSON and the warning text.

## Work

Decide what a path outside the content root should look like in the plan.
Options: a second root the plan declares and paths relative to it; a
`root: "originals"` discriminator beside the relative path; or simply
accepting `../` and saying so in the plan's own documentation.

Not doing: putting the absolute path back. That is B25.

## Acceptance

- With `MEDIA_ORIGINALS_DIR` set outside the content root, the plan's photo
  paths are readable and independent of where the content root sits.
- A test covers it — `test/photobook-source.test.ts` already has the fixture
  shape, and deletes the variable in `beforeEach`.
