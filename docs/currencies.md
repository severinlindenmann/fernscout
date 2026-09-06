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
Bank reference rates**, cached at `site/rates/ecb.json`:

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

### Two tables called "rates", pointing opposite ways

Layer 2 and layer 3 both keep a `{ CODE: number }` map, both are called rates,
and **their conventions are inverses of each other.** Getting them the wrong
way round produces a page of numbers that are wrong by orders of magnitude,
with no error anywhere — every value converts, and every total is nonsense.

| | Where | The number means | Example |
| --- | --- | --- | --- |
| a trip's `rates:` | `trip.md` frontmatter | units of the **base currency** per **1 unit of the keyed currency** | `THB: 0.0245` — 1 THB = 0.0245 CHF |
| the ECB table | `site/rates/ecb.json`, and `site.manualRates` | units of the **keyed currency** per **1 EUR** | `CHF: 0.9364` — 1 EUR = 0.9364 CHF |

The rule of thumb: a trip rate for a currency worth less than your base
currency is a **small** number, because one unit of it buys very little.
`THB: 0.0245` is right; `THB: 40.8` is the ECB's direction, written into the
wrong file. `lib/currency.ts` states both conventions on `RateTable`, and it
is the only place in the code that does.

### Where a trip's number comes from

Since B543, one route produces it without anybody inventing anything: for
each currency the trip's costs use that `rates:` does not cover, `POST
.../days` and `PATCH .../days/<slug>` quietly ask `fillTripRates`
(`lib/api/tripRates.ts`) for a *measurement* — the ECB's own 90-day history,
cross-divided into the trip convention, frozen at the date the currency first
appears on (the nearest earlier publication day when the ECB did not publish
on that exact date). `npm run rates:fill` is the same lookup run as a sweep,
for a currency the archive's window has since moved past. Neither ever
touches a rate already in `trip.md`, hand-typed or filled — a currency stays
unrated rather than being guessed once one of those refuses: the capability
is off, the date is outside the 90-day window, or the ECB does not publish
that currency at all. What was used is written back as `ratesFrom:`, beside
`rates:`, and shown as a footnote on the costs page.

A currency older than 90 days, or one the ECB never publishes, still has to be
typed by hand — and what the author wants is **a rate from around the middle
of the trip, from the source they actually paid at**. In order of how
defensible it is a year later:

1. What the money actually cost: a card statement or a withdrawal receipt —
   the amount debited in your base currency divided by the amount you got.
   This is the only number that includes the spread you really paid.
2. The ECB reference rate for a date in the middle of the trip, from
   [the ECB's own history](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip),
   cross-divided if your base currency is not the euro:
   `base per 1 XYZ = (base per EUR) ÷ (XYZ per EUR)`.
3. Any rate you can write down where it came from.

Round to enough digits that the conversion survives: `VND: 0.000034` needs its
leading zeros. Then leave it alone — a trip's table is frozen on purpose, and
correcting it later restates what the trip cost.

A cost in a currency the trip has no rate for is a supported state, not an
error, so nothing fails the build over it. `test/example-content.test.ts`
asserts that the demo journal has none, which is what keeps the demo coherent;
your own content is checked by the page itself, which names what it left out.

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
