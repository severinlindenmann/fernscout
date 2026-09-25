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

**2. Each trip carries its own currencies and rate overrides**, in the `rates`
section of its `trip.json`:

```jsonc
// content/<username>/trips/<id>/trip.json
"rates": {
  "currencies": ["THB", "VND"],
  "manual": { "VND": 30500 }   // 1 EUR = 30 500 VND
}
```

`currencies` names which foreign currencies the trip's costs may use; `manual`
supplies a rate for one the server's own ECB table does not carry, or
overrides one it does. **Since B1606 `manual`'s convention changed**: it is
units of the keyed currency per **1 EUR** — the ECB table's own direction —
which is the opposite of the old (pre-B1606) `rates:` block's "units of the
base currency per one unit of the keyed currency". `lib/trips.ts`'s
`resolveTripRates` is what merges `manual` with the cached ECB history and
cross-divides the result back into the base-currency-per-unit table the rest
of the site computes with (see below).

They live in `trip.json` rather than a separate file so a trip stays one
document, and they live **per trip** because that is the whole point: a 2029
trip to the same country carries its own table and cannot restate what 2026
cost. A cost with no `currency` is read as the base currency, so entries
written before any of this existed read exactly as they did.

**3. The reader picks a display currency** from `site.displayCurrencies`,
through the chip in the header. The choice persists in `localStorage`, and
every total, table row and chart axis follows it. Converted values are labelled
`≈`, because a second hop through a current rate is an approximation and saying
so is cheaper than being asked.

That second hop — base currency → the reader's — uses the **European Central
Bank reference rates**, cached at `<DATA_DIR>/rates/ecb.json`:

```
npm run rates:update      # fetches and writes this instance's cache
npm run rates:update -- --dry-run
```

**The cache is not in git** (B1084). It is a measurement with a date on it, so
it lives beside the other instance state under `DATA_DIR`, where a rebuild
cannot delete it and a deploy need not carry it. A deployed instance refreshes
it every night, off the back of the backup timer (`scripts/backup.sh` step 0),
so the number moves without anybody deploying — which it did not, before: the
live instance was serving a twelve-day-old table when this was measured.

Two consequences worth knowing. **It does nothing when `costs` is off** — an
instance that does not do money has nothing to convert, so it neither fetches
nor keeps a table. And **a fresh clone has no rates at all** until something
refreshes them, which is a supported state: `lib/rates.ts` offers the base
currency only, rather than a wrong number. An instance that still has the old
committed copy, or a pre-B510 one under `CONTENT_DIR`, keeps reading it until
its first refresh.

Free, official, no API key, around 30 currencies. **The build never fetches
anything**: it reads the committed cache off disk and succeeds with no network
at all. Anything the ECB does not publish gets a rate in `config.json` under
`site.manualRates`, in the ECB's own convention (units per one euro):

```jsonc
"manualRates": { "VND": 30000 }   // 1 EUR = 30 000 VND
```

A display currency with no rate from either source is dropped from the switcher
rather than offered and then quietly wrong.

### Two tables, and — since B1606 — one convention

Layer 2 and layer 3 both keep a `{ CODE: number }` map, and since B1606 both
are stored the same way round: units of the **keyed currency** per **1 EUR**.

| | Where | The number means | Example |
| --- | --- | --- | --- |
| a trip's `rates.manual` | `trip.json` | units of the **keyed currency** per **1 EUR** | `VND: 30500` — 1 EUR = 30 500 VND |
| the ECB table | `<DATA_DIR>/rates/ecb.json`, and `site.manualRates` | units of the **keyed currency** per **1 EUR** | `CHF: 0.9364` — 1 EUR = 0.9364 CHF |

Before B1606 these pointed opposite ways — a trip's own `rates:` block stored
units of the *base* currency per one unit of the keyed currency, the ECB
table's inverse — and getting that wrong produced a page of numbers wrong by
orders of magnitude with no error anywhere. A `trip.json` migrated from the
old shape needs its `manual` numbers re-derived, not copied straight across.

What the site actually multiplies a cost by is a **third**, *derived* table:
`resolveTripRates` (`lib/trips.ts`) merges the ECB history with `manual`,
still in the EUR convention, then cross-divides the result into *units of the
base currency per one unit of the keyed currency* — `lib/currency.ts`'s
`RateTable`, unchanged by B1606 and stated on the type itself. That derived
table, not the stored `manual` block, is what every reading page uses.

### Where a trip's number comes from

Since B543, `fillTripRates` (`lib/api/tripRates.ts`) can produce it without
anybody inventing anything: for each currency the trip's costs use that
`rates.manual` does not cover, it asks the ECB's own 90-day history for a
*measurement*, cross-divided into the ECB's own units-per-EUR convention
before it is written into `manual`, frozen at the date the currency first
appears on (the nearest earlier publication day when the ECB did not publish
on that exact date). `npm run rates:fill` runs the same lookup as a sweep, for
a currency the archive's window has since moved past; the `/agent` helper's
own rates tool (`app/api/helper/<user>/trip/rates/route.ts`) calls it too.
Neither ever touches a rate already in `manual`, hand-typed or filled — a
currency stays unrated rather than being guessed once the lookup refuses: the
capability is off, the date is outside the 90-day window, or the ECB does not
publish that currency at all. **v2 has no home for a per-rate citation** —
`ratesFrom:` was retired with the rest of v1's shape — so `lib/trips.ts`'s
reader synthesises an equivalent label instead, from whether a code is in
`manual` at all ("the trip's own rate") or came from the ECB's daily table
("European Central Bank, <date>").

A currency older than 90 days, or one the ECB never publishes, still has to be
typed by hand into `rates.manual` — **in the EUR convention**, units of the
keyed currency per 1 EUR, not the base-currency figure a statement hands you
directly. What the author wants is **a rate from around the middle of the
trip, from the source they actually paid at**. In order of how defensible it
is a year later:

1. What the money actually cost: a card statement or a withdrawal receipt —
   the amount debited in your base currency divided by the amount you got is
   the *base*-per-unit figure, the only one that includes the spread you
   really paid; still convert it to `manual`'s EUR convention before writing
   it (divide the ECB's own base-per-EUR figure for that date by this
   number).
2. The ECB reference rate for a date in the middle of the trip, from
   [the ECB's own history](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip)
   — already in `manual`'s own convention, so no cross-division is needed
   when your base currency is the euro.
3. Any rate you can write down where it came from, converted the same way.

Round to enough digits that the conversion survives. Then leave it alone — a
trip's table is frozen on purpose, and correcting it later restates what the
trip cost.

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

The trip document's `costs` section (`content/<username>/trips/<id>/trip.json`,
written with `PATCH /api/v2/<user>/trips/<trip>`) takes a `budget` object
alongside its `items` and `note`:

```jsonc
"costs": {
  "budget": {
    "total": 32000,     // whole trip, both of us, everything in
    "days": 165,        // how long it was drawn up for
    "currency": "CHF"   // optional; without it, the site's baseCurrency
  }
}
```

`/costs` then shows spend against it: how far off plan the trip is *at this
point* (preparation counts as spent up front, so the daily allowance is what's
left divided by the planned days), what the total lands at if the current rate
holds, and a dashed planned-spend line on the running-total chart. Drop the
block and the whole panel disappears.
