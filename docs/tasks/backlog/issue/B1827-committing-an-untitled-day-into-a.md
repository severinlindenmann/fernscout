---
id: B1827
title: Committing an untitled day into a trip whose originals already hold a day folder is refused as slug_taken
type: ISSUE
priority: medium
complexity: low
area: extract, day assembly
found: "2026-09-16T21:47:49Z"
---

# B1827 — Committing an untitled day into a trip whose originals already hold a day folder is refused as slug_taken

## Why

Found during B1803's final browser walk, not by a test. `POST .../extract/commit`
answers `slug_taken` for any new untitled day committed into a trip whose
`originals/` directory already holds a `day*` folder. The example journal's
`asia-2023` is such a trip, so the walk had to use `lisbon-2025` instead — which
is the shape of the bug: a person importing a camera roll into the trip they
already keep photographs in is exactly the common case, and it is the case that
fails.

The collision is by slug, and an untitled day's slug is derived rather than
given, so two untitled days in one trip collide with each other by construction.
Nothing in the import flow can work around it: the person has not named the day
and is not asked to.

Pre-existing — it is not caused by B1803, which only surfaced it — so it is a
ticket rather than a fix on that branch.

## Work

Read `createDraft`'s collision check and decide whether an untitled day should
derive a slug that cannot collide (the date is already in hand and is unique
per day within a trip) or whether the commit path should retry with a
disambiguated slug. Prefer the first: a slug that collides by construction is
the defect, and a retry loop only hides it.

Check what an `originals/day*` folder left by an earlier, unrelated import does
to the answer — the walk hit this against a folder no current day owns.

## Acceptance

- Committing an untitled day into a trip that already holds a `day*` folder
  succeeds, proven against the example journal's `asia-2023`.
- Two untitled days committed into the same trip both land, with distinct
  slugs.
- A test covers the collision case that currently returns `slug_taken`.
