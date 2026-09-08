---
id: B1028
title: The owner's own trip form cannot edit the three fields the API just gained
type: FEATURE
priority: low
complexity: low
area: api, trips, owner tools
found: "2026-09-08T20:18:41Z"
---

# B1028 — The owner's own trip form cannot edit the three fields the API just gained

## Why

TODO — the problem, not the fix.

## Work

TODO

## Acceptance

TODO

## Why

B907 widened `patchTripDetails` (`lib/api/tripDetails.ts`) so an agent can
correct a trip's `intro`, `accent` and `costsVisibility` over
`PATCH /api/v1/<user>/trips/<trip>`. The browser's own `/api/trip` route shares
that function but keeps a separate, smaller `DETAILS` list, so the owner
looking at their own trip in a browser still cannot change those three.

That is the asymmetry AGENTS.md warns about from the other side: the agent can
do something the owner cannot, on the owner's own trip.

It was deliberately out of B907's scope, which was the agent-facing API.

## Work

- Decide whether the owner-facing form should gain the three fields at all —
  `intro` is prose and may belong to the writing flow rather than a form.
- If yes, widen `DETAILS` and the form, reusing the same validation
  `patchTripDetails` already applies. Do not copy the enum checks.

## Acceptance

An owner can correct a trip's accent from their own trip page, or the file
says why that is not wanted.
