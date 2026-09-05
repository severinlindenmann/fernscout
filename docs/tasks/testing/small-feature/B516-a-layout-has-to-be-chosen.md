---
id: B516
title: A layout has to be chosen one day at a time
type: FEATURE
priority: medium
complexity: low
area: photobook, ui
found: "2026-09-05T20:42:57Z"
merged: "2026-09-05T21:19:43Z"
---

# B516 — A layout has to be chosen one day at a time

## Why

Choosing "two to a page" means opening a day, tapping it, closing the day, and
doing that seventeen more times on a trip like `parks-2025`.

Somebody who wants a consistent book — which is a perfectly good thing to want,
and what most printed albums are — has to do the same thing on every day, and
the composer offers no way to say it once.

## Work

An "apply to every day" beside the layout choices, and possibly a book-level
default that days inherit until one of them says otherwise.

The second is the better shape and the larger change: it needs `DayPlan` to
distinguish "this day says pairs" from "this day inherits pairs", which is a
third state the planner and the summary row both have to read. Start by
deciding which of the two this is.

**Not doing:** presets or themes. A named set of choices is a template system
and `plan.ts` explains at its top why there is not one.

## Acceptance

- A layout can be applied to every day of a trip in one action.
- A day arranged by hand is either kept or overwritten, and which one it is is
  obvious before the action rather than after.
