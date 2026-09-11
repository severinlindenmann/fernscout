---
id: B909
title: An upcoming trip's route cannot be reached over the network at all
type: FEATURE
priority: low
complexity: high
area: api, plan
found: "2026-09-08T04:57:43Z"
started: "2026-09-11T17:27:01Z"
session: 13f12910-ff28-4566-894a-9e2b3d055281
claimed: "2026-09-11T17:27:01Z"
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


## Decisions, 2026-09-11

**Who may read it: whoever may read the trip.** Not the costs rule.

The two precedents disagree and the ticket does not say which to follow.
`/api/v1/{user}/trips/{trip}/costs` documents its authority as *"whoever may
write to this trip may read it"*. But `app/[user]/trips/[trip]/page.tsx:88` and
`app/[user]/(trip)/map/page.tsx:68` both call `readFor(trip)` and then
`getPlan(trip.ref, read)` — so **a guest-approved reader already sees the
planned route in the browser today**.

Copying costs would mean the API refusing something the UI hands over, which
inverts the reason the API exists: AGENTS.md builds the network door precisely
so an agent does not need the browser. Match the pages.

**Draft-derived stops stay owner-only.** `mergeDraftStops` (`lib/plan.ts:138`)
folds future-dated drafts in as extra stops, and only under
`{ includeDrafts: true }`, which `getPlan`'s own comment (lines 41-54) ties to
"a reader must not learn where somebody is going next". That carve-out survives
this decision intact — reader-gated for the plan, owner-gated for the drafts
inside it.

**No model-facing tool in this pass — and do not foreclose one.**

The owner's words: *"the agent can be used for suggestion and trip planning, so
in the future we could implement a more helpful trip planner when a person for
e.g. asks 'I want to go to Japan in September, plan me a trip' or something in
this style, but not yet implement — just keep the door open for that."*

So: ship the route as a plain document. Do **not** add a tool to the helper's
registry, and do **not** write a rule into the code saying no model may ever
call this. The distinction matters — a planner a person asked for, echoing a
place they named, is a different act from a model inventing an itinerary
unprompted, and this ticket should leave the first one buildable.

Practically: keep the write path a normal authenticated route with no
model-specific assumptions baked in, and say in the module comment that a
planner tool is anticipated and deliberately absent rather than refused.

**Scope: GET and PUT only.** No PATCH, no DELETE — a route is small enough that
resending it whole is not the burden it would be for `costs.md`.
