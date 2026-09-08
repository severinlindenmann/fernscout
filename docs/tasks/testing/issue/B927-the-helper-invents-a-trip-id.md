---
id: B927
title: The helper invents a trip id instead of using the one it just made
type: ISSUE
priority: high
complexity: low
area: agent, model
found: "2026-09-08T07:12:21Z"
started: "2026-09-08T07:26:34Z"
merged: "2026-09-08T07:52:11Z"
---

# B927 — The helper invents a trip id instead of using the one it just made

## Why

> "I had to correct the trip slug (`georgia` vs `georgia-2026`) three separate
> times across two day-write attempts. The model derives a trip id from the
> title ('Georgia' → 'georgia') instead of remembering the id it just returned
> when it made the trip two turns earlier."

A trip's id is chosen by the server — `create_trip` derives it and answers with
it — and the model is guessing it back from the title instead of using the
answer it was given. Every guess that misses produces `unknown_trip`, and B916
then reports the failure as a success.

This is likely the same root as B925's `unknown_day`: an identifier invented
rather than carried.

Found live on 2026-09-08.

## Work

Make the identifiers impossible to invent. Two directions, and the first is
better:

- **The tool resolves them.** A person says "the Georgia trip" and the tool
  matches it against the trips that exist, the way `read_day` already resolves a
  date. The model then never handles an id at all.
- Or the thread carries the ids it has been given, explicitly, so the model has
  them to hand.

Prefer the first: an id the model never touches is an id it cannot get wrong,
and B926 shows the thread is not a reliable memory yet.

## Acceptance

Nobody is asked to correct an id, and a trip made two turns ago can be written
into by name.
