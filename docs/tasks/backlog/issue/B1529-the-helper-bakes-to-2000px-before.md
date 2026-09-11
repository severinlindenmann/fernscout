---
id: B1529
title: The helper bakes to 2000px before uploading, so every photobook is printed from a web-sized file
type: ISSUE
priority: high
complexity: low
area: helper, photobook, media
found: "2026-09-11T21:00:00Z"
---

# B1529 — The helper bakes to 2000px before uploading, so every photobook is printed from a web-sized file

## Why

Found on 2026-09-11, when an owner asked whether a better resolution was
available from their Photos library than what was on the site.

`fernscout-helper`'s `bake.mjs` sets `DEFAULT_MAX_EDGE = 2000` and `build.mjs`
copies that derivative into `content/`, which is what `publish` uploads. 2000px
looks like a sensible choice and matches exactly what the site serves — which is
probably how it was arrived at, and why nobody has questioned it.

But `skill/ingest-photos.md` is explicit about what the server does with an
upload:

> a resized copy at 2000px which is what the site serves … and the original,
> untouched, which is what a printed photobook is made from

> **Send the largest file you have**

> a full-page plate at 300 dpi wants about 2500×3500

So the 2000px cap is not saving anything — the server was going to make that
copy anyway. What it does is **destroy the print master before it is ever
stored**. The file the server dutifully keeps "untouched" as the original is the
helper's already-downsized derivative, and every photobook made from a journal
published this way is printed from it: roughly 170 dpi on an A4 plate, against
the 300 the format is designed for.

Nothing reports this. The upload succeeds, the site looks right — because the
site was only ever going to show 2000px — and the loss only becomes visible in
print, which is the one place it cannot be undone.

In the journal that prompted this, 119 of 284 photographs were 5712px and 128
were 4032px. All of them had been published at 2000. Re-baking at 4000 and
re-uploading took 513 MB against a 10.7 GB quota, which is the other half of
the point: there was no budget reason for the cap either.

## Work

- Raise `DEFAULT_MAX_EDGE`, or drop the resize entirely and send the export as
  it came. The instance's own ceiling is 8000px and 50 MB per image, published
  in `/api/health` — read it rather than hardcoding a new number. "Send the
  largest file you have" is the instruction; the helper should follow it.
- Keep a cap for the **review page**, which is where 2000px genuinely helps:
  `ensureBaked` is already keyed by max-edge, so review can stay at 2000 while
  the published copy goes out large. That is one argument at each call site.
- Say what is being sent. A run that uploads 513 MB should print that, and a
  run that would downsize a 48 MP photograph to a web thumbnail should say so
  before it does it.

**Replacing already-published photographs is harder than it should be**, and is
worth mentioning here because anybody fixing an affected journal will hit it:
`publish` matches uploads by basename, so re-running with larger files of the
same name silently skips all of them. The only route is
`DELETE …/trips/{trip}/media` per day, by exact src, and then publish again —
177 deletions and 177 uploads, driven by hand. A `--replace-media` flag, or
matching on size as well as name, would make this a one-line fix for owners
rather than a scripted one.

## Acceptance

- A freshly published trip's stored originals are the resolution the export
  produced, not 2000px.
- The review page still works from a small derivative.
- The run says how much it is about to upload.
- An owner can replace already-uploaded photographs without hand-written calls.
