---
id: B1415
title: docs/superpowers/ is not indexed from docs/README.md, and its nature as documentation vs. scratch output is undecided
type: DOCS
priority: low
complexity: low
area: docs
found: "2026-09-11T05:28:32Z"
merged: "2026-09-14T06:15:22Z"
---

# B1415 — docs/superpowers/ is not indexed from docs/README.md, and its nature as documentation vs. scratch output is undecided

## Why

Found while fixing B1384's docs/README.md index (which was missing
`guides/`, `security/` and `screenshots/` — fixed separately; `security/`
stayed out of scope on purpose, per that ticket's answer).

`docs/superpowers/plans/` and `docs/superpowers/specs/` hold several dated
files (photobook ordering, Gelato formats/print, instance identity, docs
information architecture) that read like the `superpowers` plugin's own
working output — similar in shape to `docs/plans/` (W01-W38, "the record of
intent, written before the work, never updated to match what shipped") but
written by a different skill and never folded into that convention or
mentioned anywhere in `docs/README.md`.

Nobody has decided whether this directory is documentation worth indexing,
scratch output that should be gitignored, or content that belongs merged
into `docs/plans/` proper.

## Work

A person decides what this directory is for, then either: add it to
`docs/README.md`'s index with the same "kept, never corrected" framing as
`plans/`; merge its files into `docs/plans/`; or gitignore it as
per-session scratch output the `superpowers` skill should not be committing
in the first place.

## Acceptance

`docs/superpowers/` is either indexed from `docs/README.md`, merged into
`docs/plans/`, or gitignored — not silently present and undocumented, as it
is today.

## Fixed 2026-09-14

Indexed, not merged and not gitignored. `docs/README.md` now lists
`superpowers/` in the top table and describes it, next to `plans/`'s own
paragraph, as the same "record of intent, kept, never corrected" convention
from before this repo started landing dated plans straight into `plans/`
(`2026-08-31-w37-owner-and-guests.md` is the first of those). Merging its
files into `plans/` was ruled out: that directory is intent as written before
the work and is never corrected to match what shipped, and moving files in
under a fresh eye would risk starting to "fix" filenames or content that AGENTS.md
says must stay exactly as written. Confirmed the content is still accurate
rather than stale scratch output before indexing it — read
`docs/superpowers/plans/2026-09-12-inbox-day-assembly-phase-5.md`, which
matches the inbox day-assembly work (B1595 and siblings) that just landed
Phase 3 on `main`.
