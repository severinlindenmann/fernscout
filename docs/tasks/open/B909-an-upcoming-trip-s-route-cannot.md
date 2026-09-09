---
id: B909
title: An upcoming trip's route cannot be reached over the network at all
type: FEATURE
priority: low
complexity: high
area: api, plan
found: "2026-09-08T04:57:43Z"
---

# B909 — An upcoming trip's route cannot be reached over the network at all

## Why

`plan.md` — a trip's planned route, the `route:` of `location:` stops for a
journey that has not happened yet — has **no route in the API at all**.

`lib/plan.ts:57` reads it from disk. `lib/contentModel/document.ts:283` has
rules for its shape. `lib/api/openapi.ts` never mentions it, and nothing under
`app/api` reads or writes it.

So the one thing a person does *before* a trip is the one thing an agent cannot
help with, and "plan my trip" is not a helper gap — it is a platform gap with
nothing behind it to call.

AGENTS.md lists `plan.md` as part of the content model, which makes this an
unfinished half rather than a decision.

Found by mapping every operation to a chat shape, 2026-09-08.

## Work

`GET` and `PUT` on `/api/v1/<user>/trips/<trip>/plan`, following what
`lib/plan.ts` already parses. Then decide whether a conversation should be able
to write one — a planned route is a list of places, which is exactly the kind
of thing a model invents when it is not certain, so the rules that keep it
honest need writing before the tool does.

Large because it is a new document type in the contract, not because the route
is hard.

## Acceptance

An upcoming trip's planned route can be read and written over the API, and
`/agent.md` says what may go in it.
