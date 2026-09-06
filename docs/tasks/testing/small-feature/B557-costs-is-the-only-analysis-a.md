---
id: B557
title: Costs is the only analysis a trip can show, and the nav calls it Kosten
type: FEATURE
priority: medium
complexity: medium
area: Trip pages, navigation
found: "2026-09-06T09:31:27Z"
started: "2026-09-06T09:32:01Z"
merged: "2026-09-06T09:53:20Z"
---

# B557 — Costs is the only analysis a trip can show, and the nav calls it Kosten

## Why

`components/SiteNav.tsx:15` gives a trip four flat tabs, and the fourth is
`/costs`. It is the only place a trip is *summed up* rather than read, and the
nav names it after the one thing it happens to sum — so the day B325 put a
measured temperature on every day, there was nowhere for that to be added up.
`weather:` has been on days since B325 and is drawn one day at a time in
`components/DayWeather.tsx`; a trip of forty days carries forty readings and
shows no trip-level view of any of it.

Renaming the tab is the cheap half. The half that matters is that a fourth tab
called Costs can only ever hold costs, and a hub can hold the next one — the
distance analysis, the per-country days — without a fifth, sixth and seventh
tab appearing in a nav that is four wide on a phone.

## Work

- `nav.costs` → `nav.analytics` in every `site/locales/*.json`, and the
  `SiteNav` link points at `/analytics`.
- `app/[user]/(trip)/analytics/page.tsx` and the `trips/[trip]/` twin: a hub
  listing one card per analysis, each card showing a headline figure from the
  data it summarises so the hub is not a menu of links. A card appears only
  when its capability is on **and** the trip carries the data.
- `/costs` keeps its URL and its page unchanged — the hub links to it. No
  redirect, nothing that breaks a bookmark or a photobook's printed reference.
- `app/[user]/(trip)/weather/page.tsx` and its twin: days that carry `weather:`,
  aggregated — days per condition group, the warmest and coldest day, total
  precipitation, the range. Credited to the source the readings name, using
  `SOURCE_CREDIT` in `lib/weather.ts`; a trip mixing a hand-supplied reading
  with the archive's must credit both.
- Days without a reading are stated as such rather than averaged over silently.
- Aggregation in `lib/weatherStats.ts`, pure, no fs — the same discipline as
  `lib/weather.ts`, so a test can drive it without a content tree.
- The gate: `features.costs` already hides `/costs`. A journal with costs off
  and weather days still gets the hub, holding the weather card alone. A trip
  with neither analysis available gets no tab, as `/costs` does today.

**Not doing:** the distance, countries and rhythm analyses — separate captures.
No shared chart component; two pages do not justify one.

## Acceptance

- `/<user>/analytics` and `/<user>/trips/<trip>/analytics` render the hub, and
  the nav's fourth tab reaches it.
- `/<user>/costs` still renders exactly what it renders today.
- `/<user>/weather` sums a trip whose days carry `weather:`, names the source,
  and says how many days have no reading.
- A journal with `features.costs` off and no weather readings shows no fourth
  tab at all.
- `npm run verify` passes, and a test drives `lib/weatherStats.ts` over days
  with mixed sources and missing readings.
