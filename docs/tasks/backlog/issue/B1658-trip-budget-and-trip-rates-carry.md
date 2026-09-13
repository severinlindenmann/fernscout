---
id: B1658
title: trip/budget and trip/rates carry the day/trip completeness conflict B1650 found, unrepointed
type: ISSUE
priority: low
complexity: low
area: Helper / Money
found: "2026-09-13T10:13:02Z"
---

# B1658 — trip/budget and trip/rates carry the day/trip completeness conflict B1650 found, unrepointed

## Why

B1650 found that a v2 write validates the *whole merged document*
(`tripCreate.safeParse(merged)`, `app/api/v2/[user]/trips/[trip]/route.ts`),
against `TRIP_DECLINABLES` (10 entries: `rates`, `costs`, `plan`, `days`,
`translations`, `accent`, `cover`, `figures`, `tagline`, `intro`, `listed`,
`buddies`). It decided (c) — leave day and trip writes on the pre-v2 domain
functions — and explicitly flagged money/storage as needing the same check
before assuming a clean repoint (B1650's "Not doing" section).

This is that check, for `trip/budget` and `trip/rates`
(`app/api/helper/[user]/trip/budget/route.ts`,
`app/api/helper/[user]/trip/rates/route.ts`). Both currently call v1-era
domain functions (`patchCosts`, `patchTripRates`) directly on `costs.md`/
`trip.md`-equivalent state, not through the v2 trip route.

**The same conflict applies.** Helper-created trips go through
`app/api/helper/[user]/trip/route.ts` → `createTrip` (`lib/tripWrite.ts`), a
v1-style writer that does not populate a `declined` map for the other eight
`TRIP_DECLINABLES` (`plan`, `translations`, `accent`, `cover`, `figures`,
`tagline`, `intro`, `listed`, `buddies`). Routing `set_budget`/`set_rate`
through v2's `applyTripPatch` would merge-patch onto that stored document and
revalidate the WHOLE thing via `tripCreate.safeParse(merged)` — so a patch
that only touches `costs`/`rates` on a trip missing declines for the other
eight fields would 422 `incomplete`, naming fields nobody was asked about.
That is exactly the "a guard that fires on an honest turn is a bug" case
AGENTS.md and B1650 both call out.

## Work

Not started. Same three-way decision B1650 laid out, scoped to trip writes
specifically:

- (a) teach the wizard the full `TRIP_DECLINABLES` set before any trip patch
- (b) give v2 trip PATCH an incremental mode, completeness enforced later
- (c) leave `trip/budget` and `trip/rates` on `patchCosts`/`patchTripRates`
  (status quo — this is what B1650's decision (c) already implies for trip,
  and what this ticket recommends absent a new decision)

## Acceptance

The owner picks (a), (b) or (c) for trip writes specifically (may just be
"B1650's decision already covers this, close as superseded"). If a build
happens, a test pins that a helper-created trip missing several
`TRIP_DECLINABLES` still accepts a `set_budget`/`set_rate`-shaped patch
without inventing an answer for the other fields.
