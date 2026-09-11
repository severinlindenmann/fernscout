---
id: B1414
title: docs/TESTING.md's privacy section never mentions buddy links or per-photo visibility
type: DOCS
priority: high
complexity: low
area: docs
found: "2026-09-11T05:11:55Z"
---

# B1414 — docs/TESTING.md's privacy section never mentions buddy links or per-photo visibility

## Why

Found while triaging B1384. `docs/TESTING.md`'s section F ("Privacy") walked
13 cases (F1-F13) covering trip visibility, `listed`, `teaser` and
`costsVisibility`, but never exercised either of the two access mechanisms
this instance actually ships on top of a trip's own `people:` block:

- a **buddy link** (`lib/contacts/invites.ts`, B33) — grants write access to
  one named trip, and read access to every `guest` trip in the journal, at
  once, from a single approval
- **per-photo `visibility`** (`lib/photos.ts`, B596) — one gallery item held
  back tighter than the trip it is in, which `maySeePhoto` enforces on every
  reading path and the media route enforces again so a held-back photo is
  not left reachable by URL

A privacy test pass that never drives either is a real gap: both are places
where "closed to everyone but the right people" could quietly fail and
nothing in the existing walkthrough would catch it.

## Work

Done as part of B1384's docs pass (see the `run-docs` worktree/branch): added
**F6a** (issue a buddy link for a trip, approve it, confirm the address gets
write access to that trip *and* read access to every `guest` trip) and
**F7a** (mark one photo `visibility: guest` on an otherwise-public day,
confirm it drops out of the gallery and its direct URL 404s) between the
existing F6/F7 and F7/F8, and updated F13's cleanup line to match.

## Acceptance

`docs/TESTING.md` section F exercises a buddy link and a per-photo
`visibility` label, each with its own row and a concrete command. A person
reads the new F6a/F7a rows and can run them against a local checkout with no
further digging.
