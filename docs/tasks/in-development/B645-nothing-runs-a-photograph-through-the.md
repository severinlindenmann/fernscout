---
id: B645
title: Nothing runs a photograph through the helper's build.mjs, so nine were published sideways
type: ISSUE
priority: high
complexity: medium
area: helper: icloud-export, media
found: "2026-09-06T19:32:40Z"
started: "2026-09-07T12:45:59Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T12:45:59Z"
---

# B645 — Nothing runs a photograph through the helper's build.mjs, so nine were published sideways

## Why

Observed in a real run on 2026-09-06 (`elsass-2025`, 35 photographs onto
`https://fernscout.ch`): nine pictures were served lying on their side — three
at EXIF `Orientation` 3, six at 6.

A phone held sideways writes **upright pixels plus an `Orientation` tag** saying
how to turn them. `build.mjs` strips all metadata (`exiftool -all=
-overwrite_original`, correctly — that is where the GPS of somebody's front door
lives) and nothing turned the pixels, so the tag went and the picture stayed on
its side for good.

**No check in the helper could have caught it.** `validate-content` passed, the
review page looked perfect, and it was found by a person reading the published
journal. `shared/selftest.mjs` runs three fixture journals through the
*validator*; nothing anywhere runs a picture through `build.mjs` and looks at
the result. That absence — not the rotation — is the finding: the media pipeline
is the one part of the helper that transforms somebody's own files, and it is
the one part with no test.

The rotation itself is already fixed: `bakeOrientation()` at
`.claude/skills/icloud-export/build.mjs:46-68`, called at line 87 between the
resize and the strip, mapping all eight EXIF values including the four mirrored
ones. It is committed and unverified by anything.

## Work

A test that runs a real image through `build.mjs` and looks at the output:

- A fixture image per orientation, a few hundred bytes each, generated once with
  `sips`/`exiftool` and committed under `shared/fixtures/orientation/`. Same
  argument as the journal fixtures — a fixture that only exists on the machine
  that wrote it is not a regression test.
- Assert the output's width/height are the *displayed* ones (a 3:4 portrait
  stays portrait), and that `exiftool -Orientation` on the output returns
  nothing.
- Guard that `sips` and `exiftool` are present. `bakeOrientation` swallows a
  missing `exiftool` with a bare `catch { return }` — safe, but silently back to
  the old behaviour, which is exactly how this would come back.

Also check whether `icloud-export` is the only place metadata is stripped. Any
other skill running `-all=` on an image has the same bug; not checked in that
run.

One thing a fix here will make somebody want: **a `--media-only` flag.**
Re-running `build.mjs` to repair pictures rewrites every entry from scratch —
titles, prose and translations included — so the nine here were repaired with a
one-off that reproduced its own day-grouping and numbering. Capture that
separately if it is wanted; it is not part of this task.

Not doing: a general image-comparison harness. Dimensions and the absent tag are
the whole assertion.

## Acceptance

`node .claude/skills/shared/selftest.mjs` (or a sibling media selftest) runs the
orientation fixtures through `build.mjs` and fails if `bakeOrientation` is
removed, and if `exiftool` is missing it says so rather than passing.
