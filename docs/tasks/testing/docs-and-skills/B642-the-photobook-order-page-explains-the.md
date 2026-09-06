---
id: B642
title: The photobook order page explains the spine, the soft prints and the extras badly
type: DOCS
priority: medium
complexity: low
area: photobook, order page
found: "2026-09-06T17:51:57Z"
started: "2026-09-06T18:39:46Z"
merged: "2026-09-06T18:53:26Z"
---

# B642 — The photobook order page explains the spine, the soft prints and the extras badly

## Why

Three things the photobook order page says, or fails to say, to somebody who
has not read the code.

**The spine is a surprise.** A printed book carries the trip's title on its
spine, and the page never mentions it. The first time an owner learns what is
printed down the edge of their book is when it arrives.

**The warnings are written from the inside.** `photobook.warn.heading` is "Gut
zu wissen, bevor du bestellst" and `photobook.warn.lowResolution`
(`site/locales/de.json:749`) is "9 Fotos werden in dieser Grösse weich gedruckt
— sie haben weniger Pixel, als die Seite braucht." That is accurate and it is
not usable: it does not say which nine, whether that is bad, or what the person
could do about it.

**The extras are off when they would be welcome.** `includeCharts` is off by
default (`lib/photobook/options.ts:69`), and its comment argues the case well —
a book of photographs should not grow chart pages unasked. But when the trip
actually recorded a budget and weather, the owner has usually gone to the
trouble for a reason, and the switch stays off unnoticed.

## Work

- Say on the order page that the spine carries the trip's title, and show the
  title being used.
- Rewrite the warnings for a reader: what will happen to the photograph, how
  much it matters, and what they can do — replace it, drop it, or accept a
  softer print. Point at which photographs, not just how many.
- Default `includeCharts` on when the trip has both costs and `weatherData`,
  and off otherwise. Same for `includeCosts` where a budget exists. Still a
  switch; only the default moves. Update the comment at
  `lib/photobook/options.ts:58` — it is the argument for the old default and
  would otherwise contradict the code.
- Every string in every locale the instance ships.

## Acceptance

- The order page names the spine and the text going on it.
- The low-resolution warning names the affected photographs and says what to
  do.
- A trip with a budget and weather opens the order page with the chart and cost
  pages already on; a trip with neither opens with them off.

## Findings (built)

**The spine is real.** `coverFor` in `lib/photobook/plan.ts` prints
`` `${trip.title} · ${trip.start.slice(0, 4)}` `` down the spine
(`render.ts:837`), but only when the spine is at least 6 mm wide
(`render.ts:834`) — a very thin book gets no spine text at all, which this
change does not special-case; the order page always says what *would* print
there. Pulled the format into an exported `spineTextFor()` so the order page
shows the exact string rather than a second copy, and both photobook pages
(`(trip)/photobook/page.tsx` and `trips/[trip]/photobook/page.tsx`) now pass
it down to `BookLevelView`, which prints it in the order block.

**The low-resolution warning now names names.** `BookWarning` gained an
optional `photos?: string[]` field (`plan.ts`); `checkResolution` fills it
with the one photograph each warning is about. `BookLevelView` aggregates
that across every `low-resolution` warning into a `{photos}` variable (first
three, named, then "…"), and the German/English/Hungarian strings were
rewritten to say what happens (still shows, just softer), how much it
matters (mild), and what to do (smaller format / bigger photograph / accept
it). `noOriginal` was left alone — out of scope, and its `detail` already
lists filenames for a developer, not a reader.

**Where the includeCharts/includeCosts default now lives, and why not in
`DEFAULT_OPTIONS`.** `DEFAULT_OPTIONS` is a plain constant used in three
places that have no trip to look at: `planBook`'s own default parameter and
the tests that call it directly. It cannot become trip-aware without lying
to those callers. The actual "first thing an owner sees" is
`usePersistedState`'s `initial` argument in `PhotobookPageContent.tsx`, and
that hook only ever *reads* `initial` when nothing is in `localStorage` yet
— a saved arrangement always wins via its own `restore()` merge. So the new
`initialBookOptions(locale, hasCosts, hasWeather)` (`lib/photobook/options.ts`)
is called only there, computing `includeCosts: hasCosts` and
`includeCharts: hasCosts && hasWeather` from two booleans the server now
passes down (`hasCostsData()` and `hasWeather(weatherDays(days))`, both read
with `AS_AUTHOR` like everything else on the page). `DEFAULT_OPTIONS` itself
is unchanged. Test: `test/photobook-options.test.ts`, `describe("initialBookOptions")`.

`npm run verify`: all four stages passed (build, tsc, eslint — pre-existing
warnings only, vitest 3921 passed/3 skipped).
