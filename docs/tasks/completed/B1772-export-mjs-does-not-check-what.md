---
id: B1772
title: export.mjs does not check what landed on disk, so a photograph that exported as HEIC is invisible to every later step
type: ISSUE
priority: high
complexity: low
area: fernscout-helper icloud-export, export.mjs
found: "2026-09-15T06:24:27Z"
started: "2026-09-15T06:39:52Z"
merged: "2026-09-15T07:09:14Z"
completed: "2026-09-15T08:19:26Z"
---

# B1772 — export.mjs does not check what landed on disk, so a photograph that exported as HEIC is invisible to every later step

## Why

`export.mjs` asks `osxphotos` for `--convert-to-jpeg` and then trusts it. It
prints the number of `.jpe?g` files it finds and never compares that with the
number of uuids it asked for, so a photograph that came out as something else
is simply absent from the count nobody is reading against anything.

`osxphotos` does not always honour the flag: in one trip 21 of 28 files landed
as `.HEIC`. Every later step filters `/\.jpe?g$/i` — `describe.mjs` and
`build.mjs` both do — so those photographs were invisible rather than broken.
A 15-photograph day produced a 3-photograph contact sheet and the run reported
success.

## Work

After the export, convert whatever is left in a format the rest of the pipeline
cannot read, and then fail loudly when the number of usable files on disk does
not match `uuids.txt` — naming the files that are missing. The conversion is
the fix for today's `osxphotos`; the count check is what makes the next
variation of this visible instead of silent.

## Acceptance

An export whose result does not match `uuids.txt` exits non-zero and names what
is missing. An export containing a HEIC ends with a readable JPEG in its place,
and `describe.mjs` builds a sheet with every photograph of the day in it.

## Built, 2026-09-15 — fernscout-helper `aa69dbd`

**Valid when taken**: the exported JPEG count was printed and compared with
nothing.

Anything the export left in another format is converted with `sips`, its tags
copied across with `exiftool` (the coordinates are the whole reason
`--exiftool` is not optional), and the original removed. Then what is on disk
is compared with `photos.json` by stem, and a missing photograph fails the run
and is named. `--check` runs just that pass over an export that already
happened — useful on its own, and the door this is tested through.

Keeper: three checks in the new `icloud-export/export.test.mjs`, one of them a
real HEIC made with `sips`.
