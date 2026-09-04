---
id: B15
title: The travel scene plays one fixed sequence and nothing can choose another
type: FEATURE
priority: low
complexity: medium
area: animation, api
found: "2026-09-01"
started: "2026-09-04T15:49:34Z"
merged: "2026-09-04T16:23:22Z"
---

# B15 — The travel scene plays one fixed sequence

## Why

Between two days the story pager plays `components/TravelScene.tsx`: the
travellers set off, a vehicle crosses — arcing for a flight — and the
destination rises. It ran for a constant `TRAVEL_DURATION = 6` seconds, and it
took exactly two props: `leg` and `onDone`.

Everything about how it looked was decided inside the component. The one thing
the content could influence was which of seven icons flies across, via
`VEHICLE_ICON`, keyed off the day's `transport.mode`. So a six-week rail trip
played the same six-second animation between every pair of days, forty times,
and the reader who has seen it twice was watching a loading screen.

The pieces were already separate and reusable — `Cityscape`, `Travelers`, the
`TRANSPORT_STYLE` table in `lib/transport.ts` — so this was a choice of scene,
not a rewrite.

Nothing on the write side could express a choice either. There is no MCP any
more (B298 removed `lib/mcp/` and `/api/mcp`); the one door onto a day is REST.
`POST /api/v1/<user>/trips/<trip>/days` (`app/api/v1/[user]/trips/[trip]/days/route.ts`)
and `PATCH .../days/<slug>` (`app/api/v1/[user]/trips/[trip]/days/[slug]/route.ts`,
via `spliceEntryFields` in `lib/api/entries.ts`) accepted the day's fields, and
`lib/validate/entry.ts` validated them; neither had any notion of how the
transition into that day should play, because there was no field for it.

Related: B11 is who the figures are. This is what the scene does with them.
They touch the same components and were kept separate.

## What shipped

**Field:** `travelScene`, an optional string in an entry's frontmatter. One of
`"default"` (or absent — today's exact scene), `"quick"`, `"skip"`. The runtime
list is `TRAVEL_SCENE_VARIANTS` in `lib/validate/entry.ts`, mirroring
`TravelSceneVariant` in `lib/types.ts` the same way `TRANSPORT_MODES` mirrors
`TransportMode`.

**Two visual treatments plus one that removes the step entirely:**

- `"default"` — today's scene unchanged (travellers, vehicle, rising
  cityscape), but its duration now scales with the great-circle distance
  between the previous day's coordinates and this one's — `legDistanceKm()`
  and `sceneDurationSeconds()` in `components/TravelScene.tsx`, clamped to
  3–9s, falling back to the old constant 6s when either day has no
  coordinates. A short hop now settles in a few seconds; a transoceanic flight
  takes the full nine.
- `"quick"` — a compact lane with the mode icon crossing it, no
  travellers/cityscape/clouds, clamped to 1.2–2.6s (also distance-scaled, so
  it is always shorter than `"default"` at the same distance, never merely a
  trimmed copy of it).
- `"skip"` — `buildSteps()` in `components/StoryPager.tsx` leaves the leg out
  of the pager entirely: no screen, no wait, straight from one day card to the
  next. This is the one a reader on their fortieth identical leg actually
  wants. `TravelScene` also handles `"skip"` defensively if ever rendered
  directly (collapses to the same near-zero duration as reduced motion), but
  in the shipped app it never reaches the component at all.

**Round-trips through the write API, with the same fallback `visibility`
gets, not the one `transportMode` gets.** `checkTravelScene()` in
`lib/validate/entry.ts` refuses a non-string but *not* an unrecognised one —
deliberately unlike `checkTransportMode`. An unrecognised value is written
into the file exactly as sent (`createDraft` / `spliceEntryFields` in
`lib/api/entries.ts`) and it is the read side —
`parseTravelSceneVariant()` in `lib/entries.ts` — that falls back to the
default, the same split `parseVisibility()` in `lib/trips.ts` already draws.

**Discoverable:** the day-fields table and the "what is accepted" table in
`lib/api/documentation.ts` (source for `/agent.md`), and the `Draft`/`DayEdit`
schemas in `lib/api/openapi.ts` (`/openapi.json`), all list
`TRAVEL_SCENE_VARIANTS`.

**One effect for every variant.** The reduced-motion check and the "skip"
check both just set the same `duration` variable that feeds one `animate()`
call — there is no per-variant branch that could independently forget to
respect `prefers-reduced-motion`.

## Not done

Making the animation configurable from a browser UI — there is no editing
interface (decision 24), full stop.

## Acceptance

- **Two days with different variants play visibly differently in the demo
  journal, and a day with no variant plays exactly what it plays today.**
  `content/example/trips/asia-2023/entries/2023-01-24-night-train-north.md`
  carries `travelScene: "quick"` and
  `2023-04-18-hue-to-hoi-an.md` carries `travelScene: "skip"`; every other leg
  in that trip (including the long-haul flight into Bangkok) is untouched.
  Confirmed manually against the running dev server with Playwright: the
  default flight scene (clouds/cityscape/travellers, `h-[280px]`) and the
  quick train scene (a bare lane, `h-[110px]`) are visibly distinct, and
  paging from the Luang Prabang day straight to the Hoi An day shows no travel
  screen at all in between.
- **The day-write REST endpoint round-trips the field, and an unknown value
  renders the default rather than throwing.** `test/agent-interface.test.ts`
  ("travelScene survives into the file", "an unrecognised travelScene
  round-trips into the file but reads back as the default") and
  `test/edit-day.test.ts` ("travelScene can be set, then cleared back to the
  default") drive this through `createDraft`/`editEntry` end to end, including
  the on-disk frontmatter and the parsed `Entry` it reads back as.
- **A `prefers-reduced-motion` reader gets no animation from any variant.**
  Structural by construction (see "One effect for every variant" above) rather
  than only tested per-case — there is exactly one place duration is decided,
  and both reduced motion and `"skip"` collapse it to the same 0.01s. Manually
  confirmed against the dev server with Playwright's `emulateMedia` on both
  the default and quick scenes.
- **`onDone` fires exactly once per leg for every variant, or the pager
  stalls.** Also structural: one `useEffect`/`animate()` pair handles
  `"default"` and `"quick"` (the only variants that produce a pager step —
  `"skip"` is never mounted as a step in the shipped app), so there is one
  completion path, not three to keep in sync. `test/travel-scene.test.ts`
  covers the pure logic around it (`buildSteps` including/excluding the travel
  step per variant, and the duration formula's bounds and ordering); manual
  paging through the full demo trip in the dev server crossed every step,
  including the omitted one, without stalling.

## Verification

`npm run build && npx tsc --noEmit && npx eslint . && npx vitest run` — all
green (one unrelated flaky timeout in `test/generator-output.test.ts` under
full-suite parallel load, which passes in isolation and is untouched by this
change).
