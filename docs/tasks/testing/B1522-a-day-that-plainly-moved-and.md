---
id: B1522
title: A day that plainly moved and carries no transportMode draws no leg, and only a tip says so
type: FEATURE
priority: medium
complexity: low
area: helper, content
found: "2026-09-11T20:15:00Z"
merged: "2026-09-12T12:51:31Z"
---

# B1522 — A day that plainly moved and carries no transportMode draws no leg, and only a tip says so

## Status — done in fernscout-helper; moved to testing for a person to confirm

Fixed in `fernscout-helper` commit `57fa24d` ("B1520 B1522: validate-content
catches a title-slug collision and an unmarked leg"). `validate.mjs` now warns
when consecutive days are far apart and the later one has no `transportMode`,
naming both dates, and only tips `travelScene` on a day that actually draws a
leg. Found stale in `fernscout`'s `docs/tasks/open/` on 2026-09-12. Verify: run
`validate-content` on a trip with a big coordinate jump and no transport mode
set, and confirm the warning (not a tip) fires and names both days.

## Why

Raised by an owner on 2026-09-11, after a 23-day trip had already been
published: *"also enable the animations between the days."*

The animations were not off. `travelScene` absent **is** the default scene,
timed to the distance covered — that is what its own tip says. What was missing
was `transportMode`, and without a mode there is no leg, and without a leg there
is nothing for the scene to animate. The owner had no way to know that: the two
fields are documented separately, neither mentions the other, and the trip
looked finished.

`validate-content` did mention both. It mentioned them the way it mentions
everything else — as two lines among **290 tips**, in a run reporting zero
errors and zero warnings:

```
· transportMode is not set — 21 files
· travelScene is not set — 21 files
```

A tip is correct here: a journal with no transport modes is a perfectly good
journal, and `SKILL.md` is emphatic that tips are offers and not a to-do list.
But these two tips are indistinguishable from "you could add tags", and one of
them is the difference between a map that moves and a map that does not.

**The folder already holds the evidence to do better.** Comparing consecutive
days' `lat`/`lng` takes a dozen lines and tells you exactly which days moved:

```
2025-08-24 → 2025-08-25   9034.8 km   Zürich          → Bangkok
2025-09-01 → 2025-09-02      29.7 km   Nai Yang Beach  → Kata Beach
2025-09-10 → 2025-09-11      16.1 km   Phuket          → Khai Nok Island
2025-09-12 → 2025-09-13       8.1 km   Phuket          → Bangkok   ← wrong: see below
```

That is a cross-day, coordinates-and-files question — precisely the half
`AGENTS.md` says the helper keeps for itself because no server can answer it.

## Work

In `validate-content`, alongside the checks it already owns:

- **Warn** (not tip) when two consecutive days are more than a few kilometres
  apart and the later one has no `transportMode`: *"2025-09-02 is 30 km from
  2025-09-01 and names no transport — no leg is drawn between them."* The
  threshold wants to be generous; a day in one city should not nag.
- **Say which day draws the leg.** A mode is read as the leg *into* its day,
  which is not obvious and is easy to put on the wrong one — the departure day
  rather than the arrival day. Naming both dates in the message settles it.
- **Mention `travelScene` only where a leg exists.** Tipping it on a day with no
  mode is advice that cannot be acted on.

This would also have caught a real error in the same journal. The 13th September
carried Phuket coordinates because its photographs were aerial shots taken at
take-off, while the day itself ended in Bangkok — the owner's own note said
*"Reise zurück nach Bangkok"*. `build.mjs` prints that disagreement as a
`⚠` at export time and nothing revisits it; the leg check would have found it
again at validate time, where somebody is still looking.

## Acceptance

- A day whose coordinates are far from the previous day's and which names no
  transport is a warning, naming both dates.
- The message says which of the two days carries the mode.
- A trip that stays in one place produces no such warning.
- `travelScene` is tipped only on days that actually draw a leg.
