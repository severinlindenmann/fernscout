---
id: B1187
title: The signup wizard's first-trip step lost its data in a persona round
type: ISSUE
priority: medium
complexity: medium
area: signup
found: "2026-09-09T21:00:51Z"
---

# B1187 — The signup wizard's first-trip step lost its data in a persona round

## Why

Same persona round: after filling the wizard's own first-trip mini-form and
pressing "Start this trip", the browser ended up on an unrelated page and
the trip was not created (the journal existed; `trips/` was empty until a
later conversation created one). The round ran in a shared Playwright
browser that also held localhost tabs, so the navigation target
(localhost:3010) is probably contamination — but the lost trip is a real
observation either way, and `createTripStep` posts the trip *before* the
sign-in relay, so the failure mode needs an isolated reproduction.

## Work

Reproduce in a clean browser profile against the live instance: signup →
first-trip step → does the POST fire and land? If the POST succeeded and
only navigation went wrong, the fix is wizard-side resilience (show the
created trip on return rather than silently losing the step). Related:
B1095 (personas sharing one browser) is what made this finding ambiguous.

## Acceptance

The first-trip step either completes or fails visibly with the data still
in the form; an isolated persona re-run cannot lose a trip silently.
