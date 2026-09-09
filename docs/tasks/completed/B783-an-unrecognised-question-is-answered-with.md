---
id: B783
title: An unrecognised question is answered with silence
type: ISSUE
priority: medium
complexity: low
area: agent
found: "2026-09-07T14:24:47Z"
started: "2026-09-07T15:37:35Z"
merged: "2026-09-07T15:54:36Z"
completed: "2026-09-09T16:47:12Z"
---

# B783 — An unrecognised question is answered with silence

## Why

`unknown` is a first-class answer and lands on the buttons — which is right,
and B685 built it deliberately. But the tester found two cases where landing on
the buttons reads as broken rather than as safely refused:

- *"whats my trip called"* → `unknown`, confidence 0.1. A plain lookup somebody
  would genuinely ask, and there is no row for it.
- *"delete my acc"* → `unknown`, confidence 0.05. Correctly not routed —
  deleting is never an agent's to finish — but the person gets **silence**,
  with no hint that the thing is possible at all or where it happens.

Silence is the wrong answer to a question the software understood well enough
to refuse.

## Work

Two things, and they are separate:

1. **A `whats_my_trip`-shaped read row** — the current trip, its dates, how
   many days are written, how many still drafts. Cheap, and it is the question
   people ask first.
2. **Named refusals.** Where an intent is deliberately not in the registry —
   deletion, publishing, postcards — say so in a sentence and point at where it
   does happen, rather than falling through to `unknown`. "Ein Reisetagebuch
   löschen kannst du hier nicht — schreib an …, dann kommt eine Mail mit einem
   Knopf." That is not a route to deletion; it is an answer.

Keep `unknown` for what it is actually for: a sentence nobody could map.

## Acceptance

Asking about deletion gets an explanation and a next step, never silence.
Asking what the trip is called is answered.
