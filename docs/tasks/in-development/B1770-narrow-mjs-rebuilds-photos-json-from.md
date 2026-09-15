---
id: B1770
title: narrow.mjs rebuilds photos.json from the unblurred copy, silently undoing blur.mjs
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper icloud-export, narrow.mjs, blur.mjs
found: "2026-09-15T06:24:24Z"
started: "2026-09-15T06:39:49Z"
session: 135632db-3afb-4bd0-bf02-4ee0fb20ab0d
claimed: "2026-09-15T06:39:49Z"
---

# B1770 — narrow.mjs rebuilds photos.json from the unblurred copy, silently undoing blur.mjs

## Why

`blur.mjs` collapses every photograph inside a named zone onto one coarse
coordinate and writes only `photos.json`; `photos.all.json` deliberately keeps
the true coordinates. `narrow.mjs` rebuilds `photos.json` from
`photos.all.json` on every run. So running `narrow` again after a `blur` — to
change `--km`, to fix `--who`, to re-cap a day — silently restores the precise
coordinates of the house somebody slept in.

Nothing enforces the order and nothing says it happened. It is documented in a
comment at the top of `blur.mjs` ("Run it AFTER narrow.mjs and BEFORE
export/build") and nowhere the person or the next agent would see it.

## Work

`narrow.mjs` reads the `photos.json` it is about to overwrite; if that file
carries `blurred`, either re-apply the same zones after narrowing or refuse and
name the command that would. Re-applying is the better answer — the zone file
is still on disk and the point of the step is that it is not optional.

## Acceptance

`narrow → blur → narrow` leaves every photograph inside a zone still pinned to
the zone's coarse coordinate, and the run says so.
