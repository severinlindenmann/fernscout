---
id: B352
title: A trip's rates cannot be set after it is created, but the costs page tells the owner to edit trip.md
type: ISSUE
priority: high
complexity: medium
area: costs
found: "2026-09-04T19:57:18Z"
started: "2026-09-04T20:35:15Z"
session: 62683d95-33a6-4db0-a254-7a8fcbcf014e
claimed: "2026-09-04T20:35:15Z"
---

# B352 — A trip's rates cannot be set after it is created, but the costs page tells the owner to edit trip.md

## Why

A trip's costs page, when a day was paid in a currency the trip has no rate for:

> Not counted in these totals: EUR 80. This trip's rate table has no rate for
> them, so they are shown as they were paid rather than folded into a number
> that would look right and be wrong. **Add the missing rates to the trip's
> trip.md.**

Nobody can do that. `PATCH /api/v1/<user>/trips/<trip>` answers
`method_not_allowed`: "This route takes DELETE and nothing else." `rates` is
one of the fields agent.md says can only be set at creation, because nothing
edits a `trip.md` afterwards (B207). On a hosted instance the owner has no
shell, so the remedy named is available to nobody at all.

Observed 2026-09-04 on fernscout.ch: `balkans-2026`, created without `rates`,
four costs in EUR, base currency CHF.

The behaviour it is explaining is right — refusing to invent a rate is the
correct call. It is the instruction that goes nowhere.

## Work

Two ways, and the first is the real fix:

1. Let `rates` be written after creation. The costs endpoint at
   `/trips/<trip>/costs` already takes PUT/PATCH and is one level down from the
   file; a trip's rate table is the same kind of thing as its budget.
2. Failing that, stop naming `trip.md` to somebody who cannot open it, and say
   what they can actually do.

See B207 for the broader four-fields version of this.

## Acceptance

A trip created without `rates`, with costs in a foreign currency, has some door
through which the owner can supply the rate — or the page stops telling them to
edit a file they cannot reach.
