---
id: B1078
title: A trip's title, dates, visibility, people and tracks cannot be changed from the conversation
type: FEATURE
priority: medium
complexity: medium
area: lib/helper/tools/areas/trips.ts
found: "2026-09-09T15:41:56Z"
merged: "2026-09-09T15:42:44Z"
completed: "2026-09-09T16:45:11Z"
---

# B1078 — A trip's title, dates, visibility, people and tracks cannot be changed from the conversation

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

The API door has taken a trip's title, dates, visibility, `people:` and
`tracks` since long before the helper existed. The conversation could create a
trip and then never touch it again — the prompt said so in as many words:
*"Changing a trip's title, dates or who may read it after it exists: the trip
form on their journal."* For an owner with no agent of their own, that sentence
was a dead end, because the form is on a page they reach only by knowing it is
there.

## Work

`edit_trip`, `set_visibility`, `trip_people`, `trip_tracks`, each pressing a
new cookie-only helper route that calls the same writer the v1 route calls
(`patchTripDetails`, `patchTripVisibility`, `patchTripParty`, `patchTripTracks`).
Visibility is a `<select>` built from `VISIBILITIES`, so the three words are
read before one is chosen rather than typed from memory.

Not doing: cover, accent, intro or `costsVisibility` — nobody has asked the
conversation for those.

## Acceptance

Say *"nenne die Reise anders"* in the room and a proposal appears with the
current title filled in. Press it; `trip.md` carries the new title. Say
*"wer darf das lesen"* and the three options are the three words, described.
