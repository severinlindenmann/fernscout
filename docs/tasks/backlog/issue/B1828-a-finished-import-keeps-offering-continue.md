---
id: B1828
title: A finished import keeps offering Continue and warns about photographs already in the journal
type: ISSUE
priority: medium
complexity: low
area: extract, staging expiry
found: "2026-09-16T21:54:53Z"
---

# B1828 — A finished import keeps offering Continue and warns about photographs already in the journal

## Why

`unusedPhotoCount` (`lib/staging/expiry.ts:129-130`) decides whether a staged run
still has work left, and it matches on `p.date` alone. But `commitDay`
(`lib/extract/commit.ts:88-122`) copies `takenAt` onto the inbox entry and never
writes `photo.date` back onto the manifest row — so for the ordinary case, an
import of camera-dated photographs where the person never hand-edits a date,
every row still looks unused after every day has been told and committed.

What the person sees: a finished import stays on the resume list with a Continue
button, and the expiry mail warns them that N photographs are about to be
deleted — photographs that are already safely in their journal. The mail is
alarming and untrue, which is worse than the stale button.

This is the fourth copy of a rule B1803's final review consolidated everywhere
else: what date a photograph actually counts as. `lib/extract/dayCount.ts` now
holds `effectiveDate`, and `commit.ts`, `ReadyScreen` and `PreviewScreen` all
call it. This one site was missed because it lives in the expiry path rather
than the screens.

Pre-existing (B1751-era), surfaced by B1803's re-review, so a ticket rather than
a fix on that branch.

## Work

Have `unusedPhotoCount` use `effectiveDate(p)` from `lib/extract/dayCount.ts`
against the run's committed dates, rather than `p.date`. `DayRow.committed`
already records which dates went, so the set is in hand.

Check the same question for anything else reading `photo.date` raw — the point
of the shared helper is that this rule lives once.

## Acceptance

- A run whose every day has been committed reports zero unused photographs,
  proven for camera-dated photographs that were never hand-edited.
- Such a run leaves the resume list and generates no expiry warning.
- A run with genuinely uncommitted photographs still reports them.
- A test covers the camera-dated case that currently over-counts.
