---
id: B1770
title: narrow.mjs rebuilds photos.json from the unblurred copy, silently undoing blur.mjs
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper icloud-export, narrow.mjs, blur.mjs
found: "2026-09-15T06:24:24Z"
started: "2026-09-15T06:39:49Z"
merged: "2026-09-15T07:09:13Z"
completed: "2026-09-15T08:19:29Z"
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

## Built, 2026-09-15 — fernscout-helper `aa69dbd`

**Valid when taken**: `narrow.mjs` rebuilds `photos.json` from
`photos.all.json`, which keeps the true coordinates, and `blur.mjs` writes only
`photos.json`.

`narrow.mjs` reads the file it is about to overwrite, and re-applies the blur
rather than asking: `blur.mjs` now records which zone file it used
(`blurZones`), so the same blur is re-run with the same zones. `photos.all.json`
still holds what was really recorded, which is the point of it.

Keeper: four checks in the new `icloud-export/narrow.test.mjs` — narrow, blur,
narrow again, and the coordinates are still the zone's.
