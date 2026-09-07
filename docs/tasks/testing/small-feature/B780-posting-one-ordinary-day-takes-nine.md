---
id: B780
title: Posting one ordinary day takes nine taps
type: FEATURE
priority: high
complexity: medium
area: agent, ui
found: "2026-09-07T14:24:46Z"
started: "2026-09-07T14:47:00Z"
merged: "2026-09-07T15:04:26Z"
---

# B780 — Posting one ordinary day takes nine taps

## Why

Counted on the live instance on 2026-09-07, posting one ordinary day: open
`/agent` (1), write-a-day (2), pick the trip (3), confirm today's date (4),
skip photographs (5), hold to talk (6), through the preview (7), publish (8),
confirm (9). **Nine taps.**

The person this was built for gives up around three. A 19-year-old tester said
plainly that he would put it on his socials instead, "and nobody makes me tap
through six screens to post one photo".

The steps are not wrong — each exists for a reason, and the preview and the
publish confirmation must stay. What is wrong is that the *common case* pays
for all of them. Most days are: today, the trip that is already running, and
the words. Trip and date are already known — the wizard asks anyway, then asks
about photographs the person may not have, then walks them through six screens
to reach the one thing that is actually hard to do on a phone.

## Work

An express path for the ordinary day, with the long path still there.

When the date is today and exactly one trip is running, do not ask: open on the
words, with a quiet line saying which trip and which day this is going to and
an "ändern" link that opens the steps it skipped. Photographs become something
you may add, not a step you must pass. The preview and the publish confirmation
stay exactly as they are — they are the two that must not be optimised away.

Target: three taps from `/agent` to a published day for the common case —
write, speak, publish.

Not doing: removing any step from the long path, or letting publish happen
without its confirmation.

## Acceptance

A person with one running trip posts today's day, spoken, in three taps.
Everything the six steps can do is still reachable from the same screen.
