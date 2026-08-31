# Money

How a cost written in one currency becomes a number a reader in another
country can read — and what happens when it cannot.

Lifted out of the README, which was carrying it at length among a dozen other
things.

## Currencies

Three layers, and they do not overlap.

**1. The original is stored.** A cost written as `450 THB` stays `450 THB` for
ever. Nothing converts at write time, so nothing is lost when a rate is later
corrected.

**2. Each trip carries its own historical rates**, in the `rates:` block of its
`trip.md`:

```yaml
# content/<username>/trips/<id>/trip.md
rates:
  THB: 0.0245     # 1 THB = 0.0245 CHF, on this trip
  VND: 0.000034
```

The value is *how much one unit was worth in `site.baseCurrency`*. They live in
`trip.md` rather than a separate `rates.json` so a trip stays one metadata
file, and they live **per trip** because that is the whole point: a 2029 trip
to the same country carries its own table and cannot restate what 2026 cost.
A cost with no `currency:` is read as the base currency, so entries written
before any of this existed read exactly as they did.

**3. The reader picks a display currency** from `site.displayCurrencies`,
through the chip in the header. The choice persists in `localStorage`, and
every total, table row and chart axis follows it. Converted values are labelled
`≈`, because a second hop through a current rate is an approximation and saying
so is cheaper than being asked.

That second hop — base currency → the reader's — uses the **European Central
Bank reference rates**, cached at `content/rates/ecb.json`:

```
npm run rates:update      # fetches, writes the cache, commit the result
```

Free, official, no API key, around 30 currencies. **The build never fetches
anything**: it reads the committed cache off disk and succeeds with no network
at all. Anything the ECB does not publish gets a rate in `config.json` under
`site.manualRates`, in the ECB's own convention (units per one euro):

```jsonc
"manualRates": { "VND": 30000 }   // 1 EUR = 30 000 VND
```

A display currency with no rate from either source is dropped from the switcher
rather than offered and then quietly wrong.

### When a rate is missing

Costs in a currency the trip has no rate for are **left out of every total** and
named on the page: "Not counted in these totals: THB 450." They still appear in
the itemised table, in the currency they were paid in, marked *no rate*. A
budget in an unrateable currency draws no budget panel at all.

This is deliberate. The tempting alternative — treating an unknown rate as 1 —
adds 450 baht to a pile of francs and produces a total that looks entirely
reasonable and is wrong by a factor of forty. A missing number can be noticed;
a plausible wrong one cannot.

## Budget

`content/<username>/trips/<id>/costs.md` takes a `budget:` block alongside its `costs:`:

```yaml
budget:
  total: 32000     # whole trip, both of us, everything in
  days: 165        # how long it was drawn up for
  currency: CHF    # optional; without it, the site's baseCurrency
```

`/costs` then shows spend against it: how far off plan the trip is *at this
point* (preparation counts as spent up front, so the daily allowance is what's
left divided by the planned days), what the total lands at if the current rate
holds, and a dashed planned-spend line on the running-total chart. Drop the
block and the whole panel disappears.
