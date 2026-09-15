---
id: B1778
title: Reviewing more than one trip means one server per trip on one port each
type: FEATURE
priority: low
complexity: medium
area: fernscout-helper icloud-export, review.mjs
found: "2026-09-15T06:24:45Z"
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
