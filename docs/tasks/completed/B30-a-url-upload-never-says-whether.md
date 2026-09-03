---
id: B30
title: A URL upload never says whether an original was kept
type: ISSUE
priority: low
complexity: low
area: media, api, docs
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
completed: "2026-09-03"
---

# B30 — A URL upload never says whether an original was kept

## Why

An agent reported that the URL media endpoint "resizes to 2000px and keeps no
original": it sent a 3000×2000 image and got `width: 2000, height: 1333` back,
with nothing in the reply about the file it had sent.

**The original is kept.** `fetchImage` in `lib/api/fetchMedia.ts` only downloads
and enforces a byte cap — it does not resize — and `storeUploads` in
`lib/api/media.ts:253` writes the raw bytes to `originals/<day>/` for every
upload, whichever door it came through. Confirmed on disk: a URL upload leaves
both `trips/<trip>/media/<day>/01.jpg` and
`trips/<trip>/originals/<day>/01.jpg`. So the report is wrong about the
behaviour and right about everything else.

What it is right about is that **nothing says so**. The reply carries `items`,
which are the derivatives, and the derivative dimensions are the only numbers
in it. `agent.md` is emphatic that the original is what a photobook is printed
from and that a small source cannot be recovered later — so an agent that reads
that carefully, then watches 3000px go in and 2000px come back, has every
reason to conclude the promise did not hold on this route. The next thing it
does is warn the person, or re-upload, or quietly stop trusting the guide.

A promise the API makes and never evidences is a promise that gets doubted.

## Work

- Say it in the reply. Each item, or the batch, states that an original was
  kept and at what size — the numbers the caller sent, which is the fact they
  are actually checking.
- Distinguish the two dimensions in the wording so `width`/`height` cannot be
  read as "this is all that survives". They are the served copy's.
- One line in `agent.md` under the URL section confirming the original for a
  URL upload is the file as downloaded — which is already written there as a
  warning about *quality*, and should also read as a statement that it exists.

Not doing: returning original dimensions for the multipart path only. Both
doors answer the same way or the asymmetry is the next thing somebody reports.

## What was found while building it

The Why held: the original was always kept, and the test added here proves it
directly by reading 3000×2000 back off disk after an upload. That case had
genuinely never been covered — the existing tests asserted the *derivative's*
dimensions and that two files exist, never the original's size.

One decision worth recording. The original's dimensions are measured from
`decodeSource(...).file` rather than from the raw bytes, because a HEIC's own
header is not something sharp can always read — `decodeSource` exists precisely
to hand back a file it can. Measuring the raw bytes would have worked for JPEG
and thrown for the format the guide most encourages people to send.

Scope note: the task said "both doors answer the same way", and they do —
`kept` comes out of `storeUploads`, which is the single path both the multipart
and the URL branch go through, so the asymmetry the task worried about could
not be reintroduced without deleting the field.

## Acceptance

- A URL upload's 201 states that an original was kept, with the source
  dimensions, distinct from the served copy's.
- The same is true for a multipart upload.
- A test asserts the file exists under `originals/` after a URL upload — the
  behaviour is currently only covered for the multipart path.
