---
id: B542
title: A cost is written in the journal's base currency wherever the day does not say otherwise, whatever country it was spent in
type: FEATURE
priority: medium
complexity: medium
area: costs, currency
found: "2026-09-06T08:48:39Z"
---

# B542 — A cost is written in the journal's base currency wherever the day does not say otherwise, whatever country it was spent in

## Why

`parseCostItems` (`lib/costFormat.ts:212`) defaults a cost line's currency to
the journal's `baseCurrency`, and `POST .../days` stores whatever arrives. So a
noodle soup in Chiang Mai written as `{ "label": "…", "amount": 120 }` is
recorded as **CHF 120**, not THB 120, and nothing anywhere says so — the day
page and the costs page both print a figure that is right in shape and wrong by
a factor of thirty.

The remedy today is that every cost line repeats `currency: THB`. An agent
writing a day has to know the country's currency and remember the field on
every line; miss one and the error is silent and permanent.

A trip-level `currency:` was the obvious fix and is the wrong one: a Balkans or
a South-East Asia trip crosses four of them, and a trip-level default would be
wrong on most of the days it covered. It would also have to be a *read-time*
default, which is the hazard `lib/api/openapi.ts:1947` already writes down for
`baseCurrency` — setting it on an existing trip re-reads every bare amount ever
recorded on it.

The day already knows where it was. `lib/entries.ts:218` derives
`countryCode` from the day's `country:`, and `reverseGeocode(lat, lng)`
(`lib/ingest/geo.ts:174`) answers from a packed GeoNames index committed in the
repository — offline, no key, no dependency. What is missing is one table:
ISO 3166-1 alpha-2 → ISO 4217.

## Work

**A generated table.** `lib/countryCurrency.ts`, written by
`scripts/build-country-currency.mjs` from the GeoNames `countryInfo` currency
column, exactly as `scripts/build-country-codes.mjs` writes
`lib/countryCodes.ts`. Committed output, no download at build, no runtime
dependency. It ships in this task rather than its own because a generated
module nothing imports fails `npm run unused`.

**Resolution, at write time only.** For a cost line arriving without a
`currency`, in order:

1. the day's `countryCode`;
2. failing that, `reverseGeocode(lat, lng)` → country → currency;
3. failing both, the journal's `baseCurrency` — today's behaviour, unchanged.

The resolved code is **stamped onto the cost line as it is written**, so what
is on disk always says what was spent, and correcting a day's `country:` next
month never silently re-reads money recorded before it. Report what was applied
in the `POST`/`PATCH` response so the writing agent can see it.

**Not doing:** a trip-level `currency:` field, for the reasons above. Not
touching `parseCostItems`' read-time default either — a day written before this
lands means exactly what it meant.

One currency per country, which is what the source carries. The eurozone
collapses correctly; Panama and Ecuador give USD, which is right; a country
running two in parallel gets one. That is tolerable only because it is a
default a writer overrides per line and never a conversion: a wrong default is
a visibly wrong label on the day page, not a number folded into a total.

Expect it to produce currencies the ECB does not publish (VND, LAK, RSD, BAM).
Those stay unrated and `UnconvertedNotice` says so — which is the honest
outcome, and better than the mislabelling this replaces. See B543.

## Acceptance

- A day with `country: Thailand` and a cost of `{amount: 120}` and no currency
  reads back as `120 THB` in `entries/*.md`.
- The same day with no `country:` but `lat`/`lng` in Chiang Mai does too.
- A day with neither still reads back in the journal's base currency.
- A cost line that names its own currency is untouched.
- `npm run verify` and `npm run unused` pass.
