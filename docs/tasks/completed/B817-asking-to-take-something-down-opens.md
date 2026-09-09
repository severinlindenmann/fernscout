---
id: B817
title: Asking to take something down opens the screen that creates one
type: ISSUE
priority: high
complexity: low
area: agent
found: "2026-09-07T15:30:51Z"
started: "2026-09-07T15:37:34Z"
merged: "2026-09-07T15:54:34Z"
completed: "2026-09-09T16:46:49Z"
---

# B817 — Asking to take something down opens the screen that creates one

## Why

Typed into the ask box: **"take down the day with the photo of anna"**.

It routed to `write_day` and opened the wizard at step one, pre-set to *today's*
date, ready to create a brand-new day. No error, no "unknown", nothing on the
screen saying this was not what was asked.

A request to **remove** something opened the screen that **creates** something.

This is B808's fault made worse. There it answered a vague question with the
wrong fact; here it answers a destructive request with a creative screen, and a
person half-paying attention could write and publish a day while trying to take
one down.

The cause is structural, not a bad guess: `lib/helper/intents.ts` has five rows
and none of them is about editing, costs or removal, so anything in that
territory either falls to `unknown` — which the same tester got three times,
correctly — or is swallowed by the nearest neighbour.

## Work

Two things, and the first is the safety:

1. **Refuse removal language outright.** A sentence containing "take down",
   "delete", "remove", "löschen", "entfernen" must never route to a row that
   creates or publishes. Name it and say where it happens, the way B783 asks
   for named refusals — an answer, not a route.
2. Add the rows the territory needs (B816's takedown, B820's costs), so the
   nearest neighbour stops being wrong by default.

Feed the confidence this misroute carried into B730's measurement.

## Acceptance

"Take down the day with the photo of anna" never opens a screen that writes.
