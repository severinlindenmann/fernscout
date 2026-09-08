---
id: B730
title: The router confidence floor is a guess with nothing to tune it against
type: ISSUE
priority: low
complexity: low
area: agent
found: "2026-09-07T12:16:40Z"
started: "2026-09-08T21:12:03Z"
session: bdd0270d-3797-42c9-8687-06abecadbc63
claimed: "2026-09-08T21:12:03Z"
---

# B730 — The router confidence floor is a guess with nothing to tune it against

## Why

`app/api/helper/[user]/ask/route.ts:44` treats anything under 0.5 confidence as
`unknown`. The number is a guess, made with no traffic to tune it against, and
it decides how often the box says "I am not sure" versus opening a wrong screen
— which is the whole feel of the feature.

Too high and the box is useless; too low and it confidently opens the wrong
thing, which the confirm panel catches but which still wastes the tap.

## Work

Not a code change yet. Log what confidence real asks come back with, and what
the person did next, before moving the number. Then move it once, with the
measurement written into the file beside it.

## Acceptance

The floor is a number somebody measured, and the file says what the measurement
was.
