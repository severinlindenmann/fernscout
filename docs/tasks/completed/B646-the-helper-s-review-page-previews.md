---
id: B646
title: The helper's review page previews the originals, not the pictures that get published
type: ISSUE
priority: medium
complexity: medium
area: helper: icloud-export, review
found: "2026-09-06T19:32:50Z"
started: "2026-09-07T12:46:00Z"
completed: "2026-09-07T13:19:10Z"
---

# B646 — The helper's review page previews the originals, not the pictures that get published

## Why

`.claude/skills/icloud-export/review.mjs:221` serves `/full/` straight out of
`export/<trip>/photos`, and the `/img/` thumbnails are made from the same
originals. Those files still carry `Orientation`, so the browser turns them.
The files `build.mjs` writes into `content/` do not.

**The page a person uses to approve their photographs is not showing them the
photographs that will be published.** That is what made B645 expensive rather
than merely wrong: asked about the sideways pictures, the person's words were
"in the preview it was all normal?".

With B645's `bakeOrientation()` in, the two agree again *for orientation*. The
mechanism is untouched: the review page previews the input, and `build.mjs` is a
lossy transform that runs afterwards — resize to 2000px, strip, and now rotate.
Anything that transform ever gains will diverge the same way, silently, and be
found by a reader.

## Work

Two candidate fixes, and they are not equivalent:

- **Cheap:** have `review.mjs` bake orientation into its thumbnails, so at least
  the grid matches. `/full/` still shows the original, so the class of bug
  stays.
- **Right:** build the derivative once, before review, and have both the review
  page and `build.mjs` read it. More work, and it changes the order of the
  commands in `icloud-export/SKILL.md`, but it removes "the preview lied"
  outright.

Prefer the second. If the first is taken instead, say in the task why, because
it leaves the finding half-open.

## Acceptance

A photograph whose derivative differs from its original — start with a sideways
one — looks the same on the review page as it does in `content/`, at `/img/` and
at `/full/`.

## Done
Took the "right" fix. New `.claude/skills/icloud-export/bake.mjs` holds one
`ensureBaked()` (resize -> orient -> strip), cached per max-edge under
`export/<trip>/baked/<edge>/`. `build.mjs` and `review.mjs` both call it, and
`review.mjs` bakes every photo before serving thumbnails or `/full/`, so the
preview reads the same file `build.mjs` publishes. No SKILL.md command-order
change needed — baking happens inside `review.mjs`. `review.test.mjs` proves it
with a byte-for-byte comparison of the previewed and published files.
