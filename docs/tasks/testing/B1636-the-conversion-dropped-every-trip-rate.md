---
id: B1636
title: "The conversion dropped every trip rate, and three trips cannot be expressed in v2 at all"
type: ISSUE
priority: high
complexity: medium
area: API v2
found: 2026-09-13T00:00:00Z
merged: "2026-09-13T08:01:16Z"
---

## Why

Two problems, one small and one that needs a decision.

### The small one: the conversion silently dropped the values

`content/example`'s markdown→JSON conversion kept each trip's currency
**names** and threw away its **numbers**:

| trip | `trip.md` had | `trip.json` has |
|---|---|---|
| alps-2024 | `EUR: 0.94` | `manual: {CHF: 0.94}` — fixed by hand |
| asia-2023 | `THB: 0.0258`, `VND: 0.0000372`, `EUR: 0.98` | `manual: null` |
| japan-2027 | `JPY: 0.00504` | `manual: null` |
| parks-2025 | `USD: 0.8` | `manual: null` |
| usa-2026 | `USD: 0.88` | `manual: null` |

Every value is recoverable — the markdown is in git — so nothing has to be
invented. This is exactly what the inventory-diff instrument in
`04-instruments.md` exists to catch, and it caught it only because somebody
compared by hand. **Build that instrument before the real replay.**

### The one that needs a decision: v1 and v2 anchor rates differently

- **v1** `rates[X]` = *units of the journal's base currency per 1 X*. Base-anchored.
- **v2** `rates.manual[X]` = *units of X per 1 EUR*, "same convention as the
  ECB table" (`lib/api/v2/schemas/trip.ts`). EUR-anchored.

Converting needs the trip's own EUR rate as the pivot:

```
manual[base] = v1.EUR                 manual[X] = v1.EUR / v1[X]
```

Which works for the two trips that recorded one:

```
alps-2024  manual = {CHF: 0.94}
asia-2023  manual = {CHF: 0.98, THB: 37.984496, VND: 26344.086022}
```

**And is impossible for the other three.** `japan-2027`, `parks-2025` and
`usa-2026` each recorded a non-EUR rate and no EUR rate, so there is no pivot.
Deriving one means fetching a historical EUR/CHF rate from somewhere — and a
rate nobody recorded is not this migration's to invent. *"Your confidence is
not a source."*

There is a second half to it. Those three currencies (USD, JPY) **are**
published by the ECB, so v2 could drop the manual rate and let the live table
answer. But the live table is *today's* rate and these are past trips: v1's
hand-set number pinned the rate **as it was**. Dropping it silently re-prices
a finished trip at today's rates, on a page that says what somebody spent.

## Resolved 2026-09-13 — the owner's call, and it needed no invented numbers

> *"default is CHF, and for the e.g. stuff just convert to today's rate or
> define rates for today. we only have example data."*

Taking that literally turned out to dissolve the problem. The ECB table
publishes **CHF, USD, JPY and THB** — of the five currencies `example` uses,
only **VND** is missing. And `manual` exists precisely for *"any listed
currency the ECB does not publish, and overrides for ones it does"*. So:

| trip | rates |
|---|---|
| alps-2024 | `{currencies: [EUR]}` |
| asia-2023 | `{currencies: [THB, VND, EUR], manual: {VND: 26344.09}}` |
| japan-2027 | `{currencies: [JPY]}` |
| parks-2025 | `{currencies: [USD]}` |
| usa-2026 | `{currencies: [USD]}` |

Every published currency now converts from the live ECB snapshot; the three
trips that had no EUR pivot needed one, because their currencies are
published and want no manual rate at all.

**The single manual figure invents nothing.** `26344.09` is asia-2023's own
recorded numbers re-anchored: it recorded VND at `0.0000372` CHF and EUR at
`0.98` CHF, so `0.98 / 0.0000372` is VND per EUR. Arithmetic on what the
journal already said, not a rate fetched from a belief.

The cost of the decision, stated because it is real: the published
currencies now re-price at **today's** rate rather than the rate that was
true on the trip. For demo content the owner has accepted that. **For a real
journal it would not be acceptable**, and if somebody's own trips are ever
migrated, the historical-pinning question comes back — which is the argument
for making `manual` base-anchored (option 2 below) rather than a thing only
example got away with.

## The three options as they stood — kept for the real-journal case

1. **Pivot from the ECB snapshot for the trip's dates.** Honest if the
   snapshot is a real historical reading, invention if it is today's rate
   wearing a date. Needs a source that actually holds history.
2. **Let `manual` be base-anchored**, like v1. A contract change (a D row and
   the owner's word), but it matches how somebody actually records a rate —
   "a pound was two-fifty that week" — rather than making every trip route
   through EUR.
3. **Decline rates on the three trips**, with the standard migration sentence.
   Honest, and the costs pages for those trips lose their conversions.

Not doing: picking one silently, or writing a plausible EUR rate.

## Acceptance

- `alps-2024` and `asia-2023` carry the derived values above.
- A decision recorded here for the other three, and applied.
- The inventory-diff instrument (`04-instruments.md`) exists and is run
  against the replay, so the next dropped field is caught by a machine.
