---
id: B1340
title: The credits sheet carries display settings and the storage bar sits away from the files
type: FEATURE
priority: high
complexity: medium
area: helper
found: "2026-09-10T17:04:25Z"
started: "2026-09-10T17:04:38Z"
session: b9809a36-bbcb-4095-a4b1-58adf1c351c6
claimed: "2026-09-10T17:04:38Z"
---

# B1340 — The credits sheet carries display settings and the storage bar sits away from the files

## Why

The ⋯ menu's "Guthaben & Speicher" sheet also carried text size and the
dark-room toggle, and the storage bar sat with the credits although it is a
fact about the files. Owner decisions E01 A, E06 A and E07 (2026-09-10,
docs/plans record: the round-2 artifact).

## Work

- The menu has four entries: Sprache, Darstellung, Guthaben & Speicher,
  Eigenen Agenten anbinden. Darstellung is its own Sheet (S/M/L + dark room),
  markup moved out of AccountSheet.
- AccountSheet now shows balance, month spend and "Guthaben kaufen" only.
- `StorageLine` renders the storage bar at the foot of the files pane (rail
  and phone tab share the fragment), linking to `/<user>/account`.

## Acceptance

On desktop the ⋯ menu lists the four entries; Darstellung opens a sheet
with S/M/L and the dark toggle; the credits sheet carries no display or
storage section; the expanded files rail ends in "Storage 0.02 GB of 5.0 GB"
linking to the account page. Checked in Playwright on 2026-09-10.
