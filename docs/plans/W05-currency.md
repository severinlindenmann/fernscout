# W05 — Multi-currency + ECB rates

**Roadmap:** A4, A4b, decisions 7 & 21 · **Depends on:** W02 · **Wave D**

## Goal
Costs are recorded in the currency actually spent, converted through the trip's
own historical rates, and displayed in whichever currency the reader picks.

## Scope

### Three layers
1. **Store original.** `cost: 450 THB` stays `450 THB` forever. Never
   lossy-convert at write time.
2. **Per-trip rate table.** Each trip folder carries its own rates
   (`content/trips/<id>/rates.json` or a `rates:` block in `trip.md`), so the
   same country in a different year converts differently. Local → `baseCurrency`.
   *Built as a `rates:` block in `trip.md`* — a trip stays one metadata file,
   and rates are trip metadata in the way `start` and `accent` are.
3. **Reader display currency.** A `CurrencyProvider` mirroring `LocaleProvider`:
   persisted choice, list from `config.site.displayCurrencies`.

### The second hop
`base → reader's currency` needs a *current* rate. Fetch **ECB reference rates**
at build time (free, official, no API key, ~30 currencies), cache into the
content folder so builds work offline. Manual override in config for anything
ECB doesn't cover. Label converted values `≈`.

### Touches
`lib/costs.ts` (aggregation must group by original currency then convert),
`lib/costFormat.ts` (locale-aware formatting), the charts in `components/charts/`.

## Acceptance
- [x] An entry with `450 THB` and a trip rate renders the right CHF value
- [x] Two trips with different rates for the same currency both convert correctly
- [x] Reader switches to EUR; every cost, chart axis and total updates
- [x] Build succeeds with no network (cached rates)
- [x] Budget vs actual still correct with mixed-currency entries
- [x] Unit tests over aggregation with three currencies in one trip

Plus, beyond the original list: a missing rate is reported on the page and
excluded from every total rather than counted at face value, and a budget in an
unrateable currency draws no comparison at all. `test/currency.test.ts` covers
all of it.
