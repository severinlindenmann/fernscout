---
id: B1776
title: figures are journal content the sync carries in neither direction
type: ISSUE
priority: medium
complexity: medium
area: lib/sync/manifest.ts, fernscout-helper sync
found: "2026-09-15T06:24:44Z"
started: "2026-09-15T06:39:57Z"
merged: "2026-09-15T07:09:15Z"
---

# B1776 — figures are journal content the sync carries in neither direction

## Why

`inSync()` in `lib/sync/manifest.ts:185` is an allow-list: `config.json`,
`inbox/` and `trips/` are in, and everything else at the top level is out for
not being one of the three. Figures live at `content/<user>/figures/<id>.json`
(`lib/figures.ts:42`), so they are in neither direction of a sync — not pulled
down to a folder, not pushed up from one. `fernscout-helper`'s copy of the rule
(`shared/syncManifest.mjs`) mirrors it exactly, so the gap is the same on both
sides and its own consistency check cannot see it.

They are ordinary journal content: a journal-level document with an id since
B1609, written over the API, read back over the API, referenced by trips,
copied onto the box by the deploy (B1682). A hosted owner with no filesystem
has no other way to hold a copy of their own figure library, and a folder that
mirrors the instance is not a mirror while it is missing them. Restoring them
after a mistake is a hand job today.

## Work

Add `figures/` to `inSync()` — `figures/<id>.json` only, nothing deeper — and
mirror it in the helper's copy. Then check what the sync routes do with a
document they have not carried before: the pull writes a file, and the push has
to reach the figure door (`PUT` with `If-Match`; see B1774), not the generic
file write.

`gps/`, `postcards/` and `photobooks/` stay excluded, for the reasons already
written beside them.

## Acceptance

`sync down` into an empty folder brings the figure library with it; a figure
edited locally is planned and pushed by `sync up`; `gps/` is still refused.

## Built, 2026-09-15 — fernscout `48fba671`, fernscout-helper `aa69dbd`

**Valid when taken**: `inSync` (`lib/sync/manifest.ts:185`) is an allow-list of
`config.json`, `inbox/` and `trips/`, and figures live at
`content/<user>/figures/<id>.json` (`lib/figures.ts:42`).

`figures/<id>.json` is in the allow-list on both sides — one level, documents
only, so a stray image under `figures/` is still refused. The pull writes the
files like any other; the push goes through the figure door rather than a byte
write, which is B1774. `gps/`, `postcards/` and `photobooks/` are unchanged.

Keepers: two tests in `test/sync-manifest.test.ts` (the manifest lists a figure,
the file door serves it) and one in the helper's `sync.test.mjs` (in, in any
spelling; a `.png` under `figures/` and a nested path are out).

**For a person to check**: the end-to-end — `sync down` into an empty folder
bringing the figure library — needs fernscout.ch to be running this first. The
route tests prove the door; the deploy is what makes it true for a real folder.
