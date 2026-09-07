---
id: B682
title: A day cannot be written from a phone without an agent
type: FEATURE
priority: high
complexity: high
area: agent, entries, media
found: "2026-09-07T09:52:57Z"
started: "2026-09-07T10:36:14Z"
session: fdfcf5f2-0d32-4db4-bb1c-31e1dc373b09
claimed: "2026-09-07T10:36:14Z"
---

# B682 — A day cannot be written from a phone without an agent

## Why

`docs/plans/2026-09-07-web-helper-agent.md` §1 and §2. This is the flow the
whole feature exists for: pick a trip, pick photographs, say what happened,
read it back, publish. It is deliberately specified with **no model call at
all** — the day is written from the person's own typed words — because the
risk in this feature is uploads, resume and mobile layout, not prose. If this
is not good, no amount of LLM fixes it.

## Work

The wizard: trip → date → photos → words → preview → publish, mounted at
`/agent`, driving the existing v1 routes with the owner cookie.

- **The draft is the session.** No new table. Position is derived from
  `GET /drafts` and the draft's own fields; the day is created as soon as trip
  and date are known.
- **Deterministic prefill** (plan §2): date, time span, coordinates and count
  from EXIF; the place name through `addressLookup`; the trip from the date;
  `weather: true` so the server looks it up. A title suggestion from place and
  weekday. No model anywhere in this task.
- Preview renders the real day card component, so it cannot lie.
- Publish is the owner pressing a button, and says what it will do.
- A resume card on `/agent` for an unfinished day.

Not doing: two-phase upload (B683 — this task uploads simply), any model call
(B684, B685), signup (B688).

## Acceptance

A signed-in owner writes a day on a phone from photographs and their own typed
words, sees it exactly as a reader will, and publishes it — with the `helper`
capability off and zero credits spent. Closing the tab mid-flow and returning
lands on the same step.
