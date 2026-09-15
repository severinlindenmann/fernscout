---
id: B1768
title: build.mjs writes into a non-empty trip folder, so a rebuilt trip holds both the old entries and the new ones
type: ISSUE
priority: high
complexity: low
area: fernscout-helper icloud-export, build.mjs
found: "2026-09-15T06:24:21Z"
started: "2026-09-15T06:39:46Z"
session: 135632db-3afb-4bd0-bf02-4ee0fb20ab0d
claimed: "2026-09-15T06:39:46Z"
---

# B1768 — build.mjs writes into a non-empty trip folder, so a rebuilt trip holds both the old entries and the new ones

## Why

`build.mjs` creates the trip folder and writes into it; it never clears it.
`.claude/skills/icloud-export/build.mjs` does `mkdirSync(join(TRIP, "entries"),
{ recursive: true })` and then writes one `entries/<day>-<slug>.json` and one
`media/<day>-<slug>/` per day. Anything already there — a day file under an old
naming scheme, a media folder for a day that no longer exists — stays beside
the new files.

Rebuilding a trip is the normal case, not an edge: the slug scheme changed
(B1539), the place filter changed, a person redid a review. In one run every
one of 18 rebuilt trips ended up with exactly double the entries, old
title-slug files beside fresh location-slug ones, and it was noticed only
because two of them collided on a rename. A verification pass would have called
it "28 entries, 0 issues", because every file in there is individually valid.

## Work

`build.mjs` refuses to write into a non-empty `content/<user>/trips/<trip>/`
unless `--force` is given, and with `--force` clears `entries/` and `media/`
first rather than writing over them. `originals/` is not touched — a print
master is not a derivative and is not this script's to remove.

## Acceptance

Building a trip twice leaves exactly the entries and media folders the second
build produced. Without `--force` the second build refuses and says the folder
already holds a trip.
