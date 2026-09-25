# Map redesign: Paper, with the review fixes

Plan, written 2026-09-25, before any of the work. It records intent: once a
phase lands, the code is the authority, and this file is corrected or trimmed
rather than trusted.

The design is the "Paper" proposal (boards 02–09 on the map-redesign design
canvas), changed by the review on board 10. The owner chose that combination.
Options B "Relief" and C "Ink & photos" were considered and not taken. B's
terrain layer comes back only as the optional Phase 3 below.

## 1. What we are building

One map style, used on every surface that draws a map, in a light and a dark
variant. The rules, with the review fixes folded in:

| Element | Rule |
| --- | --- |
| **Ground** | Paper land `#f7f0de`, sea `#cdebf2`, lakes and rivers `#bfe6f0`, country border `#b7a584`, internal border dashed `#dccfb2`, ice white, roads white with a sand casing. Dark: land `#1b2635`, sea `#0e2231`, border `#3d4d66`. Every value is a CSS custom property, never a hex in a component. |
| **Stops** | A white disc with a navy ring and a number, in day order. The number survives every zoom, including when the marker becomes a photo. |
| **Selected stop** | A larger **navy** disc with a white number. Not yellow. |
| **Here now** | A yellow dot with a halo, drawn **only** while a trip is live. Yellow means this and nothing else, on every map. |
| **Photo stop** | At town zoom and closer, the stop becomes its first photo (rounded square, white border) with the number badge. |
| **Cluster** | A navy disc with the count. Tap to zoom in. |
| **Route** | The trip's accent colour, 4 px, with a white casing. **Straight** hops between stops, not bowed curves, because a curve reads as a road nobody recorded. When a `track.json` exists, the recorded line is drawn and the hops are not. |
| **Planned legs** | Navy, dashed, 60 % opacity, the same on every map. |
| **Transport** | A small chip at the middle of the leg (icon, plus a duration if the content has one). The 13 line colours in `lib/transport.ts` stop being used for map lines. |
| **Accent** | One accent per trip. The dark variant is the theme's own text-safe step of the same hue (the B1798 pairs in `app/globals.css`). The slideshow uses the dark-theme token instead of a separate slideshow shade. |
| **Controls** | 44 px round buttons: zoom in, zoom out, whole trip, layers, full screen, plus a "Whole trip / This stop" switch. Same icons, same order everywhere. |
| **Time** | A proportional time scrubber (dates to x-position) wherever days are chosen on a map. Day chips only when the trip has 7 days or fewer. |
| **Reisen** | Visited countries get **one** neutral "visited" tint. Each trip is its accent-coloured route plus one marker. No per-country trip colours, so Switzerland in two trips and two coral trips no longer clash. |
| **Labels** | Stops in Fredoka 600 with a paper halo. Towns in Plus Jakarta 500, muted. Peaks with ▲ and metres. |

Phone first:

- The trip-page map never traps page scroll. One finger scrolls the page.
  Tapping the map (or its full-screen button) opens the full-screen map.
- In full screen: pinch, double-tap and wheel zoom, and one-finger pan.
- The bottom sheet has three snap points (peek, half, full). At half, the map
  keeps at least 55 % of the screen height.
- A stop carousel under the trip-page map stays in sync with the selection
  both ways.
- Motion is off under `prefers-reduced-motion`, as the slideshow already does.

## 2. What exists today

| Surface | Component | Used from | Tests |
| --- | --- | --- | --- |
| Trip page, under the hero | `components/TripMap.tsx` | `components/TripHero.tsx` | `test/trip-map.test.tsx` |
| Map page | `components/WorldMap.tsx` | `app/[user]/(trip)/map/MapPageContent.tsx`, `app/[user]/trips/[trip]/map/page.tsx` | `test/world-map.test.tsx`, `test/map-page.test.tsx`, `test/map-tense.test.tsx` |
| Countdown | `WorldMap` (plan only) | `components/TripCountdown.tsx` | `test/basemap-payload.test.tsx` |
| Studio, recorded trips | `WorldMap` | `components/studio/location/RecordedTripsSection.tsx` | — |
| Trips / Reisen | `components/LifetimeMap.tsx` | `app/[user]/trips/page.tsx` | `test/lifetime-map.test.tsx`, `test/lifetime-map-countries.test.tsx` |
| Slideshow | `SlideMap` in `components/SlideShow.tsx` | the map page | `test/slide-map.test.tsx` |
| Photobook, map credits | private package | `@paid/photobook/*` | private |

The data comes from `lib/basemap.ts` (clipped Natural Earth 1:10m, plus
opt-in HydroSHEDS and OSM parks that no public page opts into), the 1:110m
coastline via `components/useWorldLand.ts`, and `lib/mapFrame.ts` /
`lib/tripMap.ts` for framing and stops.

Problems the redesign fixes, from board 01:

- Four palettes, all hard-coded hex, so none follow dark mode.
- Four marker styles.
- No pinch, wheel or full-screen view.
- The slideshow draws only the 1:110m coastline at a fixed ×3.4 zoom, so a
  small trip collapses to one point.
- Natural Earth's main lake layer has no Thunersee, Brienzersee or
  Vierwaldstättersee.

## 3. Phases

Each phase is its own branch and PR, is mergeable alone, and passes
`npm run verify`. Phases 0–2 add no dependency and no capability. Phase 3 is
optional and off by default.

### Phase 0: groundwork (no visible change)

1. **Map tokens.** Add the `--map-*` custom properties (ground, lines, labels,
   markers, controls) to `app/globals.css` in all three theme blocks: light,
   `:root[data-theme="dark"]` and the `prefers-color-scheme` mirror. Add a
   typed `lib/map/style.ts` that exports `var(--map-…)` references for SVG
   attributes, so components never hold a hex.
   - Test: no hex literal under `components/*Map*.tsx` or `SlideMap`, in the
     same spirit as `test/no-striped-panels.test.ts`.
2. **Shared marker and line primitives.** `components/map/StopMarker.tsx`,
   `ClusterMarker`, `PhotoMarker`, `HereNow`, `RouteLine`, `PlannedLine`,
   `LegChip`. Each is sized in screen pixels through the existing `px()`
   convention (see the comment in `TripMap`).
3. **Shared viewport.** Extract the pan/zoom state and pointer handling
   duplicated in `TripMap` and `WorldMap` into `components/map/useMapViewport.ts`.
   Add:
   - two-pointer pinch
   - wheel zoom (`ctrlKey`/trackpad pinch included)
   - double-tap zoom
   - keyboard (`+`, `−`, arrows, `0` to fit)
   - a "cooperative" mode for embedded maps: one finger scrolls the page, two
     fingers or a tap opens full screen.
4. **Map controls.** `components/map/MapControls.tsx`, the one control column,
   with existing i18n keys where they exist (`map.zoomIn`, `map.zoomOut`,
   `map.reset`) and new keys for full screen, layers and "This stop".

Size: M. Risk: low. Existing tests must pass unchanged, which is the point of
the phase.

### Phase 1: Paper on every SVG map (the visible change)

1. **Trip page.** Restyle `TripMap` with the primitives: numbered stops, navy
   selection, straight accent route, recorded track when present.
   - Remove its own yellow selected fill and dashed grey route.
2. **Map page.** Restyle `WorldMap` the same way.
   - Replace the mode-coloured legs with accent legs plus `LegChip`.
   - Keep `dashFor` only for the planned line.
   - Blue clusters become navy.
3. **Reisen.** Restyle `LifetimeMap`.
   - Replace flag-colour fills with one visited tint.
   - Draw trip routes in their accents with one marker per trip.
   - Move the country hover text to a proper focusable label (B361's
     accessibility reasoning still applies).
   - This retires `lib/flagColours.ts` (B370, B375), which only the trips page
     and its test use. Delete it rather than leave it unused, because knip will
     say so anyway.
4. **Slideshow.** Rework `SlideMap`.
   - Draw it on `basemapForRoute(places)` instead of the 1:110m coastline.
   - Frame each leg with `frameRoute([from, to])` instead of the fixed
     `ZOOM = 3.4`.
   - Always use the dark tokens.
   - The vehicle marker stays, and falls back to a direction arrow when no
     transport mode is recorded.
   - Keep the rule in its doc comment that this map pans a world-space camera,
     and document the new framing next to it.
5. **Countdown and Studio.** Both inherit the `WorldMap` changes. Check the
   countdown stays under the 30 KB ceiling in `test/basemap-payload.test.tsx`.
6. **More water.** Extend `scripts/build-mapdata.mjs` with Natural Earth's
   `ne_10m_lakes_europe` and `ne_10m_rivers_europe`. They were checked for the
   design: they add Thunersee, Brienzersee, Vierwaldstättersee, Aare and Reuss.
   - Rebuild `lib/mapdata/basemap.json.gz`.
   - Keep `test/basemap-bundle.test.ts` green and record the size change in
     the commit message.
   - Do **not** opt the public pages into HydroSHEDS: at trip scale its lakes
     draw as shards (seen while making the mockups).
7. **Copy.** Every new string gets real en, de and hu entries in
   `site/locales/`. Run `npm run i18n:keys`.

Tests to update:

- `trip-map`, `world-map`, `lifetime-map`, `lifetime-map-countries`,
  `slide-map`: new marker structure and aria labels.
- `map-tense`: the here-now marker must appear only for a live trip.
- `basemap-bundle`: new layers.

Tests to add:

- Selection is never yellow.
- Here-now is drawn only when the trip is live.
- Numbers match day order across a cluster split.

Size: L. Risk: medium, because of the visual regressions across surfaces.

### Phase 2: phone-first interaction

1. **Full-screen map.**
   - An overlay route on the trip page reuses the map page's data, and the
     map page itself becomes the full-screen view on a phone.
   - Back closes it, including the iPhone edge swipe that B2324 added.
   - The URL carries the selected stop (`?stop=<key>`), so a shared link opens
     the same stop and nothing more. The link carries no access
     (`AGENTS.md`).
2. **Bottom sheet.** Build it from the drag and snap logic in
   `components/MobileDaySheet.tsx` (B2327), generalised to three snap points,
   rather than a second sheet implementation.
   - Peek: stats and scrubber.
   - Half: the selected stop with photos, the day's first lines, previous /
     next, "Read the day" and the existing Google Maps link.
   - Full: every stop.
3. **Time scrubber.** `components/map/TimeScrubber.tsx`.
   - Proportional to dates, with ticks for stops.
   - Drives the selection and the camera.
   - Also used by the slideshow's progress.
   - Test with the example journal's `asia-2023` (five months) and
     `usa-2026` (live).
4. **Stop carousel** under the trip-page map, synced with selection both ways.
5. **Photo markers** at town zoom, with number badges. Load them lazily
   through `mediaLoader` at thumbnail size.
6. **Desktop map page.** Stop list on the left (selected stop expanded with
   photos), map on the right, full-screen button.

Size: L. Risk: medium, because of gestures across browsers. Test on real
iOS Safari and Android Chrome, not only emulation.

### Phase 3 (optional): detailed basemap as a capability

This phase changes a documented principle. `docs/architecture.md` says "No
tile server, no API key". A decision entry in `docs/ROADMAP.md` comes first,
and the phase does not start without the owner's sign-off.

- **Capability.** A new `vectorMap` capability in `lib/config.ts` and
  `lib/capabilities.ts`, **off by default**.
  - Needs: a path to a self-hosted PMTiles file (for example a Protomaps
    regional extract made with `pmtiles extract`).
  - No API key, no third-party host, and the file is served same-origin with
    HTTP range requests.
  - `/api/health` explains it, and `docs/capabilities.md` gets a row.
- **Client.** MapLibre GL with a style generated from the same `--map-*`
  tokens, loaded **only** by the full-screen map and only when the capability
  is on.
  - The SVG maps stay the default, the server-rendered first paint, the
    no-JavaScript fallback and the print path.
  - Off means the SVG map exactly as after Phase 2: absent, not broken.
- **Terrain layer.** A "Terrain" switch for hillshade from open elevation
  tiles, self-hosted the same way. This is the one piece of option B that
  comes back.
- **Content security policy.** MapLibre uses workers, so check whether
  `worker-src 'self'` suffices with a self-hosted worker file before touching
  `next.config.ts`. Loosening it to `blob:` needs its own review.
- **Attribution.** OpenStreetMap (ODbL) attribution on the map and in the map
  credits.
- **GPS.** Nothing here reads `content/<user>/gps/`. The recorded line is
  still only the reader-filtered `track.json` (`docs/gps.md`).

Size: XL. Risk: high, from bundle size, the hosting story and CSP.

### Phase 4: print (private package)

Export a `PrintRouteMap` from the public app: the Phase 1 SVG, fixed frame,
no controls, scale bar, north arrow, stop list data. The photobook and
postcards in the private package then adopt it behind the `@paid/*` seam.
Nothing in this repository imports a `paid/` path.

## 4. How each phase is verified

- `npm run verify` (build, TypeScript, ESLint, Vitest, knip), in that order.
- **Real browser, desktop and phone width, light and dark.** Use content that
  existed before the change, not a fixture made for it. From the example
  journal:
  - `alps-2024`: small trip, two countries, town zoom
  - `asia-2023`: five months, flight across continents
  - `parks-2025`: 19 stops, clustering
  - `usa-2026`: live, here-now
  - `japan-2027`: plan only, countdown
- Check the console and the request log. Watch payload size on the countdown
  and trip page.
- Keyboard-only pass: every stop reachable, focus visible, the sheet
  dismissible.
- `test/depersonalised.test.ts` stays green: no personal names or places in
  application code. The example journal is content, not code.

## 5. Risks and open questions

- **Accent contrast on paper.** Sky `#3fa9c4` and yellow `#d69b0a` routes are
  weaker on `#f7f0de` than green, coral or navy. The white casing carries
  them, but check each accent at 3:1 against land before merging Phase 1.
- **Straight hops on long flights.** Across an ocean a straight equirectangular
  line looks odd. Decide in Phase 1 whether flights alone keep a gentle arc,
  as an explicit exception in `RouteLine`.
- **Photo markers and privacy.** A photo marker shows a photo the reader can
  already see on that day. Keep it that way: never a photo from a draft or
  hidden day, so filter through the same reader-filtered days as `tripStops`.
- **Phase 3 cost.** A useful PMTiles extract is gigabytes. That suits an
  operator such as fernscout.ch, and is why it is a capability and not the
  default.

## 6. Order of work

| # | Task | Phase | Size |
| --- | --- | --- | --- |
| 1 | `--map-*` tokens, light and dark, and `lib/map/style.ts` | 0 | S |
| 2 | Marker and line primitives with tests | 0 | M |
| 3 | `useMapViewport` (pinch, wheel, double-tap, keyboard, cooperative) | 0 | M |
| 4 | `MapControls` and new i18n keys | 0 | S |
| 5 | `TripMap` in Paper | 1 | M |
| 6 | `WorldMap` in Paper, leg chips | 1 | M |
| 7 | `LifetimeMap`: visited tint and trip routes; remove `lib/flagColours.ts` | 1 | M |
| 8 | `SlideMap` on the real basemap, per-leg framing, dark tokens | 1 | M |
| 9 | Natural Earth Europe lakes and rivers in the bake | 1 | S |
| 10 | Full-screen map, URL state, back handling | 2 | M |
| 11 | Three-point sheet from `MobileDaySheet` | 2 | M |
| 12 | `TimeScrubber`, shared with the slideshow | 2 | M |
| 13 | Stop carousel and photo markers | 2 | M |
| 14 | Desktop map page layout | 2 | S |
| 15 | ROADMAP decision on vector tiles; sign-off | 3 | S |
| 16 | `vectorMap` capability, MapLibre, PMTiles, terrain | 3 | XL |
| 17 | `PrintRouteMap` export for the private package | 4 | S |
