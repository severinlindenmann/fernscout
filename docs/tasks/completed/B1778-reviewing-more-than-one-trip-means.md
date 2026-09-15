---
id: B1778
title: Reviewing more than one trip means one server per trip on one port each
type: FEATURE
priority: low
complexity: medium
area: fernscout-helper icloud-export, review.mjs
found: "2026-09-15T06:24:45Z"
started: "2026-09-15T06:40:00Z"
merged: "2026-09-15T07:09:16Z"
completed: "2026-09-15T08:19:34Z"
---

# B1778 — Reviewing more than one trip means one server per trip on one port each

## Why

`review.mjs` is one trip per process: `--trip` is required, `DIR` is
`export/<trip>`, and the served page is that trip's photographs. Reviewing a
library that discovery turned into 26 trips therefore means 26 servers on 26
ports and 26 browser tabs, with nothing anywhere saying which trips have been
reviewed and which have not.

The review is the one step that is entirely the person's, and it is the step
with the worst ergonomics in the toolchain.

## Work

One server, an index at `/` listing every trip under `export/` with its
progress — photographs, how many kept, how many dropped, whether a
`review.json` exists at all — and each trip served under `/t/<slug>/`.
`--trip` keeps working and opens straight into that trip.

## Acceptance

`node review.mjs` with no `--trip` serves an index of the exported trips with
their review progress, and each one reviews and saves as it does today.

## Built, 2026-09-15 — fernscout-helper `aa69dbd`

**Valid when taken**: `--trip` was required and every path was that trip's.

One server. `/` is an index of every folder under `export/` with photographs in
it, saying how many photographs, how many turned off, how many days written and
whether it has been reviewed at all; each trip is served at `/t/<trip>/` with
its own `data`, `save`, `img/` and `full/` underneath, and the page's fetches
are relative so two trips cannot collide. A trip is baked and thumbnailed on
first open rather than all of them at startup — 26 trips of 1,100 photographs
would otherwise be a quarter of an hour before the index appeared. `--trip`
still works and opens straight into that trip; `--no-open` is for a test or an
ssh session.

Keepers: eleven checks in the new `icloud-export/review.server.test.mjs`, which
starts the real server. `review.test.mjs` needed no change — its three source
assertions still hold.

**Looked at, on content written before this branch**: the 30 real exports in
`export/`, at 1280 and 390, 200 with no console errors —
`scratchpad/b1778/index-1280.png`, `index-390.png`, and one trip page at phone
width in `t-davos-2026-390.png`.
