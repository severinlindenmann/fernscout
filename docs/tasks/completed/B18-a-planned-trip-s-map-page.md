---
id: B18
title: A planned trip's map page draws no map
type: ISSUE
priority: high
complexity: low
area: map, plan
found: "2026-09-01"
started: "2026-09-01"
merged: "2026-09-01"
completed: "2026-09-04T05:32:26Z"
---

# B18 — A planned trip's map page draws no map

## Why

`/example/trips/japan-2027/map` renders "Noch keine Einträge." where the map
should be, and then, directly underneath, a legend for a route it did not
draw:

```
Geplante Route — gestrichelt — wohin wir noch wollen
0/8 der geplanten Route
```

The page has the data. `content/example/trips/japan-2027/plan.md` holds eight
stops with coordinates, from Fukuoka to Sapporo, and the route page passes
them in: `plan={plan.stops}` (`app/[user]/trips/[trip]/map/page.tsx:56`).

The map is then withheld by one condition —
`app/[user]/(trip)/map/MapPageContent.tsx:68`:

```tsx
{places.length > 0 ? <WorldMap places={places} plan={plan} /> : <p>{t("story.empty")}</p>}
```

`places` is published entries. An upcoming trip has none, so the map is
replaced by an empty-state message that is describing the wrong thing: there
are no entries, but there is a route, and the route is what somebody opens an
upcoming trip's map to see.

`WorldMap` was written for exactly this case and is never given the chance.
`components/WorldMap.tsx:93`:

> Base frame: the visited area, padded. An upcoming trip has no places yet —
> fall back to framing the planned route instead, so it isn't a few dots

and line 99–101 does precisely that, projecting `plan` when `places` is empty.
The dashed planned run at line 193 draws from `planAhead`, which is derived
from `plan` alone.

So this is a guard that outlived its reason. It is also the first thing a
reader sees on an upcoming trip, which is the trip type most likely to be
shared before there is anything else to show.

While in there, two things on the same page read wrongly for an upcoming trip:
the four statistics all say 0 (`map.days`, `map.stops`, `map.countries`,
`map.media`), and "Jeder Halt" renders as an empty bordered box.

**Confirmed on the running site before the change.** The page answered 200 and
its markup carried no map at all — the only SVGs in it were the 24×24 lucide
icons — with `story.empty` where the map belongs. Everything the Why section
describes was still true as written.

**A third thing reads wrongly, and it is not fixed here.** The page is titled
"Wo wir waren" and subtitled "Tippe auf einen Ort, um zu sehen, wie lange wir
dort waren" — past tense, on a trip starting in 2027. That is a copy decision
across three locale files rather than a component deciding what to render, so
it is captured as B54 rather than absorbed.

## Work

1. Render `WorldMap` when there is either a place or a planned stop. The
   empty state belongs only where both are empty.
2. Make the empty state say the right thing. `story.empty` is "no entries
   yet", which is true and is not why the map is missing; for a trip with a
   plan and no entries the map itself is the answer, and for a trip with
   neither the message should say there is no route either.
3. For an upcoming trip, either suppress the zero statistics row and the empty
   "every stop" list, or replace them with the plan's own numbers — eight
   stops, one country. Decide once and apply to both map routes.
4. Both routes, or it is fixed on one URL only: `app/[user]/(trip)/map/` (the
   current trip) and `app/[user]/trips/[trip]/map/` share `MapPageContent`, so
   the fix is in the shared component — check that both still render.

### What was built, and the one decision item 3 left open

Item 3 offered two answers and asked for one. **Suppressed, not replaced with
the plan's numbers.** Days on the road, stops, countries and photographs all
count travel that has happened; a plan has an honest equivalent for none of
them. "Eight planned stops" is not "eight stops", and putting it in that row
would have said it was — the same class of mistake as the zeroes, only harder
to notice. Nothing is lost: the plan's size is already on the page twice, in
the `0/8` counter under the map and in the list of stops still to come.

The whole decision is asked once, as `hasPlaces`, and drives four things that
each used to ask `places.length > 0` for themselves: the slideshow button, the
statistics row, the map, and the every-stop list. It is deliberately a question
about what the page *has* rather than about `trip.status` — `MapPageContent`
never receives the status, and basing it on the data keeps the fix in the one
shared component, which is what item 4 asks for.

New key `map.empty` in all three locales, for the trip with neither days nor a
route. `story.empty` stays where it belongs, on the story.

**Not changed, deliberately:** `generateStaticParams` in
`app/[user]/trips/[trip]/map/page.tsx:17` still excludes upcoming trips from
the prerender list. Every trip sub-page does the same — `costs`, `gallery` and
`day` all carry the identical filter — and diverging here would be a
build-output change, not a correctness one. The page renders on demand and
answers 200, which is what `dynamicParams` is for.

## Acceptance

- `/example/trips/japan-2027/map` draws a map framing Japan with the eight
  planned stops on a dashed route.
- The legend and the `0/8` counter appear only alongside a map that shows that
  route.
- A trip with entries is unchanged — same framing, same clusters.
- A trip with neither entries nor a plan still shows an empty state, and it
  says something true.
