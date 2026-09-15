---
id: B1775
title: publish writes to the instance without touching the sync baseline, so the next sync refuses to move anything
type: ISSUE
priority: medium
complexity: medium
area: fernscout-helper publish, sync
found: "2026-09-15T06:24:43Z"
started: "2026-09-15T06:39:55Z"
session: 135632db-3afb-4bd0-bf02-4ee0fb20ab0d
claimed: "2026-09-15T06:39:55Z"
---

# B1775 — publish writes to the instance without touching the sync baseline, so the next sync refuses to move anything

## Why

`publish.mjs` pushes local documents and photographs to the instance and never
touches `.fernscout-sync.json` — the baseline is written by `sync.mjs` alone
(`shared/syncManifest.mjs:29`, `sync/sync.mjs:246`). After a publish, both
sides hold identical content and the baseline says nothing was ever synced, so
the next `sync down` classifies every one of those paths as "written on both
sides, never synced" and refuses to move. In one run that was 1,267 files.

The refusal is correct — without a baseline the sync genuinely cannot tell
"identical because one came from the other" from "two people edited this". What
is wrong is that the tool that made them identical did not say so.

## Work

Have `publish` record the baseline for the paths it actually wrote: each
document it created or corrected, each photograph it uploaded and adopted, and
`config.json` when it sent one. Nothing else — a path publish did not touch
must keep whatever the baseline already said about it, and a `--dry-run` writes
nothing.

## Acceptance

`publish` followed immediately by `sync down` reports nothing to do, on a
journal where the two sides agree; a file genuinely edited on the instance
afterwards is still planned for a pull.
