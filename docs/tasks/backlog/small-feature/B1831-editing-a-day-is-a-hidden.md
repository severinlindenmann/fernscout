---
id: B1831
title: Editing a day is a hidden panel rather than something a person can find
type: FEATURE
priority: medium
complexity: medium
area: studio, days, ui
found: "2026-09-17T05:11:55Z"
---

# B1831 — Editing a day is a hidden panel rather than something a person can find

## Why

`components/EditDay.tsx` is good and does a lot — title, time, location,
visibility, body, per-photograph captions and visibility, translations. It is
reachable only from `OwnerTools` on the day page, which means a person has to
already be looking at the day they want to change, and has to know the panel is
there.

Nothing lists "edit a day" as a thing you can do. With the studio (B1829) that
becomes the obvious place for it.

Plan: `docs/plans/2026-09-17-the-studio.md`.

## Work

Rehouse editing as a studio flow: pick the day, change it, preview, save.

**Reuse `EditDay`; do not rewrite it.** The field handling, the caption and
per-photograph visibility model and the translations behaviour are all correct
and tested. What this ticket adds is the way in — choosing which day — and the
skeleton's preview and decide steps around it.

Adding photographs to a day that already exists belongs here rather than in
B1830.

**Open question to settle while building, not by guessing:** whether the day
page keeps its own edit control. The studio is the front door, not necessarily
the only door, and somebody looking at a day they want to fix should probably
still be able to fix it there. Decide with the person and record the decision.

Correcting or taking down a published day already exists in `OwnerTools` (B816,
B877) and should be reachable from the flow too, not duplicated.

## Acceptance

- A day can be chosen and edited from the studio, without first navigating to
  it.
- Photographs can be added to an existing day.
- `EditDay`'s existing behaviour is unchanged — captions, per-photograph
  visibility and translations all still work.
- Real en/de/hu strings; `npm run i18n:keys` clean.
- Verified in a real browser at desktop and phone width.
- `npm run verify` passes.
