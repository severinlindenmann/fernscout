---
id: B543
title: A trip's local-to-base rates are typed by hand or the spend is not counted at all
type: FEATURE
priority: medium
complexity: medium
area: costs, currency
found: "2026-09-06T08:48:44Z"
started: "2026-09-06T08:50:58Z"
merged: "2026-09-06T09:12:06Z"
completed: "2026-09-07T13:11:48Z"
---


# B543 — A trip's local-to-base rates are typed by hand or the spend is not counted at all

## Why

Layer two of `lib/currency.ts` — local currency to the journal's base — runs on
the trip's own frozen `rates:` block in `trip.md`. Nothing produces those
numbers. They are typed by hand from a card statement or a cross-divided ECB
rate, and until they are, every cost in that currency is excluded from every
total: `base: undefined`, reported by `UnconvertedNotice`, deliberately not
guessed (`lib/costFormat.ts:44`).

Refusing to invent a rate is right and stays. What is missing is the one route
by which a rate arrives without anybody inventing anything — a *measurement*,
the same argument B325 made for weather, and the same shape: the day asks, the
server looks it up from a public archive, and the reading is credited.

B542 makes this urgent rather than merely tidy. Once a cost's currency is
derived from where the day was, trips acquire currencies nobody typed a rate
for, and an unrated currency is spend that vanishes from the totals.

B352 built the writer this needs: `PATCH /api/v1/<u>/trips/<t>/rates` merges
into the existing table through `patchTripRates` (`lib/api/tripRates.ts`),
validating in the trip convention.

## Work

`fillTripRates(ref)` in `lib/api/tripRates.ts`, in the shape of
`fillDayWeather` (`lib/api/weather.ts`) — one function, two callers, so a rate
that arrived one way is the same rate that would have arrived the other:

- called quietly after `POST .../days` and `PATCH .../days/<slug>`;
- called in a sweep by a new `npm run rates:fill`.

For **each distinct currency in the trip's costs that `rates:` does not
cover**, one rate, frozen once, at the date of the first day that currency
appears on. Not the trip's first day: a Balkans trip freezes RSD, BAM and EUR
each at its own date. Intra-trip drift is accepted, which is what layer two
already assumes.

Source is the ECB's own 90-day history (`eurofxref-hist-90d.xml`, free, no
key), cross-divided into the **trip** convention — units of base per one unit
of the keyed currency, `THB: 0.0245`, the direction `docs/currencies.md` warns
about. The ECB does not publish at weekends, so use the nearest preceding
publication day and record which one it was.

Provenance: a `ratesFrom:` line naming the archive and the date used, rendered
as a footnote on the costs page. A number on a costs page has to be able to say
where it came from.

**Refusals, before any request, in this order** — the weather ticket's edges:
the `costs` capability is off; the currency already has a rate (never
overwritten, hand-typed or filled); the date is outside the 90-day window; the
ECB does not publish that currency. Each leaves the currency unrated for a
person to supply, which is a supported state, and none of them fails the write
of the day itself.

**Not doing:** touching a rate already in `trip.md`, on any path. Not fetching
at render or build time — the build must still work with no network
(`lib/rates.ts`). Not keeping our own per-day archive of `ecb.json`: the ECB's
history file is that archive, and the frozen dated rate in `trip.md` is the
version that matters.

Supersedes B216, which asked for a command that prints a rate to paste and
forbade writing `trip.md`. The distinction that makes writing right here is
that a currency present in the costs and absent from `rates:` is a *request*,
the way `weather: true` is; close B216 with `superseded: B543` if this lands.

## Acceptance

- A trip with costs in an unrated ECB currency gains one rate per currency,
  in the trip convention, after `npm run rates:fill`.
- The rate matches the ECB's published rate for the first day that currency
  appears, or the nearest preceding publication day, and the file says which.
- Re-running changes nothing.
- A hand-typed rate is never overwritten.
- A currency the ECB does not publish is left alone and reported, not guessed.
- `npm run verify` passes with no network reachable.
