"use client";

import CurrencyProvider from "@/components/CurrencyProvider";
import { DayCard } from "@/components/StoryPager";
import type { Day, DaySummary, Entry } from "@/lib/types";

/**
 * A day card in the states that are hard to reach on a real site.
 *
 * Most of what this component can draw is invisible to anybody who does not
 * own a journal and has not written the day: a **draft** is filtered out of
 * every reading path, a **half-published** day needs two updates written and
 * one of them left alone, and a day marked **test** has to be deliberately
 * invented. Those are exactly the states whose banners and borders nobody
 * looks at twice, and the ones that would go wrong quietly.
 *
 * The rest is shape: one update against several, photographs against none,
 * weather and spend present against absent — the combinations that decide
 * whether the header's quiet line renders at all and whether the timeline
 * rail is drawn.
 *
 * Everything here is a fixture. There is no journal above this page, so the
 * providers `DayCard` reaches for are supplied with plain objects: currency is
 * seeded with two real rates so the `≈` path is exercised, and reactions have
 * no provider at all — `DayReactions` returns null without one, which is the
 * behaviour the story page relies on outside a trip anyway.
 */

/** Rates are here to exercise the conversion, not to be right about money. */
const CURRENCY = {
  base: "CHF",
  currencies: ["CHF", "EUR", "USD"],
  rates: { CHF: 1, EUR: 1.07, USD: 1.13 },
  asOf: "2026-01-02",
};

const PROSE = `The pass was shut and nobody had said so, which is how we came to
spend four hours on a road that ends in a barrier.

By the time it opened the light had gone, so this is a day with very little to
show for itself and one photograph of a barrier.`;

function entry(over: Partial<Entry>): Entry {
  return {
    slug: "fixture",
    title: "A day on the fixture road",
    date: "2026-05-04",
    location: "Somewhere",
    country: "Nowhere",
    countryCode: "CH",
    lat: 46.8,
    lng: 8.2,
    gallery: [],
    tags: [],
    costs: [],
    content: PROSE,
    ...over,
  };
}

function day(entries: Entry[]): Day {
  return { date: entries[0].date, entries, lead: entries[0] };
}

function summary(over: Partial<DaySummary> = {}): DaySummary {
  return {
    date: "2026-05-04",
    slug: "fixture",
    location: "Somewhere",
    country: "Nowhere",
    countryCode: "CH",
    lat: 46.8,
    lng: 8.2,
    updates: 1,
    cost: 0,
    ...over,
  };
}

const WEATHER = {
  tempMin: 4.2,
  tempMax: 11.8,
  code: 61,
  precipitation: 7,
  windMax: 22,
  source: "open-meteo",
  recordedAt: "2026-05-05T06:00:00.000Z",
};

/** Each case says what it is *for*, because that is the part a screenshot of
 * the card cannot tell you. */
const CASES: { id: string; title: string; why: string; day: Day; summary: DaySummary }[] = [
  {
    id: "plain",
    title: "One update, nothing else",
    why: "The floor. No weather, no spend, no photographs, one update — so the header's second line should not render at all and there should be no rail.",
    day: day([entry({})]),
    summary: summary(),
  },
  {
    id: "furnished",
    title: "Weather and spend, paid in another currency",
    why: "The header's quiet line, fully loaded. What was paid leads and the conversion trails it smaller — B544. Drag the day's cost through the currency switcher on a real site to see the other half of this.",
    day: day([entry({ weather: WEATHER })]),
    summary: summary({ cost: 118, costLocal: { amount: 126, currency: "EUR" } }),
  },
  {
    id: "multi",
    title: "Three updates",
    why: "The timeline. Each stop draws the segment down to the next, so the rail must end at the last dot rather than trailing past it — and the times are what say these are three moments and not three days.",
    day: day([
      entry({ slug: "a", time: "08:15", title: "Before the barrier" }),
      entry({ slug: "b", time: "13:40", title: "Still at the barrier" }),
      entry({ slug: "c", time: "21:05", title: "Through, in the dark" }),
    ]),
    summary: summary({ updates: 3, cost: 64 }),
  },
  {
    id: "draft",
    title: "Wholly a draft",
    why: "Every reading path filters this out, so a person only ever sees it as the owner of the journal. Coral border and the notice.",
    day: day([entry({ draft: true })]),
    summary: summary(),
  },
  {
    id: "half",
    title: "Half published",
    why: "One update live, one still a draft — what an agent leaves behind when it writes a second update and nobody has published it yet. The per-update badge, not the whole-day banner.",
    day: day([
      entry({ slug: "a", time: "09:00", title: "The published half" }),
      entry({ slug: "b", time: "18:30", title: "The half nobody has published", draft: true }),
    ]),
    summary: summary({ updates: 2 }),
  },
  {
    id: "test",
    title: "Marked as test",
    why: "`test: true` — content nobody lived, written to prove the pipeline works. The banner is the guarantee that replaces an agent writing “this is invented” into the prose.",
    day: day([entry({ test: true })]),
    summary: summary(),
  },
];

export default function DayBench() {
  return (
    <CurrencyProvider options={CURRENCY}>
      <div className="mx-auto max-w-3xl space-y-12 px-4 py-10 sm:px-6">
        <header>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900">
            Day card
          </h1>
          <p className="mt-3 text-navy-700">
            The card the story page draws, in the states a reader of a real site cannot
            reach. A draft is filtered out of every reading path; a half-published day
            needs two updates with one left alone; a test day has to be deliberately
            invented. Those are the ones whose banners nobody looks at twice.
          </p>
          <p className="mt-2 text-sm text-navy-600">
            Everything below is a fixture. Nothing here is a record of anything, and the
            currency rates are here to exercise the conversion rather than to be right
            about money.
          </p>
          <p className="mt-4 text-xs text-navy-500">
            The reader&apos;s currency switcher lives in a journal&apos;s own header and is
            not here; the base is CHF. The <span aria-hidden>≈</span> path is still
            exercised, because the second card was paid in euros and therefore shows both
            figures whatever the reader has chosen.
          </p>
        </header>

        {CASES.map((c, i) => (
          <section key={c.id}>
            <h2 className="font-display text-lg font-semibold text-navy-900">{c.title}</h2>
            <p className="mt-1 mb-4 text-sm text-navy-600">{c.why}</p>
            <DayCard day={c.day} summary={c.summary} dayIndex={i} />
          </section>
        ))}
      </div>
    </CurrencyProvider>
  );
}
