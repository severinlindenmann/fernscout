---
id: B1793
title: A file pruned by sync down --yes keeps its baseline entry, so a path the site holds again reads as a local deletion for ever
type: ISSUE
priority: medium
complexity: low
area: fernscout-helper sync
found: "2026-09-15T10:07:38Z"
merged: "2026-09-15T10:07:59Z"
---

# B1793 — A file pruned by sync down --yes keeps its baseline entry, so a path the site holds again reads as a local deletion for ever

## Why

Walked into on fernscout.ch/severin, 2026-09-15, while repairing B1790: 18
photographs were deleted on the site, pruned from the folder with `sync down
--yes`, and then restored on the site — and **no sync would bring them back**.

`sync.mjs` records agreement for what a run settled, and skips any path still
carrying a pending action. A `delete-local` the person confirmed is settled —
the file is gone, that is what they asked for — but it is not in `moving`
(which is `pulls` on the down leg), so it stays `pending`, the `continue` fires
and the path **keeps its old base entry**. That entry says this folder once
held those bytes.

The moment the site holds that path again, the entry is a lie with
consequences: `plan()` sees local absent, remote present, and a base that
remembers a local hash, so it calls it `delete-remote` — "deleted locally, and
still on the site" — and offers to delete it there. `down` will not pull it,
`up` names it on every run. The two legs disagreeing about one path is exactly
what B1787 was, arrived at by a different road.

Observed: `4940 files on the site, 4922 here`, `down` planning `pull 0,
unchanged 4940` while `up` listed the same 18 under "gone from this folder and
still on the site". Dropping the 18 stale entries by hand made the next `down`
pull them as new on the site, and both legs then agreed on all 4940 files.

## Work

Count a confirmed prune as settled, so the entry goes rather than lingering:
the recording step's `moved` set should include `pruneLocal` when the down leg
actually pruned (`--yes`). Nothing else changes — a prune the person did not
confirm is still pending, and must keep its entry.

Fixed on the branch that found it; this ticket is the record and the keeper it
still needs.

## Acceptance

A file deleted on the site, pruned locally with `--yes`, and then restored on
the site is pulled by the next `sync down` and is not named by `sync up`. The
base manifest holds no entry for a path the folder does not have.
