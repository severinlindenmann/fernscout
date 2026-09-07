---
id: B647
title: publish.mjs matches a day by date alone and overwrote one day with another day's content
type: ISSUE
priority: high
complexity: low
area: helper: publish
found: "2026-09-06T19:32:57Z"
started: "2026-09-07T12:46:00Z"
session: 97b44327-dee7-4b48-bf97-305a0b3d1f54
claimed: "2026-09-07T12:46:00Z"
---

# B647 — publish.mjs matches a day by date alone and overwrote one day with another day's content

## Why

Observed on 2026-09-06: `publish.mjs` wrote one day's content over another day's.

The Friday of `elsass-2025` was split into two entries,
`2025-11-14-hotel.md` and `2025-11-14-othmarsingen.md`. The instance held one
day on that date, `mit-dem-zug-nach-othmarsingen`. Entries are processed in
filename order, so `…-hotel.md` went first: no recorded `slug:`, no title match,
and `sameDate.length === 1`, so the date-alone branch at
`.claude/skills/publish/publish.mjs:523-531` fired and **the hotel content was
written over the Othmarsingen day**. Then `…-othmarsingen.md` matched the same
day by title and overwrote it again.

Net result: the hotel day was never created, its two photographs were never
uploaded, and `slug: "mit-dem-zug-nach-othmarsingen"` was recorded into
`…-hotel.md` — so every future run would have repeated the collision.

The comment at `publish.mjs:442-443` states the invariant that was violated:

> Two days sharing a date are left alone rather than guessed at; a genuinely new
> day on a date that already has one is still created.

Both halves are true only of the *remote* side. The code counts remote days
sharing the date and never looks at how many **local** entries share it.

Worked around by hand: the day was created with a direct `POST …/days` and the
returned slug (`am-abend-im-hotel`) written into the file. The journal is
correct; the bug is not.

## Work

Guard the date-alone branch on the local side too: guess only when this date has
exactly one entry in the folder **and** exactly one day on the instance. Two
local entries on a date make a date-alone match provably ambiguous, and the day
should be created instead. The entry list is already in hand where the loop
runs — a `localByDate` map beside `byDate`, and one extra condition.

At the same time: the `slug:` write-back happens whether the match was certain
or a guess, which turns a one-run mistake into a permanent one. Do not write
back a slug that came from the date-alone branch.

## Acceptance

A trip folder with two entries on one date, against an instance holding one day
on that date, creates a second day rather than overwriting the first, and writes
no `slug:` into either file from a guess. `--dry-run` says the same.
