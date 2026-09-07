---
id: B731
title: A trip made from the ask box never shows who can read it
type: FEATURE
priority: low
complexity: low
area: agent, trips
found: "2026-09-07T12:16:42Z"
---

# B731 — A trip made from the ask box never shows who can read it

## Why

`app/api/helper/[user]/trip/route.ts:78` — a trip made through the ask box
takes every `createTrip` default, so its visibility follows the journal's and
the person never sees the word.

AGENTS.md is emphatic that the line between `guest` and `private` is what
people get wrong *at the moment they create a trip*, and this is a route that
creates one without ever showing them the question. The default is safe; being
safe and silent is still how somebody ends up surprised about who can read
their honeymoon.

## Acceptance

The confirm panel names who will be able to read the trip and lets that be
changed before it is made.
